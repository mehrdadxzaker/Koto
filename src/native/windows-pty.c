/*
 * Windows 10 1809+ terminal/pipe supervisor. The Job Object is assigned while
 * the native process is suspended, before any user code can create children.
 * KILL_ON_JOB_CLOSE protects helper death; no breakaway is granted.
 * stdout is native output. stderr is lifecycle JSONL and encoded native stderr.
 */
#if !defined(_WIN32)
#error "windows-pty.c requires Windows"
#endif
#define _WIN32_WINNT 0x0A00
#define NTDDI_VERSION 0x0A000006 /* Windows 10 RS5 / 1809: ConPTY minimum. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define FRAME_LIMIT 65536U
#define INPUT_LIMIT (256U * 1024U)
#define STATUS_LIMIT (64U * 1024U)
#define OUTPUT_LIMIT (8U * 1024U * 1024U)
#define IO_STALL_MS 1500ULL
#define CLEANUP_MS 2500ULL
#define JOIN_MS 750U
#define PHASE_LIMIT 64U
#define RESIZE_PHASE_LIMIT 48U
/* Nominal waits after stop: PTY 2500 + 6*750 = 7000 ms; pipe 2500 +
 * 5*750 = 6250 ms. Supervisor polling and OS scheduling/API latency are extra.
 * A blocked resize is confined to its worker and bounded join, never this loop. */

struct supervisor {
    HANDLE input, output, status, host, job, process;
    HANDLE native_input, native_output, native_error;
    HANDLE wake, input_wake, stop_io, status_wake, stop_status, resize_wake, stop_resize;
    HANDLE control_thread, input_thread, output_thread, error_thread, status_thread, close_thread, resize_thread;
    HPCON console;
    CRITICAL_SECTION lock;
    unsigned char queued_input[INPUT_LIMIT], queued_status[STATUS_LIMIT];
    size_t input_length, status_length;
    unsigned long long total_output;
    ULONGLONG input_started, output_started, status_started;
    DWORD pid, exit_code, resume_count;
    SHORT columns, rows;
    BOOL pipe_mode, stop_requested, input_ended, resize_pending;
    volatile LONG shutting_down;
    BOOL input_busy, output_busy, status_busy, exited, cleanup_confirmed;
    BOOL ready_queued, final_queued, close_phase_started;
    unsigned phase_sequence, resize_phases_reserved;
    const char *reason;
};

enum phase_operation {
    PHASE_RESUME_PROCESS, PHASE_RESIZE_CONSOLE, PHASE_STOP_REQUESTED,
    PHASE_TERMINATE_JOB, PHASE_WAIT_JOB, PHASE_CLOSE_CONSOLE, PHASE_JOIN_THREADS
};

static const char *const phase_names[] = {
    "resume_process", "resize_console", "stop_requested", "terminate_job",
    "wait_job", "close_console", "join_threads"
};

/* All lifecycle records share this queue and lock. Diagnostics never supply
 * ownership evidence, and a stalled diagnostic queue must not recurse. */
static BOOL status_append_locked(struct supervisor *s, const char *bytes, size_t length)
{
    if (length > STATUS_LIMIT - s->status_length) return FALSE;
    memcpy(s->queued_status + s->status_length, bytes, length);
    s->status_length += length;
    SetEvent(s->status_wake);
    return TRUE;
}

static BOOL phase_record_locked(struct supervisor *s, enum phase_operation operation,
    const char *state, DWORD error_code)
{
    char record[256];
    char resume_detail[48] = "";
    int length;
    if (!s->ready_queued || s->final_queued || s->phase_sequence >= PHASE_LIMIT) return FALSE;
    if (operation == PHASE_RESUME_PROCESS && strcmp(state, "end") == 0) {
        snprintf(resume_detail, sizeof(resume_detail), ",\"resumeCount\":%lu", (unsigned long)s->resume_count);
    }
    length = snprintf(record, sizeof(record),
        "{\"type\":\"phase\",\"pid\":%lu,\"sessionId\":%lu,\"sequence\":%u,\"operation\":\"%s\",\"state\":\"%s\",\"errorCode\":%lu%s}\n",
        (unsigned long)s->pid, (unsigned long)s->pid, s->phase_sequence + 1,
        phase_names[operation], state, (unsigned long)error_code, resume_detail);
    if (length < 0 || (size_t)length >= sizeof(record)
        || !status_append_locked(s, record, (size_t)length)) {
        if (s->reason == NULL) s->reason = "status_stalled";
        s->stop_requested = TRUE;
        SetEvent(s->wake);
        return FALSE;
    }
    ++s->phase_sequence;
    return TRUE;
}

static BOOL phase_begin_locked(struct supervisor *s, enum phase_operation operation)
{
    /* Reserve a complete resize pair, leaving sixteen records for shutdown.
     * A hung call intentionally leaves its begin without an end diagnostic. */
    if (operation == PHASE_RESIZE_CONSOLE
        && s->resize_phases_reserved > RESIZE_PHASE_LIMIT - 2) return FALSE;
    if (!phase_record_locked(s, operation, "begin", 0)) return FALSE;
    if (operation == PHASE_RESIZE_CONSOLE) s->resize_phases_reserved += 2;
    return TRUE;
}

static BOOL phase_begin(struct supervisor *s, enum phase_operation operation)
{
    BOOL started;
    EnterCriticalSection(&s->lock);
    started = phase_begin_locked(s, operation);
    LeaveCriticalSection(&s->lock);
    return started;
}

static void phase_end(struct supervisor *s, enum phase_operation operation, BOOL started, DWORD error_code)
{
    if (!started) return;
    EnterCriticalSection(&s->lock);
    phase_record_locked(s, operation, "end", error_code);
    LeaveCriticalSection(&s->lock);
}

static void remember_error(DWORD *first, DWORD code)
{
    if (*first == 0 && code != 0) *first = code;
}

static void request_stop(struct supervisor *s, const char *reason)
{
    BOOL phase;
    EnterCriticalSection(&s->lock);
    phase = !s->stop_requested && phase_begin_locked(s, PHASE_STOP_REQUESTED);
    if (s->reason == NULL && reason != NULL) s->reason = reason;
    s->stop_requested = TRUE;
    if (phase) phase_record_locked(s, PHASE_STOP_REQUESTED, "end", 0);
    LeaveCriticalSection(&s->lock);
    SetEvent(s->wake);
}

static BOOL status_append(struct supervisor *s, const char *bytes, size_t length)
{
    BOOL result = FALSE;
    EnterCriticalSection(&s->lock);
    result = status_append_locked(s, bytes, length);
    LeaveCriticalSection(&s->lock);
    if (!result) request_stop(s, "status_stalled");
    return result;
}

static BOOL write_all(HANDLE handle, const unsigned char *bytes, DWORD length)
{
    while (length != 0) {
        DWORD count = 0;
        if (!WriteFile(handle, bytes, length, &count, NULL) || count == 0) return FALSE;
        bytes += count;
        length -= count;
    }
    return TRUE;
}

static DWORD WINAPI status_worker(void *argument)
{
    struct supervisor *s = argument;
    unsigned char bytes[4096];
    HANDLE waiters[] = { s->stop_status, s->status_wake };
    for (;;) {
        DWORD selected = WaitForMultipleObjects(2, waiters, FALSE, INFINITE);
        if (selected == WAIT_OBJECT_0 || selected == WAIT_FAILED) return 0;
        for (;;) {
            DWORD length;
            EnterCriticalSection(&s->lock);
            length = (DWORD)(s->status_length < sizeof(bytes) ? s->status_length : sizeof(bytes));
            if (length != 0) {
                memcpy(bytes, s->queued_status, length);
                memmove(s->queued_status, s->queued_status + length, s->status_length - length);
                s->status_length -= length;
                s->status_busy = TRUE;
                s->status_started = GetTickCount64();
            }
            LeaveCriticalSection(&s->lock);
            if (length == 0) break;
            if (!write_all(s->status, bytes, length)) {
                request_stop(s, "status_failed");
                return 1;
            }
            EnterCriticalSection(&s->lock);
            s->status_busy = FALSE;
            LeaveCriticalSection(&s->lock);
        }
    }
}

static BOOL read_exact(HANDLE handle, unsigned char *bytes, DWORD length)
{
    while (length != 0) {
        DWORD count = 0;
        if (!ReadFile(handle, bytes, length, &count, NULL) || count == 0) return FALSE;
        bytes += count;
        length -= count;
    }
    return TRUE;
}

static DWORD WINAPI control_worker(void *argument)
{
    struct supervisor *s = argument;
    unsigned char header[5], payload[FRAME_LIMIT];
    for (;;) {
        uint32_t length;
        BOOL bad = FALSE;
        if (InterlockedCompareExchange(&s->shutting_down, 0, 0)) return 0;
        if (!read_exact(s->input, header, 5)) {
            if (!InterlockedCompareExchange(&s->shutting_down, 0, 0)) request_stop(s, "control_eof");
            return 0;
        }
        length = ((uint32_t)header[1] << 24) | ((uint32_t)header[2] << 16)
            | ((uint32_t)header[3] << 8) | (uint32_t)header[4];
        if (length > FRAME_LIMIT) {
            request_stop(s, "invalid_control");
            return 1;
        }
        if (length != 0 && !read_exact(s->input, payload, length)) {
            if (!InterlockedCompareExchange(&s->shutting_down, 0, 0)) request_stop(s, "invalid_control");
            return 1;
        }
        if (header[0] == 3 && length == 0) {
            request_stop(s, "stopped");
            return 0;
        }
        EnterCriticalSection(&s->lock);
        if (header[0] == 0) {
            if (s->input_ended || length > INPUT_LIMIT - s->input_length) bad = TRUE;
            else {
                memcpy(s->queued_input + s->input_length, payload, length);
                s->input_length += length;
                SetEvent(s->input_wake);
            }
        } else if (header[0] == 1 && length == 4 && !s->pipe_mode) {
            unsigned columns = ((unsigned)payload[0] << 8) | payload[1];
            unsigned rows = ((unsigned)payload[2] << 8) | payload[3];
            if (columns < 1 || columns > 32767 || rows < 1 || rows > 32767) bad = TRUE;
            else if (!s->stop_requested && !InterlockedCompareExchange(&s->shutting_down, 0, 0)) {
                s->columns = (SHORT)columns; s->rows = (SHORT)rows;
                s->resize_pending = TRUE;
                SetEvent(s->resize_wake);
            }
        } else if (header[0] == 2 && length == 0 && !s->input_ended) {
            if (!s->pipe_mode) {
                if (s->input_length == INPUT_LIMIT) bad = TRUE;
                else s->queued_input[s->input_length++] = 4; /* Native TUI decides EOT semantics. */
            }
            s->input_ended = TRUE;
            SetEvent(s->input_wake);
        } else bad = TRUE;
        LeaveCriticalSection(&s->lock);
        if (bad) { request_stop(s, "invalid_control"); return 1; }
        SetEvent(s->wake);
    }
}

static DWORD WINAPI resize_worker(void *argument)
{
    struct supervisor *s = argument;
    HANDLE waiters[] = { s->stop_resize, s->resize_wake };
    for (;;) {
        DWORD selected = WaitForMultipleObjects(2, waiters, FALSE, INFINITE);
        if (selected == WAIT_OBJECT_0) return 0;
        if (selected == WAIT_FAILED) { request_stop(s, "session_inspection_failed"); return 1; }
        for (;;) {
            COORD size;
            BOOL phase;
            HRESULT resized;
            EnterCriticalSection(&s->lock);
            if (s->stop_requested || InterlockedCompareExchange(&s->shutting_down, 0, 0)) {
                s->resize_pending = FALSE;
                LeaveCriticalSection(&s->lock);
                return 0;
            }
            if (!s->ready_queued || !s->resize_pending) {
                LeaveCriticalSection(&s->lock);
                break;
            }
            size.X = s->columns; size.Y = s->rows;
            s->resize_pending = FALSE;
            phase = phase_begin_locked(s, PHASE_RESIZE_CONSOLE);
            LeaveCriticalSection(&s->lock);
            /* ConPTY may block here. The supervisor must retain its stop/Job
             * deadline independently; it joins this sole worker before close. */
            resized = ResizePseudoConsole(s->console, size);
            phase_end(s, PHASE_RESIZE_CONSOLE, phase, FAILED(resized) ? (DWORD)resized : 0);
            if (FAILED(resized)) { request_stop(s, "pty_failed"); return 1; }
        }
    }
}

static DWORD WINAPI input_worker(void *argument)
{
    struct supervisor *s = argument;
    unsigned char bytes[4096];
    HANDLE waiters[] = { s->stop_io, s->input_wake };
    for (;;) {
        DWORD selected = WaitForMultipleObjects(2, waiters, FALSE, INFINITE);
        if (selected == WAIT_OBJECT_0 || selected == WAIT_FAILED) return 0;
        for (;;) {
            DWORD length;
            BOOL close_input;
            EnterCriticalSection(&s->lock);
            length = (DWORD)(s->input_length < sizeof(bytes) ? s->input_length : sizeof(bytes));
            close_input = s->input_ended && s->pipe_mode;
            if (length != 0) {
                memcpy(bytes, s->queued_input, length);
                memmove(s->queued_input, s->queued_input + length, s->input_length - length);
                s->input_length -= length;
                s->input_busy = TRUE;
                s->input_started = GetTickCount64();
            }
            LeaveCriticalSection(&s->lock);
            if (length == 0) {
                if (close_input) { CloseHandle(s->native_input); s->native_input = NULL; return 0; }
                break;
            }
            if (!write_all(s->native_input, bytes, length)) {
                if (!InterlockedCompareExchange(&s->shutting_down, 0, 0)) request_stop(s, "pty_failed");
                return 1;
            }
            EnterCriticalSection(&s->lock);
            s->input_busy = FALSE;
            LeaveCriticalSection(&s->lock);
        }
    }
}

static BOOL account_output(struct supervisor *s, DWORD length)
{
    BOOL allowed;
    EnterCriticalSection(&s->lock);
    s->total_output += length;
    allowed = s->total_output <= OUTPUT_LIMIT;
    LeaveCriticalSection(&s->lock);
    if (!allowed) request_stop(s, "output_failed");
    return allowed;
}

static DWORD WINAPI output_worker(void *argument)
{
    struct supervisor *s = argument;
    unsigned char bytes[4096];
    for (;;) {
        DWORD length = 0;
        if (!ReadFile(s->native_output, bytes, sizeof(bytes), &length, NULL)) {
            DWORD code = GetLastError();
            if (code != ERROR_BROKEN_PIPE && !(code == ERROR_OPERATION_ABORTED
                && InterlockedCompareExchange(&s->shutting_down, 0, 0))) request_stop(s, "output_failed");
            return 0;
        }
        if (length == 0) return 0;
        if (!account_output(s, length)) return 1;
        EnterCriticalSection(&s->lock);
        s->output_busy = TRUE;
        s->output_started = GetTickCount64();
        LeaveCriticalSection(&s->lock);
        if (!write_all(s->output, bytes, length)) { request_stop(s, "output_failed"); return 1; }
        EnterCriticalSection(&s->lock);
        s->output_busy = FALSE;
        LeaveCriticalSection(&s->lock);
    }
}

static DWORD WINAPI error_worker(void *argument)
{
    struct supervisor *s = argument;
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    unsigned char bytes[2048];
    char record[2800];
    for (;;) {
        DWORD length = 0, index;
        size_t offset;
        if (!ReadFile(s->native_error, bytes, sizeof(bytes), &length, NULL)) {
            DWORD code = GetLastError();
            if (code != ERROR_BROKEN_PIPE && !(code == ERROR_OPERATION_ABORTED
                && InterlockedCompareExchange(&s->shutting_down, 0, 0))) request_stop(s, "output_failed");
            return 0;
        }
        if (length == 0) return 0;
        if (!account_output(s, length)) return 1;
        memcpy(record, "{\"type\":\"stderr\",\"data\":\"", 25);
        offset = 25;
        for (index = 0; index < length; index += 3) {
            unsigned value = (unsigned)bytes[index] << 16;
            if (index + 1 < length) value |= (unsigned)bytes[index + 1] << 8;
            if (index + 2 < length) value |= bytes[index + 2];
            record[offset++] = alphabet[(value >> 18) & 63];
            record[offset++] = alphabet[(value >> 12) & 63];
            record[offset++] = index + 1 < length ? alphabet[(value >> 6) & 63] : '=';
            record[offset++] = index + 2 < length ? alphabet[value & 63] : '=';
        }
        memcpy(record + offset, "\"}\n", 3);
        if (!status_append(s, record, offset + 3)) return 1;
    }
}

static DWORD WINAPI close_console_worker(void *argument)
{
    struct supervisor *s = argument;
    ClosePseudoConsole(s->console);
    s->console = NULL;
    phase_end(s, PHASE_CLOSE_CONSOLE, s->close_phase_started, 0);
    return 0;
}

static BOOL join_thread(HANDLE thread, DWORD timeout, BOOL cancel, DWORD *first_error)
{
    ULONGLONG deadline;
    if (thread == NULL) return TRUE;
    deadline = GetTickCount64() + timeout;
    for (;;) {
        DWORD selected, remaining;
        ULONGLONG now = GetTickCount64();
        if (now >= deadline) { remember_error(first_error, WAIT_TIMEOUT); return FALSE; }
        remaining = (DWORD)(deadline - now);
        /* Repeat cancellation to cover the race in which the worker enters a
         * synchronous read just after the first cancellation found no I/O. */
        if (cancel && !CancelSynchronousIo(thread)) {
            DWORD code = GetLastError();
            if (code != ERROR_NOT_FOUND) remember_error(first_error, code);
        }
        selected = WaitForSingleObject(thread, cancel && remaining > 10 ? 10 : remaining);
        if (selected == WAIT_OBJECT_0) return TRUE;
        if (selected == WAIT_FAILED) { remember_error(first_error, GetLastError()); return FALSE; }
        if (selected != WAIT_TIMEOUT) { remember_error(first_error, ERROR_INVALID_DATA); return FALSE; }
    }
}

/* Quote every argv entry using the CommandLineToArgvW / Microsoft CRT rules. */
static wchar_t *command_line(int count, wchar_t **arguments)
{
    size_t capacity = 1, offset = 0;
    wchar_t *result;
    int index;
    for (index = 0; index < count; ++index) {
        size_t length = wcslen(arguments[index]);
        if (length > 32766 || capacity > 65536 - length * 2 - 4) return NULL;
        capacity += length * 2 + 4;
    }
    result = calloc(capacity, sizeof(wchar_t));
    if (result == NULL) return NULL;
    for (index = 0; index < count; ++index) {
        const wchar_t *cursor = arguments[index];
        if (index != 0) result[offset++] = L' ';
        result[offset++] = L'"';
        while (*cursor != L'\0') {
            size_t slashes = 0;
            while (*cursor == L'\\') { ++slashes; ++cursor; }
            if (*cursor == L'\0' || *cursor == L'"') slashes *= 2;
            while (slashes-- != 0) result[offset++] = L'\\';
            if (*cursor == L'\0') break;
            if (*cursor == L'"') result[offset++] = L'\\';
            result[offset++] = *cursor++;
        }
        result[offset++] = L'"';
    }
    result[offset] = L'\0';
    if (offset >= 32767) { free(result); return NULL; }
    return result;
}

static BOOL dimension(const wchar_t *value, SHORT *result)
{
    wchar_t *end;
    unsigned long parsed = wcstoul(value, &end, 10);
    if (*value == L'\0' || *end != L'\0' || parsed < 1 || parsed > 32767) return FALSE;
    *result = (SHORT)parsed;
    return TRUE;
}

static BOOL make_pipe(HANDLE *read_end, HANDLE *write_end, BOOL inherited)
{
    SECURITY_ATTRIBUTES security = { sizeof(security), NULL, inherited };
    return CreatePipe(read_end, write_end, &security, 0);
}

int wmain(int argc, wchar_t **argv)
{
    struct supervisor *s;
    PROCESS_INFORMATION process = {0};
    STARTUPINFOEXW startup = {0};
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    HANDLE child_input = NULL, child_output = NULL, child_error = NULL;
    HANDLE inherited_handles[3];
    SIZE_T attributes_size = 0;
    wchar_t *line = NULL;
    DWORD host_pid = 0;
    DWORD job_error = 0, join_error = 0;
    int index, command_index = -1, result = 2;
    BOOL attributes_initialized = FALSE, final_sent = FALSE;
    BOOL wait_job_phase = FALSE, join_phase = FALSE, resize_done = TRUE;
    ULONGLONG stopping_at = 0;
    char record[512];
    s = calloc(1, sizeof(*s));
    if (s == NULL) return 2;
    InitializeCriticalSection(&s->lock);
    s->columns = 80; s->rows = 24;
    for (index = 1; index < argc; ++index) {
        if (wcscmp(argv[index], L"--") == 0) { command_index = index + 1; break; }
        if (wcscmp(argv[index], L"--pipe") == 0) s->pipe_mode = TRUE;
        else if (wcscmp(argv[index], L"--cols") == 0 && index + 1 < argc) {
            if (!dimension(argv[++index], &s->columns)) goto finish;
        } else if (wcscmp(argv[index], L"--rows") == 0 && index + 1 < argc) {
            if (!dimension(argv[++index], &s->rows)) goto finish;
        } else if (wcscmp(argv[index], L"--host-pid") == 0 && index + 1 < argc) {
            wchar_t *end;
            unsigned long parsed = wcstoul(argv[++index], &end, 10);
            if (*argv[index] == L'\0' || *end != L'\0' || parsed == 0) goto finish;
            host_pid = (DWORD)parsed;
        } else goto finish;
    }
    if (command_index < 0 || command_index >= argc || argc - command_index > 129 || host_pid == 0) goto finish;
    line = command_line(argc - command_index, argv + command_index);
    if (line == NULL) goto finish;
    s->input = GetStdHandle(STD_INPUT_HANDLE);
    s->output = GetStdHandle(STD_OUTPUT_HANDLE);
    s->status = GetStdHandle(STD_ERROR_HANDLE);
    s->host = OpenProcess(SYNCHRONIZE, FALSE, host_pid);
    if (s->host == NULL || WaitForSingleObject(s->host, 0) != WAIT_TIMEOUT) goto finish;
    s->job = CreateJobObjectW(NULL, NULL);
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (s->job == NULL || !SetInformationJobObject(s->job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) goto finish;
    s->wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    s->input_wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    s->stop_io = CreateEventW(NULL, TRUE, FALSE, NULL);
    s->status_wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    s->stop_status = CreateEventW(NULL, TRUE, FALSE, NULL);
    s->resize_wake = CreateEventW(NULL, FALSE, FALSE, NULL);
    s->stop_resize = CreateEventW(NULL, TRUE, FALSE, NULL);
    if (!s->wake || !s->input_wake || !s->stop_io || !s->status_wake || !s->stop_status
        || !s->resize_wake || !s->stop_resize) goto finish;
    if (!make_pipe(&child_input, &s->native_input, s->pipe_mode)
        || !make_pipe(&s->native_output, &child_output, s->pipe_mode)) goto finish;
    if (s->pipe_mode) {
        if (!make_pipe(&s->native_error, &child_error, TRUE)) goto finish;
        if (!SetHandleInformation(s->native_input, HANDLE_FLAG_INHERIT, 0)
            || !SetHandleInformation(s->native_output, HANDLE_FLAG_INHERIT, 0)
            || !SetHandleInformation(s->native_error, HANDLE_FLAG_INHERIT, 0)) goto finish;
    } else {
        COORD size = { s->columns, s->rows };
        if (FAILED(CreatePseudoConsole(size, child_input, child_output, 0, &s->console))) goto finish;
        CloseHandle(child_input); child_input = NULL;
        CloseHandle(child_output); child_output = NULL;
    }
    InitializeProcThreadAttributeList(NULL, 1, 0, &attributes_size);
    startup.lpAttributeList = malloc(attributes_size);
    if (startup.lpAttributeList == NULL || !InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attributes_size)) goto finish;
    attributes_initialized = TRUE;
    startup.StartupInfo.cb = sizeof(startup);
    if (s->pipe_mode) {
        inherited_handles[0] = child_input; inherited_handles[1] = child_output; inherited_handles[2] = child_error;
        if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            inherited_handles, sizeof(inherited_handles), NULL, NULL)) goto finish;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = child_input;
        startup.StartupInfo.hStdOutput = child_output;
        startup.StartupInfo.hStdError = child_error;
    } else {
        /* A redirected helper host must not lend its protocol pipes to the
         * console child. Explicit NULL standard handles let ConPTY establish
         * console handles, even with bInheritHandles=FALSE.
         * https://github.com/microsoft/terminal/discussions/15814 */
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            s->console, sizeof(s->console), NULL, NULL)) goto finish;
    }
    if (!CreateProcessW(argv[command_index], line, NULL, NULL, s->pipe_mode,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
        NULL, NULL, &startup.StartupInfo, &process)) goto finish;
    s->process = process.hProcess;
    s->pid = process.dwProcessId;
    if (!AssignProcessToJobObject(s->job, s->process)) {
        TerminateProcess(s->process, 1);
        WaitForSingleObject(s->process, JOIN_MS);
        goto finish;
    }
    s->status_thread = CreateThread(NULL, 0, status_worker, s, 0, NULL);
    s->output_thread = CreateThread(NULL, 0, output_worker, s, 0, NULL);
    s->input_thread = CreateThread(NULL, 0, input_worker, s, 0, NULL);
    s->control_thread = CreateThread(NULL, 0, control_worker, s, 0, NULL);
    if (s->pipe_mode) s->error_thread = CreateThread(NULL, 0, error_worker, s, 0, NULL);
    else s->resize_thread = CreateThread(NULL, 0, resize_worker, s, 0, NULL);
    if (!s->status_thread || !s->output_thread || !s->input_thread || !s->control_thread
        || (s->pipe_mode ? !s->error_thread : !s->resize_thread)) goto finish;
    if (child_input) { CloseHandle(child_input); child_input = NULL; }
    if (child_output) { CloseHandle(child_output); child_output = NULL; }
    if (child_error) { CloseHandle(child_error); child_error = NULL; }
    EnterCriticalSection(&s->lock);
    snprintf(record, sizeof(record), "{\"type\":\"ready\",\"pid\":%lu,\"sessionId\":%lu,\"columns\":%d,\"rows\":%d}\n",
        (unsigned long)s->pid, (unsigned long)s->pid, (int)s->columns, (int)s->rows);
    s->ready_queued = status_append_locked(s, record, strlen(record));
    LeaveCriticalSection(&s->lock);
    if (!s->ready_queued) goto finish;
    SetEvent(s->resize_wake);
    {
        BOOL launch;
        EnterCriticalSection(&s->lock);
        launch = !s->stop_requested;
        LeaveCriticalSection(&s->lock);
        if (WaitForSingleObject(s->host, 0) != WAIT_TIMEOUT) { request_stop(s, "host_gone"); launch = FALSE; }
        /* A queued cancellation during setup must not resume the native task.
         * Its suspended process is already job-owned and has an announced id. */
        if (launch) {
            BOOL phase = phase_begin(s, PHASE_RESUME_PROCESS);
            BOOL failed;
            DWORD error_code = 0, previous_count;
            previous_count = ResumeThread(process.hThread);
            failed = previous_count == (DWORD)-1;
            if (failed) error_code = GetLastError();
            EnterCriticalSection(&s->lock);
            s->resume_count = previous_count;
            LeaveCriticalSection(&s->lock);
            phase_end(s, PHASE_RESUME_PROCESS, phase, error_code);
            if (failed) request_stop(s, "child_setup_failed");
        }
    }
    CloseHandle(process.hThread); process.hThread = NULL;

    for (;;) {
        HANDLE waiters[] = { s->host, s->process, s->wake };
        DWORD selected = WaitForMultipleObjects(3, waiters, FALSE, 20);
        DWORD wait_error = selected == WAIT_FAILED ? GetLastError() : 0;
        DWORD process_state;
        BOOL stop;
        const char *stalled = NULL;
        ULONGLONG now = GetTickCount64();
        if (selected == WAIT_OBJECT_0) request_stop(s, "host_gone");
        if (selected == WAIT_FAILED) {
            remember_error(&job_error, wait_error);
            request_stop(s, "session_inspection_failed");
        }
        if (!s->exited) {
            process_state = WaitForSingleObject(s->process, 0);
            if (process_state == WAIT_FAILED) {
                remember_error(&job_error, GetLastError());
                request_stop(s, "session_inspection_failed");
            } else if (process_state == WAIT_OBJECT_0) {
                if (!GetExitCodeProcess(s->process, &s->exit_code)) {
                    remember_error(&job_error, GetLastError());
                    request_stop(s, "session_inspection_failed");
                }
                s->exited = TRUE;
                request_stop(s, NULL);
            }
        }
        EnterCriticalSection(&s->lock);
        stop = s->stop_requested;
        if (s->input_busy && now - s->input_started > IO_STALL_MS) stalled = "input_overflow";
        if (s->output_busy && now - s->output_started > IO_STALL_MS) stalled = "output_stalled";
        if (s->status_busy && now - s->status_started > IO_STALL_MS) stalled = "status_stalled";
        LeaveCriticalSection(&s->lock);
        if (stalled) { request_stop(s, stalled); stop = TRUE; }
        if (stop && stopping_at == 0) {
            BOOL phase, failed;
            DWORD error_code = 0;
            stopping_at = now;
            InterlockedExchange(&s->shutting_down, TRUE);
            SetEvent(s->stop_io);
            SetEvent(s->stop_resize);
            if (s->input_thread) CancelSynchronousIo(s->input_thread);
            if (s->control_thread) CancelSynchronousIo(s->control_thread);
            phase = phase_begin(s, PHASE_TERMINATE_JOB);
            failed = !TerminateJobObject(s->job, 1);
            if (failed) error_code = GetLastError();
            phase_end(s, PHASE_TERMINATE_JOB, phase, error_code);
            if (failed) request_stop(s, "session_inspection_failed");
            wait_job_phase = phase_begin(s, PHASE_WAIT_JOB);
        }
        if (stopping_at != 0) {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
            BOOL inspected = QueryInformationJobObject(s->job, JobObjectBasicAccountingInformation,
                &accounting, sizeof(accounting), NULL);
            if (!inspected) {
                remember_error(&job_error, GetLastError());
                request_stop(s, "session_inspection_failed");
            }
            process_state = WaitForSingleObject(s->process, 0);
            if (process_state == WAIT_FAILED) {
                remember_error(&job_error, GetLastError());
                request_stop(s, "session_inspection_failed");
            }
            if (inspected && accounting.ActiveProcesses == 0 && process_state == WAIT_OBJECT_0) {
                s->cleanup_confirmed = TRUE;
                if (!s->exited) {
                    s->exited = GetExitCodeProcess(s->process, &s->exit_code);
                    if (!s->exited) {
                        remember_error(&job_error, GetLastError());
                        s->cleanup_confirmed = FALSE;
                    }
                }
                break;
            }
            if (now - stopping_at > CLEANUP_MS) {
                remember_error(&job_error, WAIT_TIMEOUT);
                request_stop(s, "cleanup_timeout"); break;
            }
            Sleep(10); /* A signaled process handle otherwise makes the wait spin. */
        }
    }

    phase_end(s, PHASE_WAIT_JOB, wait_job_phase, job_error);
    join_phase = phase_begin(s, PHASE_JOIN_THREADS);
    resize_done = join_thread(s->resize_thread, JOIN_MS, FALSE, &join_error);
    if (!resize_done) s->cleanup_confirmed = FALSE;
    if (s->console && resize_done) {
        /* ClosePseudoConsole can wait on its output. Keep the output reader
         * active while closing. The resize worker must have joined first, so
         * no thread can concurrently resize or later reuse this console. */
        s->close_phase_started = phase_begin(s, PHASE_CLOSE_CONSOLE);
        s->close_thread = CreateThread(NULL, 0, close_console_worker, s, 0, NULL);
        if (!s->close_thread) {
            DWORD error_code = GetLastError();
            remember_error(&join_error, error_code);
            phase_end(s, PHASE_CLOSE_CONSOLE, s->close_phase_started, error_code);
            s->cleanup_confirmed = FALSE;
        } else if (!join_thread(s->close_thread, JOIN_MS, FALSE, &join_error)) s->cleanup_confirmed = FALSE;
    }
    {
        BOOL control_done = join_thread(s->control_thread, JOIN_MS, TRUE, &join_error);
        BOOL input_done = join_thread(s->input_thread, JOIN_MS, TRUE, &join_error);
        BOOL output_done = join_thread(s->output_thread, JOIN_MS, FALSE, &join_error);
        BOOL error_done = join_thread(s->error_thread, JOIN_MS, FALSE, &join_error);
        if (!control_done || !input_done || !output_done || !error_done) s->cleanup_confirmed = FALSE;
        if (!output_done) CancelSynchronousIo(s->output_thread);
        if (!error_done) CancelSynchronousIo(s->error_thread);
        /* A timed-out worker can still use its handle. Keep that handle alive
         * until ExitProcess instead of racing a close against its next I/O. */
        /* A hung resize retains the console and its pipe handles until process
         * teardown, rather than racing any API/handle close against that call. */
        if (resize_done && input_done && s->native_input) { CloseHandle(s->native_input); s->native_input = NULL; }
        if (resize_done && output_done && s->native_output) { CloseHandle(s->native_output); s->native_output = NULL; }
        if (resize_done && error_done && s->native_error) { CloseHandle(s->native_error); s->native_error = NULL; }
    }
    phase_end(s, PHASE_JOIN_THREADS, join_phase, join_error);
    if (s->process) { CloseHandle(s->process); s->process = NULL; }
    if (s->job) { CloseHandle(s->job); s->job = NULL; }
    EnterCriticalSection(&s->lock);
    snprintf(record, sizeof(record), "{\"type\":\"complete\",\"pid\":%lu,\"sessionId\":%lu,\"exitCode\":%lu,\"cleanup\":\"%s\"%s%s%s}\n",
        (unsigned long)s->pid, (unsigned long)s->pid, (unsigned long)s->exit_code,
        s->cleanup_confirmed ? "confirmed" : "unconfirmed",
        s->reason ? ",\"reason\":\"" : "", s->reason ? s->reason : "", s->reason ? "\"" : "");
    final_sent = status_append_locked(s, record, strlen(record));
    s->final_queued = TRUE;
    LeaveCriticalSection(&s->lock);
    if (final_sent) {
        ULONGLONG deadline = GetTickCount64() + JOIN_MS;
        for (;;) {
            BOOL drained;
            EnterCriticalSection(&s->lock);
            drained = s->status_length == 0 && !s->status_busy;
            LeaveCriticalSection(&s->lock);
            if (drained) { result = s->cleanup_confirmed ? 0 : 2; break; }
            if (GetTickCount64() > deadline) break;
            Sleep(5);
        }
    }
finish:
    /* ExitProcess ends remaining I/O threads. Closing the non-inheritable job
     * kills every assigned descendant even on a partial startup or I/O failure. */
    if (s->job) { TerminateJobObject(s->job, 1); CloseHandle(s->job); s->job = NULL; }
    if (process.hThread) CloseHandle(process.hThread);
    if (s->process) CloseHandle(s->process);
    if (child_input) CloseHandle(child_input);
    if (child_output) CloseHandle(child_output);
    if (child_error) CloseHandle(child_error);
    if (s->stop_io) SetEvent(s->stop_io);
    if (s->stop_resize) SetEvent(s->stop_resize);
    if (s->stop_status) SetEvent(s->stop_status);
    if (s->host) CloseHandle(s->host);
    if (startup.lpAttributeList) { if (attributes_initialized) DeleteProcThreadAttributeList(startup.lpAttributeList); free(startup.lpAttributeList); }
    free(line);
    /* Threads may still own s on failure, so let process teardown release it. */
    (void)final_sent;
    ExitProcess((UINT)result);
}

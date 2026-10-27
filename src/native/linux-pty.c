/*
 * Linux PTY transport using the same framed control protocol as Darwin.
 * Process identity comes from procfs start ticks; pidfds bind member signals.
 * The owned boundary is one child-created session, excluding self-detachment.
 * This is process lifecycle management, not a hostile-code security sandbox.
 */
#if !defined(__linux__)
#error "linux-pty.c requires Linux"
#endif

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pty.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

#define FRAME_LIMIT 65536U
#define INPUT_LIMIT (256U * 1024U)
#define OUTPUT_LIMIT (512U * 1024U)
#define STATUS_LIMIT 8192U
#define PID_LIMIT 65536U
#define MEMBER_LIMIT 4096U
#define STARTUP_MS 2000U
#define TERM_MS 500U
#define CLEANUP_MS 1500U
#define STALL_MS 1000U
#define STATUS_FLUSH_MS 200U
#define SCAN_MS 50U

struct queue {
    unsigned char *bytes;
    size_t capacity;
    size_t offset;
    size_t length;
};

struct identity {
    pid_t pid;
    uint64_t start_ticks;
};

struct process_info {
    struct identity identity;
    pid_t session;
    char state;
};

struct child_failure {
    int stage;
    int error_number;
};

struct helper {
    pid_t child;
    pid_t host;
    int master;
    int setup;
    unsigned short columns;
    unsigned short rows;
    bool child_owned;
    bool child_exited;
    bool session_owned;
    bool identity_known;
    bool ready;
    bool stopping;
    bool pty_eof;
    bool control_eof;
    bool setup_eof;
    bool session_announced;
    bool output_failed;
    bool status_failed;
    bool cleanup_uncertain;
    bool protocol_failed;
    int native_code;
    int native_signal;
    const char *reason;
    uint64_t started_at;
    uint64_t stopped_at;
    uint64_t last_scan;
    uint64_t output_progress;
    uint64_t status_progress;
    unsigned empty_scans;
    size_t last_live;
    struct identity leader;
    struct identity members[MEMBER_LIMIT];
    unsigned char control[FRAME_LIMIT + 5U];
    size_t control_length;
    unsigned char setup_bytes[sizeof(struct child_failure)];
    size_t setup_length;
    unsigned char input_bytes[INPUT_LIMIT];
    unsigned char output_bytes[OUTPUT_LIMIT];
    unsigned char status_bytes[STATUS_LIMIT];
    struct queue input;
    struct queue output;
    struct queue metadata;
};

static volatile sig_atomic_t host_signal = 0;

static uint64_t milliseconds(void)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) _exit(2);
    return (uint64_t)now.tv_sec * 1000U + (uint64_t)now.tv_nsec / 1000000U;
}

/* A stop or output write can sample the clock after the loop's snapshot. */
static uint64_t elapsed(uint64_t now, uint64_t since)
{
    return now >= since ? now - since : 0;
}

static void received_signal(int number)
{
    if (host_signal == 0) host_signal = number;
}

static int set_nonblocking(int descriptor)
{
    int flags = fcntl(descriptor, F_GETFL);
    return flags < 0 ? -1 : fcntl(descriptor, F_SETFL, flags | O_NONBLOCK);
}

static int set_cloexec(int descriptor)
{
    int flags = fcntl(descriptor, F_GETFD);
    return flags < 0 ? -1 : fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC);
}

static bool append(struct queue *queue, const void *bytes, size_t length)
{
    if (length > queue->capacity - queue->length) return false;
    if (queue->offset + queue->length + length > queue->capacity) {
        memmove(queue->bytes, queue->bytes + queue->offset, queue->length);
        queue->offset = 0;
    }
    if (length != 0) memcpy(queue->bytes + queue->offset + queue->length, bytes, length);
    queue->length += length;
    return true;
}

/* Return -1 on failure; preserve EAGAIN without blocking other control paths. */
static int flush_queue(int descriptor, struct queue *queue, uint64_t *progress)
{
    while (queue->length != 0) {
        ssize_t written = write(descriptor, queue->bytes + queue->offset, queue->length);
        if (written > 0) {
            queue->offset += (size_t)written;
            queue->length -= (size_t)written;
            if (progress != NULL) *progress = milliseconds();
        } else if (written < 0 && errno == EINTR) {
            continue;
        } else if (written < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            return 0;
        } else {
            return -1;
        }
    }
    queue->offset = 0;
    return 0;
}

static void stop(struct helper *helper, const char *reason)
{
    if (helper->reason == NULL && reason != NULL) helper->reason = reason;
    if (!helper->stopping) {
        helper->stopping = true;
        helper->stopped_at = milliseconds();
        helper->last_scan = 0;
        helper->input.length = 0;
        helper->input.offset = 0;
    }
}

static bool same_identity(const struct identity *left, const struct identity *right)
{
    return left->pid == right->pid && left->start_ticks == right->start_ticks;
}

/* /proc names are numeric; never follow a path supplied by the workload. */
static bool proc_pid(const char *text, pid_t *result)
{
    if (*text == '\0') return false;
    unsigned value = 0;
    for (const unsigned char *at = (const unsigned char *)text; *at != '\0'; at++) {
        if (*at < '0' || *at > '9' || value > ((unsigned)INT_MAX - (*at - '0')) / 10U) return false;
        value = value * 10U + (*at - '0');
    }
    if (value == 0) return false;
    *result = (pid_t)value;
    return true;
}

/* 1 = inspected, 0 = process disappeared, -1 = inspection unavailable.
 * comm may contain spaces, newlines and ')'; the last ')' ends field 2.
 * The kernel emits numeric fields after that delimiter, never workload text.
 */
static int process_info(pid_t pid, struct process_info *result)
{
    char filename[64], buffer[8192];
    int length = snprintf(filename, sizeof(filename), "/proc/%ld/stat", (long)pid);
    if (length <= 0 || (size_t)length >= sizeof(filename)) return -1;
    int descriptor = open(filename, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (descriptor < 0) return errno == ENOENT || errno == ESRCH ? 0 : -1;
    ssize_t bytes;
    do { bytes = read(descriptor, buffer, sizeof(buffer) - 1U); } while (bytes < 0 && errno == EINTR);
    int saved = errno;
    (void)close(descriptor);
    if (bytes < 0) return saved == ENOENT || saved == ESRCH ? 0 : -1;
    if (bytes == 0 || (size_t)bytes >= sizeof(buffer) - 1U) return -1;
    buffer[bytes] = '\0';
    char *first_space = strchr(buffer, ' ');
    char *close = strrchr(buffer, ')');
    if (first_space == NULL || close == NULL || first_space[1] != '(' || close <= first_space
        || close[1] != ' ' || close[2] == '\0' || close[3] != ' ') return -1;
    *first_space = '\0';
    pid_t found;
    if (!proc_pid(buffer, &found) || found != pid) return -1;
    result->identity.pid = pid;
    result->state = close[2];
    char *token = close + 4;
    for (unsigned field = 4; field <= 22; field++) {
        if (*token == '\0' || *token == '\n') return -1;
        char *end = strchr(token, ' ');
        if (end == NULL) return -1;
        if (field == 6 || field == 22) {
            char saved_character = *end;
            *end = '\0';
            errno = 0;
            char *tail;
            unsigned long long value = strtoull(token, &tail, 10);
            bool valid = errno == 0 && tail != token && *tail == '\0' && token[0] != '-';
            *end = saved_character;
            if (!valid || (field == 6 && (value == 0 || value > INT_MAX))) return -1;
            if (field == 6) result->session = (pid_t)value;
            else result->identity.start_ticks = (uint64_t)value;
        }
        token = end + 1;
    }
    return 1;
}

static int identity(pid_t pid, struct identity *result)
{
    struct process_info information;
    int found = process_info(pid, &information);
    if (found == 1) *result = information.identity;
    return found;
}

/*
 * Observe exit without reaping: the zombie leader pins its numeric PID/SID
 * until all cleanup scans and signals are finished. Never adopt a reused SID.
 */
static void observe_exit(struct helper *helper)
{
    if (!helper->child_owned || helper->child_exited) return;
    siginfo_t information;
    memset(&information, 0, sizeof(information));
    int result;
    do {
        result = waitid(P_PID, (id_t)helper->child, &information, WEXITED | WNOHANG | WNOWAIT);
    } while (result < 0 && errno == EINTR);
    if (result < 0) {
        helper->cleanup_uncertain = true;
        if (errno == ECHILD) helper->child_owned = false;
        stop(helper, "session_inspection_failed");
        return;
    }
    if (information.si_pid != helper->child) return;
    if (information.si_code == CLD_EXITED) {
        helper->native_code = information.si_status;
    } else if (information.si_code == CLD_KILLED || information.si_code == CLD_DUMPED) {
        helper->native_signal = information.si_status;
    } else {
        helper->cleanup_uncertain = true;
    }
    helper->child_exited = true;
    stop(helper, NULL);
}

static void establish_session(struct helper *helper)
{
    if (helper->session_owned || !helper->child_owned || !helper->session_announced) return;
    pid_t sid = getsid(helper->child);
    if (sid != helper->child && !(helper->child_exited && helper->session_announced)) return;
    /* Never adopt the host's inherited SID. A private pre-exec announcement
     * proves setsid/TTY setup when getsid can no longer find a zombie leader. */
    struct identity current;
    int found = identity(helper->child, &current);
    if (found != 1) {
        helper->cleanup_uncertain = true;
        stop(helper, "session_inspection_failed");
        return;
    }
    helper->leader = current;
    helper->identity_known = true;
    helper->session_owned = true;
}

/* Open a stable kernel process reference before inspecting its numeric PID.
 * The pidfd never retargets a reused PID between inspection and signaling. */
static void signal_member(struct helper *helper, const struct identity *member, int number)
{
    int descriptor = (int)syscall(SYS_pidfd_open, member->pid, 0);
    if (descriptor < 0) {
        if (errno != ESRCH) helper->cleanup_uncertain = true;
        return;
    }
    struct process_info current;
    int found = process_info(member->pid, &current);
    if (found == 0) { (void)close(descriptor); return; }
    if (found < 0) {
        helper->cleanup_uncertain = true;
        (void)close(descriptor);
        return;
    }
    if (!same_identity(member, &current.identity) || current.session != helper->child
        || current.state == 'Z' || current.state == 'X') {
        (void)close(descriptor);
        return;
    }
    if (syscall(SYS_pidfd_send_signal, descriptor, number, NULL, 0) < 0 && errno != ESRCH) {
        helper->cleanup_uncertain = true;
    }
    (void)close(descriptor);
}

/*
 * Complete bounded enumeration is required to count an empty scan. Inspection
 * failures remain sticky; later successful scans do not erase that uncertainty.
 */
static bool scan_session(struct helper *helper, int number)
{
    helper->last_live = 0;
    if (!helper->session_owned || !helper->identity_known || !helper->child_owned) return false;
    struct identity leader;
    if (identity(helper->child, &leader) != 1 || !same_identity(&helper->leader, &leader)) {
        helper->cleanup_uncertain = true;
        return false;
    }
    if (!helper->child_exited && getsid(helper->child) != helper->child) {
        /* A live leader may become a zombie between observe_exit and getsid. */
        observe_exit(helper);
        if (!helper->child_exited) {
            helper->cleanup_uncertain = true;
            return false;
        }
    }
    DIR *directory = opendir("/proc");
    if (directory == NULL) {
        helper->cleanup_uncertain = true;
        return false;
    }
    size_t count = 0, members = 0;
    bool complete = true;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(directory);
        if (entry == NULL) {
            if (errno != 0) complete = false;
            break;
        }
        pid_t pid;
        if (!proc_pid(entry->d_name, &pid)) continue;
        if (++count > PID_LIMIT || ((count % 32U) == 0
            && elapsed(milliseconds(), helper->stopped_at) >= CLEANUP_MS)) {
            complete = false;
            break;
        }
        errno = 0;
        pid_t sid = getsid(pid);
        if (sid < 0) {
            if (errno != ESRCH) complete = false;
            continue;
        }
        if (sid != helper->child || (pid == helper->child && helper->child_exited)) continue;
        struct process_info member;
        int found = process_info(pid, &member);
        if (found == 0) continue;
        if (found < 0) {
            complete = false;
            continue;
        }
        if (member.session != helper->child || member.state == 'Z' || member.state == 'X') continue;
        if (members >= MEMBER_LIMIT) {
            complete = false;
            continue;
        }
        helper->members[members++] = member.identity;
    }
    if (closedir(directory) < 0) complete = false;
    helper->last_live = members;
    for (size_t index = 0; index < members; index++) {
        if ((index % 16U) == 0 && elapsed(milliseconds(), helper->stopped_at) >= CLEANUP_MS) {
            complete = false;
            break;
        }
        int current_signal = elapsed(milliseconds(), helper->stopped_at) >= TERM_MS ? SIGKILL : number;
        signal_member(helper, &helper->members[index], current_signal);
    }
    if (!complete) helper->cleanup_uncertain = true;
    return complete;
}

static void cleanup_scan(struct helper *helper, uint64_t now)
{
    if (helper->last_scan != 0 && elapsed(now, helper->last_scan) < SCAN_MS) return;
    helper->last_scan = now;
    int number = elapsed(now, helper->stopped_at) >= TERM_MS ? SIGKILL : SIGTERM;
    establish_session(helper);
    bool complete = scan_session(helper, number);
    if (!helper->session_owned && helper->child_owned && !helper->child_exited) {
        /* Direct-child ownership is pinned even before setsid succeeds. */
        if (kill(helper->child, number) < 0 && errno != ESRCH) helper->cleanup_uncertain = true;
    }
    if (complete && helper->last_live == 0 && helper->child_exited) helper->empty_scans++;
    else helper->empty_scans = 0;
}

static bool child_message(int descriptor, int stage, int error_number)
{
    struct child_failure failure = { stage, error_number };
    const unsigned char *bytes = (const unsigned char *)&failure;
    size_t offset = 0;
    while (offset < sizeof(failure)) {
        ssize_t written = write(descriptor, bytes + offset, sizeof(failure) - offset);
        if (written > 0) offset += (size_t)written;
        else if (written < 0 && errno == EINTR) continue;
        else return false;
    }
    return true;
}

static void child_failed(int descriptor, int stage)
{
    (void)child_message(descriptor, stage, errno);
    _exit(stage == 4 ? 127 : 126);
}

/* Enumerate actual open descriptors, including those above a lowered soft
 * limit. The CLOEXEC setup pipe disappears upon successful exec. */
static void child_close_descriptors(int preserve)
{
    DIR *directory = opendir("/proc/self/fd");
    if (directory == NULL) child_failed(preserve, 3);
    int listing = dirfd(directory);
    unsigned count = 0;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(directory);
        if (entry == NULL) {
            if (errno != 0) child_failed(preserve, 3);
            break;
        }
        pid_t descriptor;
        if (!proc_pid(entry->d_name, &descriptor)) continue;
        if (++count > PID_LIMIT) { errno = EMFILE; child_failed(preserve, 3); }
        if (descriptor >= 3 && descriptor != preserve && descriptor != listing) (void)close(descriptor);
    }
    if (closedir(directory) < 0) child_failed(preserve, 3);
}

static void run_child(int master, int slave, int setup, char **command, pid_t supervisor)
{
    /* A killed supervisor cannot report cleanup. Stop its direct workload even
     * in that case; the host still treats missing final metadata as unknown. */
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) < 0 || getppid() != supervisor) child_failed(setup, 1);
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = SIG_DFL;
    sigemptyset(&action.sa_mask);
    for (int number = 1; number < NSIG; number++) {
        if (number != SIGKILL && number != SIGSTOP) (void)sigaction(number, &action, NULL);
    }
    sigset_t signals;
    sigemptyset(&signals);
    if (sigprocmask(SIG_SETMASK, &signals, NULL) < 0) child_failed(setup, 1);
    (void)close(master);
    if (setsid() < 0 || ioctl(slave, TIOCSCTTY, 0) < 0) child_failed(setup, 1);
    for (int descriptor = 0; descriptor < 3; descriptor++) {
        if (dup2(slave, descriptor) < 0) child_failed(setup, 2);
    }
    action.sa_handler = SIG_IGN;
    if (sigaction(SIGTTOU, &action, NULL) < 0 || tcsetpgrp(STDIN_FILENO, getpgrp()) < 0) child_failed(setup, 2);
    action.sa_handler = SIG_DFL;
    if (sigaction(SIGTTOU, &action, NULL) < 0
        || !isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO) || !isatty(STDERR_FILENO)) {
        child_failed(setup, 2);
    }
    child_close_descriptors(setup);
    if (getsid(0) != getpid()) { errno = EIO; child_failed(setup, 2); }
    if (!child_message(setup, 0, 0)) _exit(126);
    execvp(command[0], command);
    child_failed(setup, 4);
}

static bool enqueue_ready(struct helper *helper)
{
    char line[256];
    int length = snprintf(line, sizeof(line),
        "{\"type\":\"ready\",\"pid\":%ld,\"sessionId\":%ld,\"columns\":%u,\"rows\":%u}\n",
        (long)helper->child, (long)helper->child, (unsigned)helper->columns, (unsigned)helper->rows);
    if (length <= 0 || (size_t)length >= sizeof(line) || !append(&helper->metadata, line, (size_t)length)) return false;
    helper->status_progress = milliseconds();
    helper->ready = true;
    return true;
}

static void read_setup(struct helper *helper)
{
    if (helper->setup < 0) return;
    ssize_t bytes = read(helper->setup, helper->setup_bytes + helper->setup_length,
        sizeof(helper->setup_bytes) - helper->setup_length);
    if (bytes > 0) {
        helper->setup_length += (size_t)bytes;
        if (helper->setup_length == sizeof(helper->setup_bytes)) {
            struct child_failure message;
            memcpy(&message, helper->setup_bytes, sizeof(message));
            helper->setup_length = 0;
            if (message.stage == 0 && message.error_number == 0 && !helper->session_announced) {
                helper->session_announced = true;
            } else {
                stop(helper, "child_setup_failed");
                helper->protocol_failed = true;
                (void)close(helper->setup);
                helper->setup = -1;
            }
        }
    } else if (bytes == 0) {
        helper->setup_eof = true;
        (void)close(helper->setup);
        helper->setup = -1;
        if (helper->setup_length != 0 || !helper->session_announced) {
            helper->protocol_failed = true;
            stop(helper, "child_setup_failed");
        }
    } else if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) {
        helper->protocol_failed = true;
        stop(helper, "child_setup_failed");
    }
}

static uint32_t uint32be(const unsigned char *bytes)
{
    return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16)
        | ((uint32_t)bytes[2] << 8) | bytes[3];
}

static unsigned short uint16be(const unsigned char *bytes)
{
    return (unsigned short)(((unsigned)bytes[0] << 8) | bytes[1]);
}

static void control_frame(struct helper *helper, unsigned operation, const unsigned char *payload, size_t length)
{
    if (operation > 3 || (operation == 1 && length != 4)
        || ((operation == 2 || operation == 3) && length != 0)) {
        helper->protocol_failed = true;
        stop(helper, "invalid_control");
        return;
    }
    if (operation == 3) { stop(helper, "stopped"); return; }
    if (helper->stopping) return;
    if (operation == 0) {
        if (!append(&helper->input, payload, length)) {
            helper->protocol_failed = true;
            stop(helper, "input_overflow");
        }
    } else if (operation == 1) {
        struct winsize dimensions;
        memset(&dimensions, 0, sizeof(dimensions));
        dimensions.ws_col = uint16be(payload);
        dimensions.ws_row = uint16be(payload + 2);
        if (dimensions.ws_col == 0 || dimensions.ws_row == 0) {
            helper->protocol_failed = true;
            stop(helper, "invalid_control");
        } else if (ioctl(helper->master, TIOCSWINSZ, &dimensions) < 0) {
            helper->protocol_failed = true;
            stop(helper, "pty_failed");
        }
    } else {
        struct termios settings;
        if (tcgetattr(helper->master, &settings) < 0
            || settings.c_cc[VEOF] == (cc_t)_POSIX_VDISABLE) {
            helper->protocol_failed = true;
            stop(helper, "eof_unavailable");
        } else if (!append(&helper->input, &settings.c_cc[VEOF], 1)) {
            helper->protocol_failed = true;
            stop(helper, "input_overflow");
        }
        /* In raw mode VEOF is a byte, not a promise of stream EOF. */
    }
}

static void parse_control(struct helper *helper)
{
    size_t offset = 0;
    unsigned frames = 0;
    while (helper->control_length - offset >= 5 && frames++ < 128U) {
        const unsigned char *frame = helper->control + offset;
        uint32_t length = uint32be(frame + 1);
        unsigned operation = frame[0];
        if (length > FRAME_LIMIT || operation > 3 || (operation == 1 && length != 4)
            || ((operation == 2 || operation == 3) && length != 0)) {
            helper->protocol_failed = true;
            stop(helper, "invalid_control");
            helper->control_length = 0;
            return;
        }
        if (helper->control_length - offset - 5 < (size_t)length) break;
        control_frame(helper, frame[0], frame + 5, length);
        offset += (size_t)length + 5;
    }
    if (offset != 0) {
        helper->control_length -= offset;
        memmove(helper->control, helper->control + offset, helper->control_length);
    }
}

static void read_control(struct helper *helper)
{
    parse_control(helper);
    size_t room = sizeof(helper->control) - helper->control_length;
    if (room == 0) return;
    ssize_t bytes = read(STDIN_FILENO, helper->control + helper->control_length, room);
    if (bytes > 0) {
        helper->control_length += (size_t)bytes;
        parse_control(helper);
    } else if (bytes == 0) {
        helper->control_eof = true;
        if (helper->control_length != 0) helper->protocol_failed = true;
        stop(helper, helper->control_length == 0 ? "control_eof" : "invalid_control");
    } else if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) {
        helper->control_eof = true;
        helper->protocol_failed = true;
        stop(helper, "invalid_control");
    }
}

static void read_pty(struct helper *helper)
{
    unsigned char buffer[16384];
    size_t room = helper->output.capacity - helper->output.length;
    if (room == 0 || helper->pty_eof) return;
    if (room > sizeof(buffer)) room = sizeof(buffer);
    ssize_t bytes = read(helper->master, buffer, room);
    if (bytes > 0) {
        if (helper->output.length == 0) helper->output_progress = milliseconds();
        if (!append(&helper->output, buffer, (size_t)bytes)) {
            helper->output_failed = true;
            stop(helper, "output_failed");
        }
    } else if (bytes == 0 || (bytes < 0 && errno == EIO)) {
        helper->pty_eof = true;
    } else if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) {
        helper->protocol_failed = true;
        stop(helper, "pty_failed");
    }
}

static const char *signal_name(int number)
{
    switch (number) {
        case SIGHUP: return "SIGHUP"; case SIGINT: return "SIGINT";
        case SIGQUIT: return "SIGQUIT"; case SIGILL: return "SIGILL";
        case SIGTRAP: return "SIGTRAP"; case SIGABRT: return "SIGABRT";
        case SIGFPE: return "SIGFPE";
        case SIGKILL: return "SIGKILL"; case SIGBUS: return "SIGBUS";
        case SIGSEGV: return "SIGSEGV"; case SIGSYS: return "SIGSYS";
        case SIGPIPE: return "SIGPIPE"; case SIGALRM: return "SIGALRM";
        case SIGTERM: return "SIGTERM"; case SIGURG: return "SIGURG";
        case SIGSTOP: return "SIGSTOP"; case SIGTSTP: return "SIGTSTP";
        case SIGCONT: return "SIGCONT"; case SIGCHLD: return "SIGCHLD";
        case SIGTTIN: return "SIGTTIN"; case SIGTTOU: return "SIGTTOU";
        case SIGIO: return "SIGIO"; case SIGXCPU: return "SIGXCPU";
        case SIGXFSZ: return "SIGXFSZ"; case SIGVTALRM: return "SIGVTALRM";
        case SIGPROF: return "SIGPROF"; case SIGWINCH: return "SIGWINCH";
        case SIGPWR: return "SIGPWR"; case SIGUSR1: return "SIGUSR1";
        case SIGUSR2: return "SIGUSR2"; default: return NULL;
    }
}

static bool reap_child(struct helper *helper)
{
    if (!helper->child_owned || !helper->child_exited) return false;
    int status;
    pid_t result;
    do { result = waitpid(helper->child, &status, WNOHANG); }
    while (result < 0 && errno == EINTR);
    if (result != helper->child) return false;
    helper->child_owned = false;
    return true;
}

static int complete(struct helper *helper)
{
    bool confirmed = !helper->cleanup_uncertain && helper->child_exited
        && helper->session_owned && helper->empty_scans >= 2;
    if (!reap_child(helper)) confirmed = false;
    char code[16], sid[24], signal_field[64] = "", reason_field[96] = "", line[512];
    if (helper->native_code >= 0) (void)snprintf(code, sizeof(code), "%d", helper->native_code);
    else (void)snprintf(code, sizeof(code), "null");
    if (helper->session_owned) (void)snprintf(sid, sizeof(sid), "%ld", (long)helper->child);
    else (void)snprintf(sid, sizeof(sid), "null");
    const char *name = signal_name(helper->native_signal);
    if (helper->native_signal != 0 && name == NULL) {
        helper->protocol_failed = true;
        confirmed = false;
    } else if (name != NULL) {
        (void)snprintf(signal_field, sizeof(signal_field), ",\"signal\":\"%s\"", name);
    }
    if (helper->reason != NULL) {
        (void)snprintf(reason_field, sizeof(reason_field), ",\"reason\":\"%s\"", helper->reason);
    }
    int length = snprintf(line, sizeof(line),
        "{\"type\":\"complete\",\"pid\":%ld,\"sessionId\":%s,\"exitCode\":%s%s,\"cleanup\":\"%s\"%s}\n",
        (long)helper->child, sid, code, signal_field, confirmed ? "confirmed" : "unconfirmed", reason_field);
    if (length <= 0 || (size_t)length >= sizeof(line)
        || !append(&helper->metadata, line, (size_t)length)) helper->status_failed = true;
    uint64_t deadline = milliseconds() + STATUS_FLUSH_MS;
    while (!helper->status_failed && helper->metadata.length != 0 && milliseconds() < deadline) {
        if (flush_queue(3, &helper->metadata, NULL) < 0) helper->status_failed = true;
        if (helper->metadata.length != 0) {
            struct pollfd descriptor = { 3, POLLOUT, 0 };
            (void)poll(&descriptor, 1, 10);
        }
    }
    if (helper->metadata.length != 0) helper->status_failed = true;
    return confirmed && !helper->status_failed && !helper->output_failed && !helper->protocol_failed ? 0 : 1;
}

static int run_parent(struct helper *helper)
{
    for (;;) {
        uint64_t now = milliseconds();
        if (host_signal != 0) stop(helper, "host_signal");
        if (getppid() != helper->host) stop(helper, "host_gone");
        observe_exit(helper);
        establish_session(helper);
        /* Setup may finish after an early stop request. Announce its verified
         * identity even while stopping so the host can bind confirmed cleanup
         * to this workload. Ready records setup, not continued liveness. */
        if (helper->setup_eof && helper->session_owned && !helper->ready
            && !helper->protocol_failed) {
            if (!enqueue_ready(helper)) {
                helper->status_failed = true;
                stop(helper, "status_failed");
            }
        }
        if (!helper->ready && !helper->stopping && elapsed(now, helper->started_at) >= STARTUP_MS) {
            helper->protocol_failed = true;
            stop(helper, "child_setup_failed");
        }
        parse_control(helper);
        if (helper->output.length != 0 && !helper->output_failed
            && flush_queue(STDOUT_FILENO, &helper->output, &helper->output_progress) < 0) {
            helper->output_failed = true;
            stop(helper, "output_failed");
        }
        if (helper->metadata.length != 0 && !helper->status_failed
            && flush_queue(3, &helper->metadata, &helper->status_progress) < 0) {
            helper->status_failed = true;
            stop(helper, "status_failed");
        }
        if (helper->output.length != 0 && elapsed(now, helper->output_progress) >= STALL_MS) {
            helper->output_failed = true;
            stop(helper, "output_stalled");
        }
        if (helper->metadata.length != 0 && elapsed(now, helper->status_progress) >= STALL_MS) {
            helper->status_failed = true;
            stop(helper, "status_stalled");
        }
        if (!helper->stopping && helper->input.length != 0
            && flush_queue(helper->master, &helper->input, NULL) < 0) {
            helper->protocol_failed = true;
            stop(helper, "pty_failed");
        }
        now = milliseconds();
        if (helper->stopping) {
            cleanup_scan(helper, now);
            if (helper->child_exited && helper->empty_scans >= 2 && helper->pty_eof
                && helper->output.length == 0) break;
            if (elapsed(now, helper->stopped_at) >= CLEANUP_MS) {
                observe_exit(helper);
                if (helper->output.length != 0) {
                    helper->output_failed = true;
                    if (helper->reason == NULL) helper->reason = "output_stalled";
                }
                if (!helper->child_exited || helper->empty_scans < 2) helper->cleanup_uncertain = true;
                if (!helper->pty_eof) helper->protocol_failed = true;
                if (helper->reason == NULL && (!helper->pty_eof || helper->cleanup_uncertain)) helper->reason = "cleanup_timeout";
                break;
            }
        }
        struct pollfd descriptors[5] = {
            { helper->control_eof ? -1 : STDIN_FILENO, POLLIN, 0 },
            { helper->output_failed ? -1 : STDOUT_FILENO, helper->output.length != 0 ? POLLOUT : 0, 0 },
            { helper->status_failed ? -1 : 3, helper->metadata.length != 0 ? POLLOUT : 0, 0 },
            { helper->master, 0, 0 },
            { helper->setup, POLLIN, 0 }
        };
        if (!helper->pty_eof && helper->output.length < helper->output.capacity) descriptors[3].events |= POLLIN;
        if (!helper->stopping && helper->input.length != 0) descriptors[3].events |= POLLOUT;
        int events = poll(descriptors, 5, 20);
        if (events < 0) {
            if (errno != EINTR) {
                helper->protocol_failed = true;
                stop(helper, "pty_failed");
            }
            continue;
        }
        if (descriptors[0].revents & (POLLIN | POLLHUP | POLLERR)) read_control(helper);
        if (descriptors[0].revents & POLLNVAL) {
            helper->control_eof = true;
            helper->protocol_failed = true;
            stop(helper, "invalid_control");
        }
        if (descriptors[1].revents & (POLLERR | POLLHUP | POLLNVAL)) {
            helper->output_failed = true;
            stop(helper, "output_failed");
        }
        if (descriptors[2].revents & (POLLERR | POLLHUP | POLLNVAL)) {
            helper->status_failed = true;
            stop(helper, "status_failed");
        }
        if (descriptors[3].revents & (POLLIN | POLLHUP | POLLERR)) read_pty(helper);
        if (descriptors[3].revents & POLLNVAL) {
            helper->protocol_failed = true;
            helper->cleanup_uncertain = true;
            stop(helper, "pty_failed");
        }
        if (helper->setup >= 0 && descriptors[4].revents & (POLLIN | POLLHUP | POLLERR)) read_setup(helper);
        if (helper->setup >= 0 && descriptors[4].revents & POLLNVAL) {
            helper->protocol_failed = true;
            stop(helper, "child_setup_failed");
        }
    }
    (void)close(helper->master);
    if (helper->setup >= 0) (void)close(helper->setup);
    return complete(helper);
}

static bool dimension(const char *text, unsigned short *value)
{
    if (*text == '\0') return false;
    unsigned result = 0;
    for (const unsigned char *at = (const unsigned char *)text; *at != '\0'; at++) {
        if (*at < '0' || *at > '9' || result > 6553U) return false;
        result = result * 10U + (unsigned)(*at - '0');
        if (result > 65535U) return false;
    }
    if (result == 0) return false;
    *value = (unsigned short)result;
    return true;
}

int main(int argc, char **argv)
{
    unsigned short columns = 0, rows = 0;
    int argument = 1;
    while (argument < argc && strcmp(argv[argument], "--") != 0) {
        if (argument + 1 >= argc) break;
        if (strcmp(argv[argument], "--cols") == 0 && columns == 0) {
            if (!dimension(argv[argument + 1], &columns)) break;
        } else if (strcmp(argv[argument], "--rows") == 0 && rows == 0) {
            if (!dimension(argv[argument + 1], &rows)) break;
        } else break;
        argument += 2;
    }
    if (columns == 0 || rows == 0 || argument + 1 >= argc
        || strcmp(argv[argument], "--") != 0 || argv[argument + 1][0] == '\0') {
        (void)fputs("koto_linux_pty: invalid_arguments\n", stderr);
        return 2;
    }
    /* pidfds are required: a check-then-kill fallback could target a reused
     * descendant PID. Refuse an unsupported kernel before spawning work. */
    int self = (int)syscall(SYS_pidfd_open, getpid(), 0);
    if (self < 0 || syscall(SYS_pidfd_send_signal, self, 0, NULL, 0) < 0) {
        if (self >= 0) (void)close(self);
        (void)fputs("koto_linux_pty: pidfd_support_required\n", stderr);
        return 2;
    }
    (void)close(self);
    if (fcntl(3, F_GETFL) < 0 || set_nonblocking(STDIN_FILENO) < 0
        || set_nonblocking(STDOUT_FILENO) < 0 || set_nonblocking(3) < 0) {
        (void)fputs("koto_linux_pty: invalid_transport\n", stderr);
        return 2;
    }
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    sigemptyset(&action.sa_mask);
    action.sa_handler = SIG_IGN;
    if (sigaction(SIGPIPE, &action, NULL) < 0) return 2;
    action.sa_handler = SIG_DFL;
    if (sigaction(SIGCHLD, &action, NULL) < 0) return 2;
    action.sa_handler = received_signal;
    if (sigaction(SIGINT, &action, NULL) < 0 || sigaction(SIGTERM, &action, NULL) < 0
        || sigaction(SIGHUP, &action, NULL) < 0) return 2;
    sigset_t unblocked;
    sigemptyset(&unblocked);
    sigaddset(&unblocked, SIGINT);
    sigaddset(&unblocked, SIGTERM);
    sigaddset(&unblocked, SIGHUP);
    sigaddset(&unblocked, SIGCHLD);
    if (sigprocmask(SIG_UNBLOCK, &unblocked, NULL) < 0) return 2;
    struct helper *helper = calloc(1, sizeof(*helper));
    if (helper == NULL) return 2;
    helper->host = getppid();
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) < 0 || getppid() != helper->host) {
        free(helper);
        return 2;
    }
    helper->master = -1;
    helper->setup = -1;
    helper->columns = columns;
    helper->rows = rows;
    helper->native_code = -1;
    helper->input = (struct queue){ helper->input_bytes, INPUT_LIMIT, 0, 0 };
    helper->output = (struct queue){ helper->output_bytes, OUTPUT_LIMIT, 0, 0 };
    helper->metadata = (struct queue){ helper->status_bytes, STATUS_LIMIT, 0, 0 };
    helper->started_at = milliseconds();
    struct winsize dimensions;
    memset(&dimensions, 0, sizeof(dimensions));
    dimensions.ws_col = columns;
    dimensions.ws_row = rows;
    int slave = -1;
    int setup[2] = { -1, -1 };
    if (host_signal != 0 || helper->host <= 1
        || openpty(&helper->master, &slave, NULL, NULL, &dimensions) < 0
        || pipe(setup) < 0 || set_cloexec(setup[0]) < 0 || set_cloexec(setup[1]) < 0
        || set_cloexec(helper->master) < 0 || set_nonblocking(helper->master) < 0
        || set_nonblocking(setup[0]) < 0) {
        (void)fputs("koto_linux_pty: startup_failed\n", stderr);
        if (helper->master >= 0) (void)close(helper->master);
        if (slave >= 0) (void)close(slave);
        if (setup[0] >= 0) (void)close(setup[0]);
        if (setup[1] >= 0) (void)close(setup[1]);
        free(helper);
        return 2;
    }
    pid_t supervisor = getpid();
    helper->child = fork();
    if (helper->child == 0) run_child(helper->master, slave, setup[1], &argv[argument + 1], supervisor);
    (void)close(slave);
    (void)close(setup[1]);
    if (helper->child < 0) {
        (void)fputs("koto_linux_pty: spawn_failed\n", stderr);
        (void)close(helper->master);
        (void)close(setup[0]);
        free(helper);
        return 2;
    }
    helper->setup = setup[0];
    helper->child_owned = true;
    int result = run_parent(helper);
    free(helper);
    return result;
}

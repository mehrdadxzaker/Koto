<div align="center" dir="rtl" lang="fa">
  <img src="assets/koto-logo.png" alt="نشان چوبی کوتو، به‌شکل حرف K و یک ساز زهی" width="168" height="168" />
  <h1>Koto</h1>
  <p dir="ltr">
    <a href="https://github.com/mehrdadxzaker/Koto/stargazers"><img src="assets/badge-github.svg" alt="به Koto در GitHub ستاره بدهید" height="20" /></a>
    <a href="LICENSE"><img src="assets/badge-license.svg" alt="مجوز Koto" height="20" /></a>
    <a href="https://github.com/mehrdadxzaker/Koto/actions/workflows/ci.yml"><img src="https://github.com/mehrdadxzaker/Koto/actions/workflows/ci.yml/badge.svg?branch=main" alt="بررسی‌های سورس" height="20" /></a>
  </p>
  <p dir="ltr"><a href="README.md" lang="en">English</a> · <strong lang="fa">فارسی</strong></p>
  <p><strong>چند عامل کدنویسی را با هم، در یک فضای کاری هماهنگ اجرا کنید.</strong></p>
  <p>به هر عامل یک <span dir="ltr">Git worktree</span> مستقل بدهید، خروجی‌اش را دنبال کنید، تغییرهایش را بازبینی کنید و نتیجه‌ها را کنار هم بیاورید.</p>
</div>

<p align="center" dir="rtl"><a href="#quick-start">شروع سریع</a> · <a href="#how-it-works">روش کار</a> · <a href="#contributing">مشارکت</a> · <a href="docs/PROJECT_SESSIONS.md">راهنمای نشست‌ها</a></p>

<div dir="rtl" lang="fa">

کوتو عامل‌هایی را هماهنگ می‌کند که از قبل استفاده می‌کنید. وظیفه، برنامهٔ اجرایی، مدل
و مجوزهای هر عامل را شما انتخاب می‌کنید. کوتو کارها را زمان‌بندی می‌کند، خروجی را زنده
نمایش می‌دهد و سهم هر عامل را تا زمان بازبینی شما جدا نگه می‌دارد. هستهٔ مشترک
JavaScript پشت CLI فعلی است؛ افزونه‌ها و رابط‌های کاربری آینده نیز از همین API استفاده خواهند کرد.

**امکانات فعلی:** نشست‌های هم‌زمان پروژه، worktreeهای مستقل Git، کنترل‌های ترمینال
و ادغام با تأیید شما. بستهٔ npm **هنوز در رجیستری منتشر نشده است**؛ آن را از سورس
اجرا کنید یا یک tarball ساخته‌شده در محیط محلی را نصب کنید.

<a id="how-it-works"></a>

## روش کار

![گردش کار کوتو: شروع از یک commit تمیز Git، اجرای Codex و OpenCode در worktreeهای جدا، بازبینی diff هرکدام و تأیید تغییرها برای ورود به شاخهٔ ادغام مستقل.](assets/collaboration-flow.svg)

| نیاز شما | امکانات کوتو |
| --- | --- |
| استفادهٔ هم‌زمان از عامل‌های مختلف | اجرای هم‌زمان با یک زمان‌بند، مالکیت مشخص وظیفه‌ها و محدودیت‌های قابل تنظیم |
| جدا نگه‌داشتن ویرایش‌ها | یک شاخه و worktree برای هر عامل، همگی از یک commit مشترک |
| مشاهده و کنترل کار | خروجی برچسب‌دار stdout/stderr، وضعیت فرایند، توقف هر عامل و ورودی اختیاری از طریق pipe |
| انتخاب تغییرهای قابل نگه‌داری | diff کامل سهم هر عامل، توکن تأیید وابسته به محتوای فعلی و ادغام ترتیبی |
| رسیدگی به ناسازگاری تغییرها | تعارض‌های قابل مشاهدهٔ Git در worktree ادغام مستقل؛ checkout اصلی حفظ می‌شود |
| افزودن رابطی دیگر در آینده | APIهای مشترک گردش کار و نشست، اعلان‌های TypeScript و یک CLI سبک که از آن‌ها استفاده می‌کند |

### مشاهده‌شده با عامل‌های واقعی

در یک [نمایش ثبت‌شده روی macOS](https://github.com/mehrdadxzaker/Koto/pull/613)،
**Codex و OpenCode با Qwen3-14B محلی** یک برنامهٔ خط فرمانِ مدیریت وظیفه ساختند.
Codex ماژول خلاصه‌سازی را نوشت و OpenCode در worktree دیگری CLI را پیاده‌سازی کرد.
اجرای بومی آن‌ها به‌مدت **25.4 ثانیه** هم‌پوشانی داشت. هر دو diff بازبینی و با توکن
بازبینی تأیید شدند، ادغام بدون تعارض انجام شد و برنامه به‌صورت دستی اجرا شد؛
چهار وظیفه و پیشرفت 25% را نمایش داد.

خطای نقل‌قول‌گذاری پوسته در تلاش اول محلی و اصلاح بعدی آن نیز در این سابقه حفظ شده‌اند:
**دو فراخوانی Codex و دو فراخوانی CLI محلی**، با تأیید پایان‌دادن به فرایندهای تحت مالکیت.
این مشاهده، شاهد یک گردش کار واقعی مبتنی بر pipe روی همان Mac است.
مقایسهٔ کیفیت مدل، سرعت و هزینه هنوز اندازه‌گیری نشده است.

<a id="quick-start"></a>

## شروع سریع

به **Node.js 22+ و Git**، یک پروژهٔ تمیز و commit‌شده، و CLIهای عامل‌ها که جداگانه
نصب شده‌اند نیاز دارید. حساب‌ها، مجوزهای بومی و هر سرور مدل محلی را پیش از شروع
کار تنظیم کنید. کوتو مدل دانلود نمی‌کند و دسترسی به ارائه‌دهنده را فراهم نمی‌کند.
npm فقط برای بسته‌بندی و فرمان‌های توسعه لازم است.
Git باید از طریق یک مسیر مطلق در PATH در دسترس باشد. از برنامهٔ اجرایی واقعی
استفاده کنید؛ wrapperهای <code dir="ltr">.cmd</code> و <code dir="ltr">.bat</code>
در Windows به ورودی اجرایی بومی یا <code dir="ltr">$node</code> همراه با مسیر اسکریپت
نیاز دارند؛ توضیح بیشتر در [راهنمای نشست‌ها](docs/PROJECT_SESSIONS.md) آمده است.

### 1. دریافت هسته

<div dir="ltr">

```sh
git clone https://github.com/mehrdadxzaker/Koto.git
cd Koto
node bin/koto.js --help
node bin/koto.js project --help
```

</div>

هیچ وابستگی زمان اجرا یا hook نصب وجود ندارد. می‌توانید CLI را مستقیماً از همین
checkout اجرا کنید.

<details>
<summary>فرمان نصب‌شده با npm را ترجیح می‌دهید؟</summary>

بسته را در محیط محلی بسازید و نصب کنید:

<div dir="ltr">

```sh
npm pack --ignore-scripts
npm install --global ./mehrdadxzaker-koto-3.0.0-alpha.0.tgz
koto project --help
```

</div>

نام درنظرگرفته‌شدهٔ بسته <code dir="ltr">@mehrdadxzaker/koto</code> است؛ انتشار در
رجیستری هنوز انجام نشده است. برای استفادهٔ محلی از npm/npx،
[راهنمای نصب](docs/INSTALLATION.md) را بخوانید. اگر فرمان قدیمی Python با نام
<code dir="ltr">koto</code> در PATH شما قرار دارد، [راهنمای مهاجرت](docs/MIGRATION.md)
را نیز ببینید.

</details>

### 2. شرح کار واقعی

یک فایل خصوصی <code dir="ltr">plan.json</code> را **خارج از پروژهٔ هدف** ذخیره کنید.
مسیر مطلق پروژه را مشخص کنید و به هر عامل یک وظیفهٔ روشن و مالکیت اعلام‌شدهٔ فایل‌ها بدهید.
پروژه باید درخت کاری تمیز و یک HEAD ثبت‌شده داشته باشد.

این مثال دو بهبود را به خود کوتو اختصاص می‌دهد. مقدار <code dir="ltr">project</code>
را به checkout تمیز خود اشاره دهید، یا وظیفه‌ها و مسیرها را متناسب با پروژهٔ خود عوض کنید.
شناسهٔ مدل محلی همان نام مستعار استفاده‌شده در نمایش Mac است؛ آن را در OpenCode
تنظیم کنید یا با نام مستعار ارائه‌دهنده/مدل محلی خود جایگزین کنید.

در اجرای مشاهده‌شده از Codex 0.164 و OpenCode 1.19.4 استفاده شد. آرگومان‌ها را با
نسخه‌های نصب‌شدهٔ خود هماهنگ کنید و اجرا را در پیش‌زمینه نگه دارید؛ کارهای daemon
خارجی در گروه فرایندِ تحت مالکیت کوتو قرار نمی‌گیرند.

<details open>
<summary>نمونهٔ برنامهٔ کار: Codex و OpenCode با Qwen محلی</summary>

<div dir="ltr">

```json
{
  "schemaVersion": 1,
  "project": "/absolute/path/to/Koto",
  "goal": "Improve terminal collaboration while keeping all interfaces on the shared core.",
  "maxConcurrency": 2,
  "timeoutMs": 300000,
  "agents": [
    {
      "id": "codex",
      "command": "codex",
      "args": ["--no-daemon", "--disable", "apps", "exec", "--json", "--model", "gpt-6.1-sol", "--sandbox", "workspace-write", "{prompt}"],
      "inputMode": "closed",
      "task": "Add a read-only session.outputTail(agentId) API with a bounded 64 KiB output tail and update its public declarations. Keep output private. Do not change the terminal renderer or add or run automated tests.",
      "owns": ["src/project-session.js", "src/core.d.ts"]
    },
    {
      "id": "local",
      "command": "opencode",
      "args": ["run", "--format", "json", "--model", "local-llama/qwen3-14b-q4_k_m", "--dir", "{workspace}", "{prompt}"],
      "inputMode": "closed",
      "task": "Make :status display a concise table with agent id, process status, pid and worktree path. Preserve existing controls. Do not change core modules or add or run automated tests.",
      "owns": ["bin/project.js"]
    }
  ]
}
```

</div>

</details>

آرگومان‌ها یک آرایه‌اند، نه یک فرمان پوسته. کوتو <code dir="ltr">{prompt}</code> و
<code dir="ltr">{workspace}</code> را جایگزین می‌کند؛ ارائه‌دهنده انتخاب نمی‌کند و
پروتکل عامل را ترجمه نمی‌کند. حساب، دسترسی به مدل و میزان مصرف در اختیار CLI بومی است.
این تنظیمات را پیش از اجرا بازبینی کنید؛ [راهنمای نشست‌ها](docs/PROJECT_SESSIONS.md)
شامل تنظیم صریح استفاده از حساب ChatGPT و کنترل‌های متغیرهای محیطی است.

گزینهٔ <code dir="ltr">inputMode: "closed"</code> پس از ورودی اختیاری EOF می‌فرستد؛
این موضوع برای stdin پایپ‌شدهٔ Codex exec مهم است. فقط زمانی
<code dir="ltr">"pipe"</code> را انتخاب کنید که CLI موردنظر از تعامل ادامه‌دار روی stdin
پشتیبانی می‌کند.

### 3. اجرا، نظارت و بازبینی

از checkout کوتو:

<div dir="ltr">

```sh
node bin/koto.js project start /absolute/private/path/plan.json
```

</div>

ترمینال برنامهٔ کار را نشان می‌دهد و پیش از اجرا از شما می‌خواهد
<code dir="ltr">start</code> را تایپ کنید. مسیر خصوصی نشست و مسیر worktree ادغام
چاپ می‌شوند. خروجی عامل‌ها همراه با نام عامل و برچسب stdout/stderr به‌صورت زنده نمایش داده می‌شود.

| فرمان ترمینال | عملکرد |
| --- | --- |
| <code dir="ltr">:status</code> | نمایش وضعیت فرایند و worktree |
| <code dir="ltr">:stop AGENT</code> / <code dir="ltr">:stop all</code> | توقف کار تحت مالکیت و حفظ ویرایش‌های ناتمام |
| <code dir="ltr">:send AGENT TEXT</code> / <code dir="ltr">:eof AGENT</code> | ارسال ورودی pipe یا EOF، در صورت فعال‌بودن و پشتیبانی CLI |
| <code dir="ltr">:inspect AGENT</code> | نمایش diff کامل و توکن بازبینی فعلی آن |
| <code dir="ltr">:integrate AGENT TOKEN</code> | ادغام همان سهم بازبینی‌شده پس از پایان فرایندهای همهٔ عامل‌های نشست |
| <code dir="ltr">:quit</code> | توقف کار باقی‌مانده و حفظ worktreeهای نشست |

پس از خروج از ترمینال نیز می‌توانید بدون اجرای عامل دیگری بازبینی و ادغام کنید:

<div dir="ltr">

```sh
node bin/koto.js project inspect /private/session/directory codex
node bin/koto.js project integrate /private/session/directory codex --approve REVIEW_TOKEN
```

</div>

ادغام در **شاخهٔ ادغامِ نشست** انجام می‌شود و هرگز مستقیماً روی شاخهٔ اصلی پروژهٔ شما
نمی‌نویسد. محتوای تغییرکرده به توکن بازبینی تازه نیاز دارد. تعارض‌ها برای حل‌شدن با
روش معمول Git قابل مشاهده می‌مانند. نتیجهٔ ادغام را بازبینی و برنامهٔ خود را اجرا کنید؛
سپس تصمیم بگیرید چگونه آن را وارد شاخهٔ معمول پروژه کنید.

برای برنامهٔ کاری که قبلاً بازبینی شده است، <code dir="ltr">--start --headless</code>
تأیید شروع اجرا را فراهم می‌کند و پس از پایان اجرا خارج می‌شود. این گزینه‌ها،
ویرایش‌های تولیدشده را تأیید نمی‌کنند. وقتی stdin/stdout به ترمینال متصل نیستند،
از این گزینه‌ها استفاده کنید.

## محدودیت‌های فعلی

| بخش | رفتار فعلی |
| --- | --- |
| ارتباط ترمینال | pipeهای معمولی. برنامه‌های تمام‌صفحهٔ ترمینال، نشست‌های PTY و درخواست‌هایی که به TTY یا ورود گذرواژه نیاز دارند پشتیبانی نمی‌شوند. |
| عامل‌های بومی | اتصال از طریق برنامهٔ اجرایی و argv خام. رکوردهای پایان کار بومی، وضعیت ساختاریافتهٔ مجوزها و ادامهٔ نشست تفسیر نمی‌شوند. |
| مجوزها | عامل‌های بومی مجوزهای میزبان خود را حفظ می‌کنند. worktreeها ویرایش‌ها را جدا می‌کنند؛ sandbox سیستم‌عامل نیستند. |
| نتیجه‌ها | خروج موفق فرایند، پایان اجرا را ثبت می‌کند. درستی نتیجه همچنان به بازبینی شما و استفادهٔ واقعی از برنامه نیاز دارد. |
| لغو | پاک‌سازی گروه فرایند در POSIX؛ فرایندهایی که خودشان از گروه جدا شوند خارج از این محدوده‌اند. توقف در Windows با تلاش حداکثری انجام می‌شود و ممکن است تأیید نشود. |
| بازیابی | اجرای دوبارهٔ خودکار عامل، بازپخش پس از خرابی یا حذف خودکار worktree وجود ندارد. CLIهای بومی ممکن است تلاش‌های مجدد خود را انجام دهند. |
| سیستم‌عامل‌ها | یک اجرای واقعی مبتنی بر pipe روی macOS ثبت شده است. CI سورس و محدودهٔ مخزن را روی Windows، macOS و Linux با Node 22/24 بررسی می‌کند؛ رفتار مدل یا زمان اجرا را تأیید نمی‌کند. |
| رابط‌ها | CLI و API مشترک پیاده‌سازی شده‌اند. افزونه‌های IDE، رابط‌های غنی‌تر ترمینال و GUI در مراحل بعد، یکی‌یکی اضافه می‌شوند. |

پرامپت‌ها، خروجی بومی و مسیرها در فایل‌های خصوصیِ محلیِ نشست نگه‌داری می‌شوند.
به‌صورت پیش‌فرض، فایل‌های کنترل در <code dir="ltr">~/.koto/sessions</code> و worktreeها
در <code dir="ltr">~/.koto/sessions-worktrees</code> قرار می‌گیرند؛ محل صریح ذخیرهٔ
کنترل‌ها باید خارج از worktreeهای پروژه باشد. این فایل‌ها پس از حذف نصب باقی می‌مانند.
اطلاعات ورود و نشست‌های خصوصی را وارد commit یا گزارش issue نکنید.
[راهنمای امنیت](SECURITY.md) و
[محدودیت‌های نشست](docs/PROJECT_SESSIONS.md#boundaries-and-retained-data) را بخوانید.

## یک هسته، چند رابط

<div dir="ltr">

```js
import { createProjectSession } from '@mehrdadxzaker/koto';

const session = await createProjectSession(plan, {
  onEvent: event => renderEvent(event)
});
const result = await session.run();
```

</div>

بسته همچنین <code dir="ltr">validateProjectPlan</code>،
<code dir="ltr">inspectProjectSession</code>، <code dir="ltr">integrateProjectSession</code>،
<code dir="ltr">validateWorkflow</code> و <code dir="ltr">runWorkflow</code> را در اختیار می‌گذارد.
گردش کارهای عمومی از قرارداد ورودی JSON در stdin و خروجی متن در stdout استفاده می‌کنند؛
نشست‌های پروژه، فرمان‌های بومی اعلام‌شده در برنامهٔ کار را اجرا می‌کنند.

ترتیب توسعه **هستهٔ کارا ← یکپارچه‌سازی با محیط‌ها ← رابط‌های کاربری بیشتر** است.
هر افزونه یا رابط کاربری از همان عملیات و رویدادهای نشست استفاده می‌کند و زمان‌بندی،
مالکیت فضای کاری یا ادغام را دوباره پیاده‌سازی نمی‌کند.
[معماری](docs/ARCHITECTURE.md)، [نقشهٔ راه](docs/ROADMAP.md) و
[محدودهٔ محصول](docs/SCOPE.md) را ببینید.

<a id="contributing"></a>

## مشارکت

از [CONTRIBUTING.md](CONTRIBUTING.md) شروع کنید، یک بهبود مشخص انتخاب کنید و رفتاری را
که مستقیماً مشاهده کرده‌اید ثبت کنید. مخزن در حال حاضر از بررسی سورس و محدوده استفاده می‌کند؛
مجموعه‌آزمون‌های خودکار و دموهای ساختگی حذف شده‌اند.

<div dir="ltr">

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

</div>

| از اینجا شروع کنید | مسئولیت |
| --- | --- |
| [src/core.js](src/core.js) | اعتبارسنجی گراف وظیفه، زمان‌بندی، وابستگی‌ها و لغو |
| [src/project-session.js](src/project-session.js) | برنامهٔ پروژه، چرخهٔ عمر نشست، رویدادها و کنترل‌های کاربر |
| [src/command-session.js](src/command-session.js) | چرخهٔ عمر برنامهٔ اجرایی با خروجی زنده، ورودی، محدودیت‌ها و پاک‌سازی |
| [src/project-workspaces.js](src/project-workspaces.js) | مالکیت worktree، ثبت diff، توکن‌های بازبینی و ادغام |
| [src/process-agent.js](src/process-agent.js) | پروتکل عمومی worker مبتنی بر JSON |
| [bin/project.js](bin/project.js) | رابط ترمینال سبک، مصرف‌کنندهٔ API نشست |
| [src/index.js](src/index.js) · [src/core.d.ts](src/core.d.ts) | exportهای عمومی و اعلان‌های TypeScript |

اطلاعات ورود مدل، اجرای سیاست مجوزها و رفتار ویژهٔ ارائه‌دهنده را در runtime یا adapter
بومیِ مربوط نگه دارید. رابط‌های جدید را سبک نگه دارید. برای گزارش اشکال، شناسهٔ نسخه،
نسخهٔ Node، سیستم‌عامل و یک نمونهٔ بازتولیدِ پاک‌شده از اطلاعات خصوصی را در
[GitHub issues](https://github.com/mehrdadxzaker/Koto/issues) ثبت کنید.
برای گزارش خصوصیِ آسیب‌پذیری، از [SECURITY.md](SECURITY.md) پیروی کنید.

از ترجمه‌ها استقبال می‌کنیم: فرمان‌ها و شناسه‌های فنی را تغییر ندهید، محتوا را با README
انگلیسی هماهنگ نگه دارید و پیوند متقابل انتخاب زبان را اضافه کنید.

[پشتیبانی](SUPPORT.md) · [نگه‌دارندگان](MAINTAINERS.md) ·
[آیین رفتار](CODE_OF_CONDUCT.md) · [مجوز Apache-2.0](LICENSE)

</div>

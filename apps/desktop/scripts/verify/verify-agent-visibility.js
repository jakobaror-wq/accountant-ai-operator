// Ad-hoc verification (not part of the repo) for two fixes addressing the
// user's live report: "the right software opens, the indicator says the
// agent is active, but nothing visible happens afterwards."
//
// Fix 1 (ai/grok.ts): the call to our next-action server had NO timeout at
// all - a hung/stalled network call blocked the whole task-runner loop
// forever with zero error and zero visible feedback. Now bounded by
// AbortController.
//
// Fix 2 (main.ts): the always-on-top indicator window showed a single
// static "agent active" message for the entire run - no way to tell
// "thinking" from "stuck". It now receives live per-step status text, and
// an "error" event now also pulls the main app window back to the front
// (in addition to the already-existing pull on awaiting-approval/answer).
//
// **עדכון (2026-10-07)**: Part 1 תוקן אחרי שינוי-השורש שהזיז את הקריאה
// מ-xAI ישירות (net.fetch Chromium + fetch Node, שני נתיבים מקומיים) לקריאה
// יחידה לשרת שלנו (apps/web/app/api/agent/next-action). מנגנון הנתיב-הכפול
// כבר לא קיים בכלל ב-grok.ts - התרחישים הישנים (1b/1c/1d שבדקו את ה-fallback
// הספציפי הזה) כבר לא ישימים, והוחלפו: תרחיש-ה-timeout-האמיתי (1a) נשאר,
// מעודכן לצורה/timeout החדשים; בדיקות ה-shape/error-labeling המהירות עברו
// ל-verify-next-action-client.js (לא דורשות המתנה אמיתית של עשרות שניות).
const { app } = require("electron");

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // ============================================================
  // Part 1: ai/grok.ts timeout behavior - real elapsed-time check
  // ============================================================
  {
    // A fetch to our own server that never resolves must still reject (not
    // hang forever), with a clearly-labeled error, in roughly the configured
    // timeout window (~50s, NEXT_ACTION_TIMEOUT_MS in grok.ts) - not instant,
    // not way past it. This is the one thing verify-next-action-client.js's
    // fast mocks can't cover - a genuinely unresolved promise that only the
    // real AbortController timer resolves.
    globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

    const grok = require(`${DIST}/ai/grok.js`);
    const start = Date.now();
    let caughtErr = null;
    try {
      await grok.requestNextAction({
        apiKey: "xai-test",
        task: "test",
        screenshotBase64: "AAAA",
        screenWidth: 100,
        screenHeight: 100,
        history: [],
        knownScreens: [],
        hasSavedCredentials: false,
      });
    } catch (err) {
      caughtErr = err;
    }
    const elapsedMs = Date.now() - start;
    check("hung fetch: rejects instead of hanging forever", caughtErr !== null);
    check(
      "hung fetch: error message clearly labeled as next-action-unreachable, not a generic failure",
      caughtErr && caughtErr.message.startsWith("next-action-unreachable:"),
    );
    check(
      `hung fetch: waited roughly the configured ~50s timeout (${elapsedMs}ms), not instant/not far past it`,
      elapsedMs > 45000 && elapsedMs < 55000,
    );
  }

  // ============================================================
  // Part 2: main.ts indicator live-status + focusMainWindow-on-error wiring
  // ============================================================
  {
    const electron = require("electron");
    const { safeStorage, shell, ipcMain, BrowserWindow } = electron;

    safeStorage.isEncryptionAvailable = () => true;
    const fakeKey = Buffer.from("k");
    safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
    safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

    const USERDATA = "/tmp/aiop-agent-visibility-test-userdata";
    app.setPath("userData", USERDATA);

    const nutJs = require(require("path").join(__dirname, "..", "..", "node_modules", "@nut-tree-fork", "nut-js"));
    const kontoWindow = {
      getTitle: async () => "קונטו - עריכת דוח",
      getRegion: async () => ({ left: 0, top: 0, width: 1000, height: 700 }),
      focus: async () => true,
    };
    nutJs.getWindows = async () => [kontoWindow];
    nutJs.getActiveWindow = async () => kontoWindow;
    shell.openPath = async () => "";

    const handlers = {};
    ipcMain.handle = (channel, listener) => {
      handlers[channel] = listener;
    };

    // Capture the two distinct BrowserWindow instances main.ts creates (the
    // main app window loads WEB_URL, https://; the indicator loads a
    // data:text/html URL) by patching loadURL, exactly like the established
    // pattern in verify-window-focus.js scenario 7 - then patch each
    // instance's own webContents.send / show / focus so we can observe what
    // main.ts actually does to each window without needing a real display.
    const indicatorStatusSends = [];
    let mainShowCalls = 0;
    let mainFocusCalls = 0;
    let indicatorWindowSeen = false;

    const originalLoadURL = BrowserWindow.prototype.loadURL;
    BrowserWindow.prototype.loadURL = function patchedLoadURL(url, ...rest) {
      if (typeof url === "string" && url.startsWith("data:text/html")) {
        indicatorWindowSeen = true;
        const originalSend = this.webContents.send.bind(this.webContents);
        this.webContents.send = (channel, ...args) => {
          if (channel === "aiop:indicator-status") indicatorStatusSends.push(args[0]);
          return originalSend(channel, ...args);
        };
        return Promise.resolve();
      }
      if (typeof url === "string" && url.startsWith("https://")) {
        const originalShow = this.show.bind(this);
        const originalFocus = this.focus.bind(this);
        this.show = (...a) => {
          mainShowCalls++;
          return originalShow(...a);
        };
        this.focus = (...a) => {
          mainFocusCalls++;
          return originalFocus(...a);
        };
      }
      return originalLoadURL.call(this, url, ...rest).catch(() => {});
    };

    const settings = require(`${DIST}/settings.js`);
    settings.setXaiApiKey("xai-dummy-key");

    delete require.cache[require.resolve(`${DIST}/main.js`)];
    delete require.cache[require.resolve(`${DIST}/window-focus.js`)];
    delete require.cache[require.resolve(`${DIST}/task-runner.js`)];
    const taskRunner = require(`${DIST}/task-runner.js`);

    // Fake run: fires one of each interesting event type in sequence, then
    // never resolves (mirrors a real run that's mid-flight) - lets us
    // inspect what main.ts did in response to each event.
    taskRunner.runComputerUseTask = async (params) => {
      params.onUpdate({ type: "step-start", step: 1 });
      params.onUpdate({
        type: "action",
        step: 1,
        reasoning: "פותח את מסך הדוחות",
        screenLabel: "מסך פתיחה",
        confidence: 0.99,
        action: { type: "click", x: 1, y: 1 },
        source: "ai",
      });
      params.onUpdate({
        type: "awaiting-approval",
        step: 2,
        reasoning: "שומר שינוי",
        confidence: 0.99,
        action: { type: "click", x: 2, y: 2 },
        source: "ai",
      });
      params.onUpdate({ type: "awaiting-answer", step: 3, question: "לאיזו חברה?" });
      params.onUpdate({ type: "error", step: 4, message: "ai-request-failed: xai-timeout: לא התקבלה תגובה" });
      return new Promise(() => {}); // stays "running" like a real in-flight task
    };

    require(`${DIST}/main.js`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const runTaskHandler = handlers["aiop:run-task"];
    const fakeEvent = { sender: { isDestroyed: () => false, send: () => {} } };
    const result = await runTaskHandler(fakeEvent, "some task", "konto");
    await new Promise((resolve) => setTimeout(resolve, 100));

    check("task starts successfully against the mocked window", result.started === true);
    check("indicator window was created", indicatorWindowSeen);
    check(
      "indicator receives a status for step-start (shows activity even before an action is decided)",
      indicatorStatusSends.some((t) => t.includes("שלב 1") && t.includes("מצלם")),
    );
    check(
      "indicator receives the AI's reasoning text for an executed action",
      indicatorStatusSends.some((t) => t.includes("פותח את מסך הדוחות")),
    );
    check(
      "indicator shows a distinct waiting-for-approval message",
      indicatorStatusSends.some((t) => t.startsWith("⏸") && t.includes("אישור")),
    );
    check(
      "indicator shows a distinct waiting-for-answer message including the actual question",
      indicatorStatusSends.some((t) => t.startsWith("❓") && t.includes("לאיזו חברה")),
    );
    check(
      "indicator shows the error message when the run fails",
      indicatorStatusSends.some((t) => t.startsWith("⚠") && t.includes("xai-timeout")),
    );
    check("main app window is shown when an error occurs (not left hidden behind the target software)", mainShowCalls >= 1);
    check("main app window is focused when an error occurs", mainFocusCalls >= 1);

    const fs = require("fs");
    try {
      fs.rmSync(USERDATA, { recursive: true, force: true });
    } catch {}
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

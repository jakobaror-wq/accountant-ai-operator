// Ad-hoc verification (not part of the repo) for two fixes addressing the
// user's live report: "the right software opens, the indicator says the
// agent is active, but nothing visible happens afterwards."
//
// Fix 1 (ai/grok.ts): net.fetch to xAI had NO timeout at all - a hung/
// stalled network call blocked the whole task-runner loop forever with zero
// error and zero visible feedback. Now bounded by AbortController.
//
// Fix 2 (main.ts): the always-on-top indicator window showed a single
// static "agent active" message for the entire run - no way to tell
// "thinking" from "stuck". It now receives live per-step status text, and
// an "error" event now also pulls the main app window back to the front
// (in addition to the already-existing pull on awaiting-approval/answer).
const { app, net: realNet } = require("electron");

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // ============================================================
  // Part 1: ai/grok.ts timeout behavior
  // ============================================================
  {
    const electron = require("electron");

    // 1a. A fetch that never resolves must still reject (not hang forever),
    // with a clearly-labeled xai-timeout error, in roughly the configured
    // timeout window (45s) - not instantly, not way past it.
    electron.net.fetch = (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    // Mock the fallback path too (deterministic, fails fast) - without this,
    // Node's real global fetch would attempt an ACTUAL outbound call to xAI's
    // real API from whatever network this test happens to run on, which is
    // exactly the kind of non-deterministic, unintended real network call a
    // test must not depend on.
    const originalGlobalFetch1a = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("fallback-mocked-failure-1a");
    };

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
    globalThis.fetch = originalGlobalFetch1a;
    check("hung fetch: rejects instead of hanging forever", caughtErr !== null);
    check(
      "hung fetch: error message clearly labeled as a timeout, not a generic failure",
      caughtErr && /xai-timeout/.test(caughtErr.message) && caughtErr.message.includes("fallback-mocked-failure-1a"),
    );
    check(
      `hung fetch: waited roughly the configured ~45s timeout (${elapsedMs}ms), not instant/not far past it`,
      elapsedMs > 40000 && elapsedMs < 50000,
    );
  }

  // 1b. Regression check: a normal, fast-resolving fetch must still work exactly as before.
  {
    const electron = require("electron");
    electron.net.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: "רואה מסך פתיחה",
                screenLabel: "מסך פתיחה",
                confidence: 0.99,
                riskClass: "read-only",
                action: { type: "click", x: 10, y: 20 },
              }),
            },
          },
        ],
      }),
    });

    delete require.cache[require.resolve(`${DIST}/ai/grok.js`)];
    const grok2 = require(`${DIST}/ai/grok.js`);
    const result = await grok2.requestNextAction({
      apiKey: "xai-test",
      task: "test",
      screenshotBase64: "AAAA",
      screenWidth: 100,
      screenHeight: 100,
      history: [],
      knownScreens: [],
      hasSavedCredentials: false,
    });
    check(
      "normal fast response: still parses correctly (no regression from adding the timeout)",
      result.action.type === "click" && result.confidence === 0.99,
    );
  }

  // 1c. **Updated 2026-09-28** for the new fallback-network-path behavior: a real
  // (non-timeout) error from the primary path (Chromium net.fetch) no longer
  // propagates immediately - it now triggers a fallback attempt via Node's
  // global fetch first (a completely separate network stack), and only if
  // THAT also fails does it throw - with a combined message naming both
  // failures, for exactly the diagnosis this update was built to provide.
  {
    const electron = require("electron");
    electron.net.fetch = async () => {
      throw new Error("ENOTFOUND api.x.ai");
    };
    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("fallback-also-unreachable");
    };
    delete require.cache[require.resolve(`${DIST}/ai/grok.js`)];
    const grok3 = require(`${DIST}/ai/grok.js`);
    let caughtErr = null;
    try {
      await grok3.requestNextAction({
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
    globalThis.fetch = originalGlobalFetch;
    check(
      "both network paths fail: the combined error names the PRIMARY (Chromium) path's real failure",
      caughtErr && caughtErr.message.includes("ENOTFOUND api.x.ai"),
    );
    check(
      "both network paths fail: the combined error ALSO names the FALLBACK (Node) path's failure",
      caughtErr && caughtErr.message.includes("fallback-also-unreachable"),
    );
  }

  // 1d. The core new behavior: primary path genuinely hangs (real ~45s timeout),
  // but the fallback (Node fetch, a separate stack) succeeds - the call should
  // succeed overall instead of failing, proving the fallback actually rescues
  // a stuck request instead of just being decorative.
  {
    const electron = require("electron");
    electron.net.fetch = (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: "נחלץ דרך הנתיב החלופי",
                screenLabel: "מסך כלשהו",
                confidence: 0.98,
                riskClass: "read-only",
                action: { type: "click", x: 5, y: 5 },
              }),
            },
          },
        ],
      }),
    });

    delete require.cache[require.resolve(`${DIST}/ai/grok.js`)];
    const grok4 = require(`${DIST}/ai/grok.js`);
    const start = Date.now();
    const result = await grok4.requestNextAction({
      apiKey: "xai-test",
      task: "test",
      screenshotBase64: "AAAA",
      screenWidth: 100,
      screenHeight: 100,
      history: [],
      knownScreens: [],
      hasSavedCredentials: false,
    });
    const elapsedMs = Date.now() - start;
    globalThis.fetch = originalGlobalFetch;

    check(
      "primary hangs but fallback succeeds: the call succeeds overall instead of failing",
      result.action.type === "click" && result.reasoning === "נחלץ דרך הנתיב החלופי",
    );
    check(
      `primary hangs but fallback succeeds: took roughly the primary's ~45s timeout before rescuing (${elapsedMs}ms), not instant`,
      elapsedMs > 40000 && elapsedMs < 55000,
    );
  }

  // restore real net.fetch for part 2 (uses nut-js/window mocks instead, doesn't call xAI)
  require("electron").net.fetch = realNet.fetch;

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

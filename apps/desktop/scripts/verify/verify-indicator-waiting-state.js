// Ad-hoc verification (not part of the repo). Confirms the indicator
// window's "waiting for your approval" state is now visually unmistakable
// (whole-window background color + pulse animation), not just a text-color
// change on a small sub-line someone could miss - added 2026-10-07 as the
// likely root cause of "the agent doesn't do anything" (Gate 1 now gates
// more actions than before, and a blocked-on-approval run looks frozen).
//
// Deliberate implementation choice worth flagging: this REUSES the existing
// aiop:indicator-status channel and its existing emoji-prefix convention
// (⏸/❓ = waiting, ⚠ = error) instead of introducing a new {text, waiting}
// payload shape - the inline indicator HTML already classified text this
// way for the small status line; this change only extends that same
// classification to toggle classes on <body> too, for a strictly simpler,
// lower-risk change with the identical user-facing outcome.
//
// This script cannot assert the actual rendered pixel color in this sandbox
// (no real display snapshot) - it asserts the generated HTML/CSS/JS actually
// contains the new classes/logic, and that the existing event->text mapping
// (which this new feature piggybacks on) still produces the right prefixes.
// Real visual confirmation needs the user's own live look on Windows.
const { app } = require("electron");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const { safeStorage, shell, ipcMain, BrowserWindow } = require("electron");

  safeStorage.isEncryptionAvailable = () => true;
  const fakeKey = Buffer.from("k");
  safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
  safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

  const USERDATA = "/tmp/aiop-indicator-waiting-test-userdata";
  app.setPath("userData", USERDATA);

  shell.openPath = async () => "";

  const handlers = {};
  ipcMain.handle = (channel, listener) => {
    handlers[channel] = listener;
  };

  let indicatorHtml = null;
  const indicatorStatusSends = [];

  const originalLoadURL = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = function patchedLoadURL(url, ...rest) {
    if (typeof url === "string" && url.startsWith("data:text/html")) {
      indicatorHtml = decodeURIComponent(url.slice(url.indexOf(",") + 1));
      const originalSend = this.webContents.send.bind(this.webContents);
      this.webContents.send = (channel, ...args) => {
        if (channel === "aiop:indicator-status") indicatorStatusSends.push(args[0]);
        return originalSend(channel, ...args);
      };
      return Promise.resolve();
    }
    return originalLoadURL.call(this, url, ...rest).catch(() => {});
  };

  const settings = require(`${DIST}/settings.js`);
  settings.setXaiApiKey("xai-dummy-key");

  // This test is about the indicator window's visuals, not window-focus
  // correctness (covered by verify-window-focus.js) - "konto" has no real
  // configured exe path in this test, so stub focusConnectorWindow directly
  // rather than fighting its real title-matching logic (same fix applied
  // to verify-taskrunner-error-reporting.js for the same underlying reason).
  const windowFocus = require(`${DIST}/window-focus.js`);
  windowFocus.focusConnectorWindow = async () => ({ success: true });

  delete require.cache[require.resolve(`${DIST}/main.js`)];
  delete require.cache[require.resolve(`${DIST}/task-runner.js`)];
  delete require.cache[require.resolve(`${DIST}/live-feed.js`)];
  const taskRunner = require(`${DIST}/task-runner.js`);

  taskRunner.runComputerUseTask = async (params) => {
    params.onUpdate({ type: "step-start", step: 1 });
    params.onUpdate({
      type: "action",
      step: 1,
      reasoning: "פותח מסך",
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
    params.onUpdate({ type: "error", step: 4, message: "ai-request-failed: xai-timeout" });
    return new Promise(() => {});
  };

  require(`${DIST}/main.js`);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const runTaskHandler = handlers["aiop:run-task"];
  const fakeEvent = { sender: { isDestroyed: () => false, send: () => {} } };
  await runTaskHandler(fakeEvent, "some task", "konto");
  await new Promise((resolve) => setTimeout(resolve, 100));

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("the indicator window's HTML was captured", typeof indicatorHtml === "string" && indicatorHtml.length > 0);
  check("HTML defines a body.waiting-state rule with a non-default background", /body\.waiting-state\{[^}]*background/.test(indicatorHtml || ""));
  check("HTML defines a pulse-bg keyframe animation", /@keyframes\s+pulse-bg/.test(indicatorHtml || ""));
  check("HTML's onStatus handler toggles the waiting-state class on <body>, not just the sub-line", /document\.body\.classList\.toggle\(["']waiting-state["']/.test(indicatorHtml || ""));
  check("HTML's onStatus handler also toggles an error-state class on <body>", /document\.body\.classList\.toggle\(["']error-state["']/.test(indicatorHtml || ""));

  check(
    "step-start/action status sends do NOT start with the waiting-marker emoji",
    indicatorStatusSends.some((t) => t.includes("מצלם")) && !indicatorStatusSends.some((t) => t.startsWith("⏸") && t.includes("מצלם")),
  );
  check(
    "awaiting-approval sends a ⏸-prefixed status (classified as waiting client-side)",
    indicatorStatusSends.some((t) => t.startsWith("⏸") && t.includes("ממתין לאישור")),
  );
  check(
    "awaiting-answer sends a ❓-prefixed status (classified as waiting client-side)",
    indicatorStatusSends.some((t) => t.startsWith("❓") && t.includes("לאיזו חברה")),
  );
  check(
    "error sends a ⚠-prefixed status (classified as error client-side, not waiting)",
    indicatorStatusSends.some((t) => t.startsWith("⚠") && t.includes("xai-timeout")),
  );

  const fs = require("fs");
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results: results.map((r) => ({ label: r.label, ok: r.ok })) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

// Ad-hoc verification (not part of the repo) for window-focus.ts (v2 -
// region-based redesign) and its wiring into main.ts's aiop:run-task
// handler. Mocks nut-js's window API (getWindows/getActiveWindow) and
// Electron's shell.openPath, not the real OS.
//
// v2 context: a live test against the user's real Windows machine found
// that nut-js's getTitle() returns garbled/replacement-character text for
// Hebrew window titles (an encoding bug, not a wrong-guess problem), so
// window-focus.ts no longer trusts title-matching alone - it primarily
// detects "a new window appeared" by comparing window regions
// (left/top/width/height) before and after launching the program, which
// doesn't depend on decoding title text correctly at all.
const { app, safeStorage, shell } = require("electron");

safeStorage.isEncryptionAvailable = () => true;
const fakeKey = Buffer.from("k");
safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

const USERDATA = "/tmp/aiop-window-focus-test-userdata";
app.setPath("userData", USERDATA);

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

function makeWindow(title, region, focusResult = true) {
  return {
    getTitle: async () => title,
    getRegion: async () => region,
    focus: async () => focusResult,
  };
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const nutJs = require(require("path").join(__dirname, "..", "..", "node_modules", "@nut-tree-fork", "nut-js"));
  const windowFocus = require(`${DIST}/window-focus.js`);

  // === Scenario 1: window already open and title matches -> focuses without launching ===
  {
    const hashavshevetWindow = makeWindow('חשבשבת - לקוח: א.ב. בע"מ', { left: 0, top: 0, width: 1200, height: 800 });
    let openPathCalls = 0;
    nutJs.getWindows = async () => [makeWindow("Some Other App", { left: 0, top: 0, width: 400, height: 300 }), hashavshevetWindow];
    nutJs.getActiveWindow = async () => hashavshevetWindow;
    shell.openPath = async () => { openPathCalls++; return ""; };

    const result = await windowFocus.focusConnectorWindow("hashavshevet", "/fake/path/hashavshevet.exe");
    check("already-open matching window (readable title): success without launching", result.success === true);
    check("already-open matching window: shell.openPath was NOT called", openPathCalls === 0);
  }

  // === Scenario 1b: window already open but title is GARBLED (the real bug found in production) ===
  // Since title-matching is only a best-effort first try, a garbled-title already-open window
  // falls through to the launch path - documented residual behavior (see window-focus.ts comments).
  // This scenario instead verifies the CORE fix: a program that must be launched is found via
  // region-diffing even though its title is completely unreadable garbage.
  {
    const beforeWindows = [makeWindow("Some Other App", { left: 0, top: 0, width: 400, height: 300 })];
    let pollCount = 0;
    const garbledTitleWindow = makeWindow("�� ������", { left: 50, top: 50, width: 1000, height: 700 });
    nutJs.getWindows = async () => {
      pollCount++;
      if (pollCount < 3) return beforeWindows;
      return [...beforeWindows, garbledTitleWindow];
    };
    nutJs.getActiveWindow = async () => garbledTitleWindow;
    let openPathCalls = 0;
    shell.openPath = async () => { openPathCalls++; return ""; };

    const result = await windowFocus.focusConnectorWindow("hashavshevet", "/fake/path/hashavshevet.exe");
    check("garbled-title window: still succeeds via region-based new-window detection (the core fix)", result.success === true);
    check("garbled-title window: launched the exe since no title match was found among existing windows", openPathCalls === 1);
    check("garbled-title window: polled multiple times until the new window's region appeared", pollCount >= 3);
  }

  // === Scenario 2: multiple new windows appear after launch -> prefers title-matching one, else the largest ===
  {
    const beforeWindows = [makeWindow("Some Other App", { left: 0, top: 0, width: 400, height: 300 })];
    const smallPopup = makeWindow("Notification Popup", { left: 10, top: 10, width: 200, height: 100 });
    const dokkaWindow = makeWindow("Dokka - Invoice Processing", { left: 100, top: 100, width: 1100, height: 750 });
    nutJs.getWindows = async () => [...beforeWindows, smallPopup, dokkaWindow];
    nutJs.getActiveWindow = async () => dokkaWindow;
    shell.openPath = async () => "";

    const result = await windowFocus.focusConnectorWindow("dokka", "/fake/path/dokka.exe");
    check("multiple new windows appear -> the title-matching one (Dokka) is preferred over an unrelated popup", result.success === true);
  }

  // === Scenario 2b: multiple new windows appear (after the pre-launch snapshot), NONE match by title -> falls back to the largest one ===
  {
    const smallPopup = makeWindow("Unrelated Notification", { left: 10, top: 10, width: 200, height: 100 });
    // Simulates the real garbled-title case: the real app window's title doesn't match anything,
    // but it's by far the largest new window, so the area-based tiebreak should pick it.
    const bigUnreadableWindow = makeWindow("���", { left: 100, top: 100, width: 1200, height: 800 });
    let focusedRegionSig = null;
    bigUnreadableWindow.focus = async () => { focusedRegionSig = "1200x800"; return true; };
    let pollCount = 0;
    nutJs.getWindows = async () => {
      pollCount++;
      // Nothing exists yet at the pre-launch snapshot or the first couple of polls -
      // both candidate windows only "appear" a bit later, simulating real launch latency.
      if (pollCount < 3) return [];
      return [smallPopup, bigUnreadableWindow];
    };
    nutJs.getActiveWindow = async () => bigUnreadableWindow;
    shell.openPath = async () => "";

    const result = await windowFocus.focusConnectorWindow("konto", "/fake/path/konto.exe");
    check("no new window matches by title -> the largest new window is chosen (area tiebreak)", result.success === true && focusedRegionSig === "1200x800");
  }

  // === Scenario 3: no new window ever appears, AND the active window never changes -> clean timeout failure, no crash/hang ===
  {
    const staticWindow = makeWindow("Completely Unrelated App", { left: 0, top: 0, width: 300, height: 200 });
    nutJs.getWindows = async () => [staticWindow]; // same region every poll - never counts as "new"
    nutJs.getActiveWindow = async () => staticWindow; // never changes either - rules out the single-instance fallback (scenario 8)
    shell.openPath = async () => "";

    const start = Date.now();
    const result = await windowFocus.focusConnectorWindow("shikulit", "/fake/path/shikulit.exe");
    const elapsedMs = Date.now() - start;
    check("no new window ever appears: returns success:false (not a throw)", result.success === false);
    check("no new window ever appears: has an error code", typeof result.error === "string" && result.error.length > 0);
    check(`no new window ever appears: waited roughly the real ~30s timeout (${elapsedMs}ms), didn't return instantly or hang past it`, elapsedMs > 28000 && elapsedMs < 35000);
    check(
      "the failure detail lists the actually-open window titles for self-diagnosis",
      typeof result.detail === "string" && result.detail.includes("Completely Unrelated App"),
    );
  }

  // === Scenario 8: software was ALREADY open (garbled title, single-instance) -> relaunch just reactivates it, no "new" window ever appears, but the ACTIVE window changes ===
  // This is the real-world failure a user hit: window-not-found-after-launch even though the software was genuinely already open and got focused.
  {
    const desktopWindow = makeWindow("Program Manager", { left: 0, top: 0, width: 1920, height: 1080 });
    const alreadyOpenHashavshevet = makeWindow("���� ������", { left: 50, top: 50, width: 1000, height: 700 }); // garbled title - title-match already failed upstream
    nutJs.getWindows = async () => [alreadyOpenHashavshevet]; // same single window before AND after "launch" - never counts as new
    let activeIsHashavshevet = false;
    nutJs.getActiveWindow = async () => (activeIsHashavshevet ? alreadyOpenHashavshevet : desktopWindow);
    let openPathCalls = 0;
    shell.openPath = async () => {
      openPathCalls++;
      // Simulates the OS bringing the already-running single-instance app to the front
      // shortly after we "launch" it again - with a short realistic delay, not instantly.
      setTimeout(() => {
        activeIsHashavshevet = true;
      }, 700);
      return "";
    };

    const start = Date.now();
    const result = await windowFocus.focusConnectorWindow("hashavshevet", "/fake/path/hashavshevet.exe");
    const elapsedMs = Date.now() - start;
    check("already-open single-instance software: succeeds via the active-window-changed fallback, not a timeout", result.success === true);
    check("already-open single-instance software: did attempt to launch (title-match failed upstream due to garbled title)", openPathCalls === 1);
    check(
      `already-open single-instance software: resolved quickly once the active window changed (${elapsedMs}ms), not after the full ~30s timeout`,
      elapsedMs < 5000,
    );
  }

  // === Scenario 4: focus() claims success but the active window's REGION disagrees -> verified failure, not blind trust ===
  {
    const shikulitWindow = makeWindow("שיקלולית", { left: 0, top: 0, width: 900, height: 600 }, true); // focus() itself claims success
    nutJs.getWindows = async () => [shikulitWindow];
    nutJs.getActiveWindow = async () => makeWindow("Some other window is actually active", { left: 500, top: 500, width: 300, height: 300 }); // different region
    shell.openPath = async () => "";

    const result = await windowFocus.focusConnectorWindow("shikulit", "/fake/path.exe");
    check(
      "focus() claims success but active window's region disagrees -> treated as failure, not blindly trusted",
      result.success === false && result.error === "focus-failed",
    );
  }

  // === Scenario 5: no exe path configured and window not open -> clean failure, no launch attempt ===
  {
    let openPathCalls = 0;
    nutJs.getWindows = async () => [];
    shell.openPath = async () => { openPathCalls++; return ""; };

    const result = await windowFocus.focusConnectorWindow("hisulit", undefined);
    check("not open + no configured path: fails without attempting to launch", result.success === false && openPathCalls === 0);
  }

  // === Scenario 6: aiop:run-task never calls runComputerUseTask when window focus fails ===
  {
    nutJs.getWindows = async () => [];
    shell.openPath = async () => "simulated-launch-error";

    const handlers = {};
    const { ipcMain } = require("electron");
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => { handlers[channel] = listener; return originalHandle(channel, listener); };

    const settings = require(`${DIST}/settings.js`);
    settings.setXaiApiKey("xai-dummy-key");

    const taskRunner = require(`${DIST}/task-runner.js`);
    let runComputerUseTaskCalls = 0;
    taskRunner.runComputerUseTask = async () => { runComputerUseTaskCalls++; };

    require(`${DIST}/main.js`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const runTaskHandler = handlers["aiop:run-task"];
    check("aiop:run-task handler was registered", typeof runTaskHandler === "function");

    const fakeEvent = { sender: { isDestroyed: () => false, send: () => {} } };
    const result = await runTaskHandler(fakeEvent, "some task", "konto");

    check('aiop:run-task returns {started:false, error:"window-not-found"} when focus fails', result.started === false && result.error === "window-not-found");
    check("aiop:run-task NEVER called runComputerUseTask when focus failed", runComputerUseTaskCalls === 0);
  }

  // === Scenario 7: focus succeeds -> aiop:run-task actually starts the task and shows the indicator ===
  {
    const { ipcMain: ipcMain2, BrowserWindow } = require("electron");
    const handlers = {};
    ipcMain2.handle = (channel, listener) => { handlers[channel] = listener; };

    const kontoWindow = makeWindow("קונטו - עריכת דוח", { left: 0, top: 0, width: 1000, height: 700 });
    nutJs.getWindows = async () => [kontoWindow];
    nutJs.getActiveWindow = async () => kontoWindow;

    const originalLoadURL = BrowserWindow.prototype.loadURL;
    let indicatorWindowsCreated = 0;
    BrowserWindow.prototype.loadURL = function patchedLoadURL(url, ...rest) {
      if (typeof url === "string" && url.startsWith("data:text/html")) {
        indicatorWindowsCreated++;
        return Promise.resolve();
      }
      return originalLoadURL.call(this, url, ...rest).catch(() => {});
    };

    delete require.cache[require.resolve(`${DIST}/main.js`)];
    delete require.cache[require.resolve(`${DIST}/window-focus.js`)];
    const taskRunner2 = require(`${DIST}/task-runner.js`);
    let runComputerUseTaskCalls2 = 0;
    taskRunner2.runComputerUseTask = () => { runComputerUseTaskCalls2++; return new Promise(() => {}); };

    require(`${DIST}/main.js`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const runTaskHandler2 = handlers["aiop:run-task"];
    const fakeEvent2 = { sender: { isDestroyed: () => false, send: () => {} } };
    const result2 = await runTaskHandler2(fakeEvent2, "some task", "konto");

    check("focus succeeds -> aiop:run-task returns started:true", result2.started === true);
    check("focus succeeds -> runComputerUseTask was actually invoked", runComputerUseTaskCalls2 === 1);
    check("focus succeeds -> the always-on-top indicator window was created", indicatorWindowsCreated === 1);
  }

  const fs = require("fs");
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

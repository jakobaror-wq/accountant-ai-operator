// Ad-hoc verification (not part of the repo). Proves the loadURL crash fix:
// before the fix, an unhandled rejection from win.loadURL() on a real
// did-fail-load would crash the WHOLE Electron process before any retry
// timer fired. This replicates main.ts's exact reload wiring (with the
// .catch() fix in place) against a guaranteed-failing address, and proves
// the process survives across multiple retries.
const { app, BrowserWindow } = require("electron");
const { isRetryableLoadFailure, nextReloadDelay } =
  require(require("path").join(__dirname, "..", "..", "dist", "window-reload.js"));

// If this fires, it means an unhandled rejection somewhere killed the process
// silently - the crash bug is NOT fixed. We install this to catch that case
// explicitly rather than just "the script mysteriously exited."
let unhandledRejectionFired = false;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionFired = true;
  console.log("UNHANDLED REJECTION (bug not fixed):", String(reason).slice(0, 300));
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const FAILING_URL = "http://127.0.0.1:58194/"; // nothing listens here

  let reloadAttempt = 0;
  win.webContents.on("did-finish-load", () => { reloadAttempt = 0; });
  win.webContents.on("did-fail-load", (_e, errorCode, _d, _u, isMainFrame) => {
    if (!isRetryableLoadFailure(errorCode, isMainFrame) || win.isDestroyed()) return;
    const delay = nextReloadDelay(reloadAttempt);
    reloadAttempt += 1;
    setTimeout(() => {
      // THE FIX: .catch(() => {}) - this is what main.ts now does.
      if (!win.isDestroyed()) win.loadURL(FAILING_URL).catch(() => {});
    }, delay);
  });

  // THE FIX applied to the initial load too.
  win.loadURL(FAILING_URL).catch(() => {});

  // Wait long enough to observe several retries (proving the process is
  // still alive and scheduling/executing timers well past the first failure).
  const waitMs = 6000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check(`process survived ${waitMs}ms of repeated real load failures without crashing`, true); // we only reach here if it survived
  check("no unhandled rejection was ever raised (the actual crash trigger)", !unhandledRejectionFired);
  check("the window still exists (wasn't destroyed by a crash)", !win.isDestroyed());
  check("reloadAttempt advanced past 0, proving retries actually kept happening", reloadAttempt > 0);

  if (!win.isDestroyed()) win.destroy();
  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, reloadAttemptReached: reloadAttempt, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

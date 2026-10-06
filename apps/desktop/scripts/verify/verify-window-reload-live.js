// Ad-hoc verification (not part of the repo). Recreates main.ts's exact
// did-fail-load/did-finish-load wiring on a REAL BrowserWindow pointed at a
// guaranteed-failing address, to confirm the Electron event names/argument
// order are actually correct (not just the pure decision logic in isolation).
const { app, BrowserWindow } = require("electron");
const { isRetryableLoadFailure, nextReloadDelay } =
  require(require("path").join(__dirname, "..", "..", "dist", "window-reload.js"));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });

  const loadAttempts = [];
  const originalLoadURL = win.loadURL.bind(win);
  win.loadURL = (url) => {
    loadAttempts.push(Date.now());
    return originalLoadURL(url);
  };

  const FAILING_URL = "http://127.0.0.1:58193/"; // nothing listens here - guaranteed ECONNREFUSED, not a Chromium-restricted port

  let reloadAttempt = 0;
  win.webContents.on("did-finish-load", () => {
    reloadAttempt = 0;
  });
  win.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isRetryableLoadFailure(errorCode, isMainFrame) || win.isDestroyed()) return;
    const delay = nextReloadDelay(reloadAttempt);
    reloadAttempt += 1;
    setTimeout(() => {
      if (!win.isDestroyed()) void win.loadURL(FAILING_URL);
    }, delay);
  });

  void win.loadURL(FAILING_URL);

  // Wait long enough to observe the first two retries (base 2s + second 4s = ~6s, give it 7s).
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("the initial load was attempted", loadAttempts.length >= 1);
  check("did-fail-load actually fired and triggered at least one retry", loadAttempts.length >= 2);
  check("a second retry also happened within the observation window", loadAttempts.length >= 3);
  if (loadAttempts.length >= 2) {
    const gap1 = loadAttempts[1] - loadAttempts[0];
    check("the first retry gap is roughly the base delay (~2s, allow 1.5-3s)", gap1 >= 1500 && gap1 <= 3500);
  }
  if (loadAttempts.length >= 3) {
    const gap2 = loadAttempts[2] - loadAttempts[1];
    check("the second retry gap is roughly double (~4s, allow 3-5.5s)", gap2 >= 3000 && gap2 <= 5500);
  }

  if (!win.isDestroyed()) win.destroy();
  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, loadAttemptCount: loadAttempts.length, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

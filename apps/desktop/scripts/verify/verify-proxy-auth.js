// Ad-hoc verification (not part of the repo) for the proxy-authentication
// fix in main.ts (2026-09-26). Live user evidence: a normal browser on the
// SAME machine reached https://api.x.ai fine, but our Electron app's
// net.fetch always hung for exactly 45s (our own timeout value) - the
// classic signature of an authenticated corporate proxy (NTLM/Kerberos)
// that browsers pass through transparently via Windows integrated auth,
// but that a fresh Electron/Chromium app does NOT do automatically unless
// the host is explicitly whitelisted - and without an app.on('login')
// handler, an unhandled auth challenge just hangs forever rather than
// failing fast.
const { app } = require("electron");

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // Requiring main.js runs its top-level statements, including the
  // commandLine.appendSwitch calls and the app.on('login', ...)
  // registration - both must happen unconditionally at module load, not
  // inside app.whenReady().then(), since command-line switches must be set
  // before the app is considered ready.
  require(`${DIST}/main.js`);
  await new Promise((resolve) => setTimeout(resolve, 100));

  check(
    "auth-server-whitelist switch was set to '*' (enables transparent NTLM/Kerberos passthrough, matching what a browser does)",
    app.commandLine.getSwitchValue("auth-server-whitelist") === "*",
  );
  check(
    "auth-negotiate-delegate-whitelist switch was also set to '*'",
    app.commandLine.getSwitchValue("auth-negotiate-delegate-whitelist") === "*",
  );

  // Simulate an unhandled proxy/server auth challenge (e.g. Basic/Digest,
  // where the whitelist above doesn't help) and confirm our handler denies
  // it IMMEDIATELY - converting what used to be a silent 45s hang into an
  // instant, clear failure - instead of doing nothing (which is exactly
  // what leaves Electron waiting forever for credentials that never come).
  {
    let preventDefaultCalled = false;
    let callbackCalledWithArgs = null;
    const fakeEvent = { preventDefault: () => { preventDefaultCalled = true; } };
    const fakeCallback = (...args) => { callbackCalledWithArgs = args; };

    const listeners = app.listeners("login");
    check("an app.on('login', ...) handler is actually registered", listeners.length > 0);

    app.emit("login", fakeEvent, {}, {}, {}, fakeCallback);

    check("unhandled login challenge: event.preventDefault() was called (stops Electron's default hang-and-wait)", preventDefaultCalled);
    check(
      "unhandled login challenge: callback was invoked immediately with no credentials (fails fast instead of hanging)",
      callbackCalledWithArgs !== null && callbackCalledWithArgs.length === 0,
    );
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

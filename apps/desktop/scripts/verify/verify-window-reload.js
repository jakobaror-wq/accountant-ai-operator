// Ad-hoc verification (not part of the repo). Tests the pure retry-decision
// logic used by main.ts's auto-reload-on-load-failure feature.
const { isRetryableLoadFailure, nextReloadDelay, RELOAD_BASE_DELAY_MS, RELOAD_MAX_DELAY_MS } =
  require(require("path").join(__dirname, "..", "..", "dist", "window-reload.js"));

const results = [];
function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

// Real failures should be retried.
check("a generic network failure on the main frame is retryable", isRetryableLoadFailure(-105 /* ERR_NAME_NOT_RESOLVED */, true) === true);
check("connection refused on the main frame is retryable", isRetryableLoadFailure(-102 /* ERR_CONNECTION_REFUSED */, true) === true);
check("internet disconnected on the main frame is retryable", isRetryableLoadFailure(-106 /* ERR_INTERNET_DISCONNECTED */, true) === true);

// Should NOT retry: ERR_ABORTED (a normal navigation-away, not a real failure).
check("ERR_ABORTED (-3) on the main frame is NOT retryable", isRetryableLoadFailure(-3, true) === false);

// Should NOT retry: a failure in a sub-frame/iframe, not the main page itself.
check("a failure on a non-main-frame is NOT retryable", isRetryableLoadFailure(-105, false) === false);

// Backoff: should double each attempt, starting at the base delay, capped at the max.
check("attempt 0 uses the base delay", nextReloadDelay(0) === RELOAD_BASE_DELAY_MS);
check("attempt 1 doubles the delay", nextReloadDelay(1) === RELOAD_BASE_DELAY_MS * 2);
check("attempt 2 quadruples the delay", nextReloadDelay(2) === RELOAD_BASE_DELAY_MS * 4);
check("a very high attempt count is capped at the max delay, doesn't grow unbounded", nextReloadDelay(20) === RELOAD_MAX_DELAY_MS);
check("delay is monotonically non-decreasing across attempts", (() => {
  let prev = -1;
  for (let i = 0; i < 15; i++) {
    const d = nextReloadDelay(i);
    if (d < prev) return false;
    prev = d;
  }
  return true;
})());

const allOk = results.every((r) => r.ok);
console.log(JSON.stringify({ allOk, results }, null, 2));
process.exit(allOk ? 0 : 1);

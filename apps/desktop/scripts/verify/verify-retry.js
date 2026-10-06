// Ad-hoc verification (not part of the repo). Confirms requestNextActionWithRetry:
// (1) retries transient/network errors and succeeds once the AI call recovers,
// (2) does NOT retry a definitive 4xx error like a bad API key - fails fast instead,
// (3) gives up and reports failure after exhausting retries on a persistent transient error.
const { app } = require("electron");
app.setPath("userData", "/tmp/aiop-retry-test-userdata");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const computerUse = require(`${DIST}/computer-use.js`);
  computerUse.captureScreenshot = async () => ({
    base64Png: "AAAA", width: 1000, height: 800, visionBase64Png: "AAAA", visionWidth: 1000, visionHeight: 800,
  });
  const executedActions = [];
  computerUse.executeAction = async (a) => { executedActions.push(a); };

  const grok = require(`${DIST}/ai/grok.js`);
  const taskRunner = require(`${DIST}/task-runner.js`);
  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  async function runOnce() {
    const events = [];
    await taskRunner.runComputerUseTask({
      apiKey: "dummy", task: "test", connectorId: "c1", knownScreens: [],
      onUpdate: (e) => events.push(e),
      shouldStop: () => false,
      waitForApproval: async () => ({ approved: true }),
      waitForAnswer: async () => "",
    });
    return events;
  }

  // Scenario 1: fails twice with a transient network error, then succeeds -> task completes normally.
  {
    let callCount = 0;
    grok.requestNextAction = async () => {
      callCount += 1;
      if (callCount <= 2) throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
      return { reasoning: "ok", screenLabel: "s", confidence: 0.99, requiresApproval: false, action: { type: "done", summary: "done" } };
    };
    const t0 = Date.now();
    const events = await runOnce();
    const elapsed = Date.now() - t0;
    check("scenario 1: task ultimately succeeds despite 2 transient failures", events.some((e) => e.type === "done"));
    check("scenario 1: the AI function was called 3 times (2 failed retries + 1 success)", callCount === 3);
    check("scenario 1: retries actually waited (took at least ~2.5s for two 1.5s backoffs)", elapsed >= 2500);
  }

  // Scenario 2: a definitive bad-API-key error (400) should NOT be retried - fails immediately.
  {
    let callCount = 0;
    grok.requestNextAction = async () => {
      callCount += 1;
      throw new Error('xai-error:400:{"code":"invalid-argument","error":"Incorrect API key provided."}');
    };
    const t0 = Date.now();
    const events = await runOnce();
    const elapsed = Date.now() - t0;
    check("scenario 2: a bad-API-key error is called only ONCE (no wasted retries)", callCount === 1);
    check("scenario 2: task reports error (not silently hangs)", events.some((e) => e.type === "error"));
    check("scenario 2: no retry delay was incurred (fast failure)", elapsed < 1000);
  }

  // Scenario 3: persistent transient error (always fails with 500) - gives up after MAX_AI_RETRIES and reports clearly.
  {
    let callCount = 0;
    grok.requestNextAction = async () => {
      callCount += 1;
      throw new Error("xai-error:503:service unavailable");
    };
    const events = await runOnce();
    check("scenario 3: gives up after exhausting retries (3 attempts total: 1 + 2 retries)", callCount === 3);
    const errorEvent = events.find((e) => e.type === "error");
    check("scenario 3: reports a clear error event after giving up", Boolean(errorEvent) && errorEvent.message.includes("ai-request-failed"));
  }

  check("nothing was ever executed on the keyboard except the final successful 'done' (no action)", executedActions.length === 0);

  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-retry-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

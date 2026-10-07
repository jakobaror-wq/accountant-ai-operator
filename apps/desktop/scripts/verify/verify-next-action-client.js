// Ad-hoc verification (not part of the repo). Confirms ai/grok.ts's
// requestNextAction() behaves correctly now that it calls OUR OWN server
// (apps/web/app/api/agent/next-action) instead of api.x.ai directly -
// added 2026-10-07 after live evidence showed both independent network
// stacks (Chromium net.fetch, Node fetch) timing out identically reaching
// api.x.ai from the user's network (infrastructure-level block, not a
// code bug). Mocks the global fetch - no real network call, no real
// Vercel deployment needed to verify the client-side logic.
const { app } = require("electron");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const grok = require(`${DIST}/ai/grok.js`);

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  const baseParams = {
    apiKey: "xai-test-key",
    task: "test task",
    screenshotBase64: "AAAA",
    screenWidth: 100,
    screenHeight: 100,
    history: [],
    knownScreens: [],
    hasSavedCredentials: false,
  };

  // === Scenario 1: successful response - request shape + response defaulting ===
  {
    let capturedUrl = null;
    let capturedInit = null;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          reasoning: "test reasoning",
          screenLabel: "test screen",
          confidence: 0.99,
          riskClass: "read-only",
          action: { type: "click", x: 1, y: 1 },
        }),
        text: async () => "",
      };
    };

    const result = await grok.requestNextAction(baseParams);

    check("calls a URL ending in /api/agent/next-action, not api.x.ai directly", capturedUrl.endsWith("/api/agent/next-action") && !capturedUrl.includes("x.ai"));
    check("sends POST with JSON content-type", capturedInit.method === "POST" && capturedInit.headers["Content-Type"] === "application/json");
    const sentBody = JSON.parse(capturedInit.body);
    check("request body includes the apiKey (forwarded per-request, as designed)", sentBody.apiKey === "xai-test-key");
    check("request body includes task/screenshotBase64", sentBody.task === "test task" && sentBody.screenshotBase64 === "AAAA");
    check("does NOT set an Authorization header itself (xAI auth now happens server-side)", !("Authorization" in capturedInit.headers));
    check("parses a clean successful response correctly", result.action.type === "click" && result.reasoning === "test reasoning");
  }

  // === Scenario 2: our server reports an xAI-side error (xai-error) - must
  // reconstruct the exact "xai-error:STATUS:" message shape task-runner.ts's
  // isRetryableAiError() depends on ===
  {
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "xai-error", status: 429, detail: "rate limited" }),
      text: async () => JSON.stringify({ error: "xai-error", status: 429, detail: "rate limited" }),
    });
    let caught = null;
    try {
      await grok.requestNextAction(baseParams);
    } catch (err) {
      caught = err;
    }
    check("an xai-error response throws with the xai-error:STATUS: prefix (status 429, not our own 502)", caught && caught.message.startsWith("xai-error:429:"));
    check("the error message includes the detail text", caught && caught.message.includes("rate limited"));
  }

  // === Scenario 3: our server itself failed to reach xAI (xai-unreachable) -
  // must NOT be mislabeled as "xai-error:unreachable:" (that would corrupt
  // isRetryableAiError's \d+ status parsing) ===
  {
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "xai-unreachable", detail: "xAI timed out from our server" }),
      text: async () => JSON.stringify({ error: "xai-unreachable", detail: "xAI timed out from our server" }),
    });
    let caught = null;
    try {
      await grok.requestNextAction(baseParams);
    } catch (err) {
      caught = err;
    }
    check(
      "an xai-unreachable response does NOT use the xai-error:STATUS: prefix (no real xAI status to report)",
      caught && !/^xai-error:\d+:/.test(caught.message),
    );
    check("but is still clearly labeled and includes the detail", caught && caught.message.includes("xai-unreachable") && caught.message.includes("xAI timed out"));
  }

  // === Scenario 4: our own server (WEB_URL) is unreachable entirely (network
  // failure before any HTTP response) - distinct label from xai-timeout,
  // since this is now a failure reaching OUR server, not xAI ===
  {
    globalThis.fetch = async () => {
      const err = new Error("fetch failed");
      err.cause = new Error("ECONNREFUSED");
      throw err;
    };
    let caught = null;
    try {
      await grok.requestNextAction(baseParams);
    } catch (err) {
      caught = err;
    }
    check(
      "a network failure reaching our own server is labeled 'next-action-unreachable', not 'xai-timeout'",
      caught && caught.message.startsWith("next-action-unreachable:"),
    );
  }

  // === Scenario 5: malformed response still fails closed ===
  {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reasoning: "no action field here" }),
      text: async () => "",
    });
    let caught = null;
    try {
      await grok.requestNextAction(baseParams);
    } catch (err) {
      caught = err;
    }
    check("a response missing action.type throws xai-malformed-response", caught && caught.message === "xai-malformed-response");
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results: results.map((r) => ({ label: r.label, ok: r.ok })) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

// Ad-hoc verification (not part of the repo) for Gate 1 - the deterministic
// approval engine added 2026-10-05. Core claim under test: the AI no longer
// decides "does this need approval" directly (requiresApproval:boolean) -
// it classifies WHAT KIND of action this is (riskClass, a closed enum), and
// safety/policy-engine.ts (code, not the model) decides whether that
// category requires human approval. This must hold even when the model
// returns something invalid/unexpected (fail-closed).
const { app } = require("electron");

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const policy = require(`${DIST}/safety/policy-engine.js`);

  // === Part 1: pure policy-engine.ts unit tests (no mocking needed - zero Electron deps) ===
  check("read-only does NOT require approval", policy.requiresHumanApproval("read-only") === false);
  check("navigation does NOT require approval", policy.requiresHumanApproval("navigation") === false);
  check("reversible-edit does NOT require approval", policy.requiresHumanApproval("reversible-edit") === false);
  check(
    "external-side-effect (file export/print) DOES require approval - new, stricter policy vs. the old system prompt",
    policy.requiresHumanApproval("external-side-effect") === true,
  );
  check("final-commit DOES require approval", policy.requiresHumanApproval("final-commit") === true);
  check("unknown DOES require approval (fail-closed default)", policy.requiresHumanApproval("unknown") === true);
  check("isValidRiskClass accepts a real category", policy.isValidRiskClass("final-commit") === true);
  check("isValidRiskClass rejects an invented/invalid string", policy.isValidRiskClass("safe") === false);
  check("isValidRiskClass rejects non-string input", policy.isValidRiskClass(42) === false && policy.isValidRiskClass(undefined) === false);

  // === Part 2: ai/grok.ts actually enforces fail-closed parsing - the model
  // can't bypass the policy by returning an invalid/missing riskClass string ===
  // **עדכון (2026-10-07)**: grok.ts כבר לא קורא ל-xAI ישירות (net.fetch) -
  // הוא קורא לשרת שלנו (fetch הגלובלי), שכבר מחזיר JSON שטוח (לא את מעטפת
  // ה-chat/completions המקורית של xAI - זה נפתר בצד השרת עכשיו). המוק כאן
  // משקף את זה.
  {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reasoning: "test",
        screenLabel: "test",
        confidence: 0.99,
        riskClass: "safe", // NOT a real category - model inventing its own label
        action: { type: "click", x: 1, y: 1 },
      }),
    });
    const grok = require(`${DIST}/ai/grok.js`);
    const result = await grok.requestNextAction({
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
      "an invalid riskClass string from the model falls back to 'unknown', not silently accepted",
      result.riskClass === "unknown",
    );
    check("...and 'unknown' is enforced by policy-engine as requiring approval", policy.requiresHumanApproval(result.riskClass) === true);
  }

  // === Part 3: a MISSING riskClass field entirely also fails closed ===
  {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reasoning: "test",
        screenLabel: "test",
        confidence: 0.99,
        // riskClass omitted entirely
        action: { type: "click", x: 1, y: 1 },
      }),
    });
    delete require.cache[require.resolve(`${DIST}/ai/grok.js`)];
    const grok2 = require(`${DIST}/ai/grok.js`);
    const result2 = await grok2.requestNextAction({
      apiKey: "xai-test",
      task: "test",
      screenshotBase64: "AAAA",
      screenWidth: 100,
      screenHeight: 100,
      history: [],
      knownScreens: [],
      hasSavedCredentials: false,
    });
    check("a MISSING riskClass field also falls back to 'unknown' (fail-closed)", result2.riskClass === "unknown");
  }

  // === Part 4: ask/done/type_credential are always forced to read-only, regardless of what the model sends ===
  {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reasoning: "asking a question",
        screenLabel: "test",
        confidence: 0.99,
        riskClass: "final-commit", // model nonsensically claims this, should be overridden
        action: { type: "ask", question: "which client?" },
      }),
    });
    delete require.cache[require.resolve(`${DIST}/ai/grok.js`)];
    const grok3 = require(`${DIST}/ai/grok.js`);
    const result3 = await grok3.requestNextAction({
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
      "ask/done/type_credential actions are forced to 'read-only' regardless of what riskClass the model sent",
      result3.riskClass === "read-only",
    );
  }

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

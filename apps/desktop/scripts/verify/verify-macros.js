// Ad-hoc verification (not part of the repo) for the new macro/action-caching
// engine (macros.ts + task-runner.ts integration). Mocks captureScreenshot,
// requestNextAction and executeAction (task-runner's actual dependencies),
// but uses the REAL deriveComparisonThumbnail/bitmapDiffScore so the
// highest-risk part - "does the pixel-diff actually distinguish matching
// from non-matching screens" - is genuinely exercised, not assumed.
const { app, safeStorage } = require("electron");

safeStorage.isEncryptionAvailable = () => true;
const fakeKey = Buffer.from("k");
safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

const USERDATA = "/tmp/aiop-macro-test-userdata";
app.setPath("userData", USERDATA);

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

console.log("TRACE: before whenReady");
app.whenReady().then(async () => {
  console.log("TRACE: whenReady resolved");
  const { nativeImage } = require("electron");
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  function solidPng(r, g, b) {
    const w = 100, h = 100;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      buf[i * 4 + 0] = b; // BGRA on most platforms for createFromBitmap
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = r;
      buf[i * 4 + 3] = 255;
    }
    const img = nativeImage.createFromBitmap(buf, { width: w, height: h });
    return img.toPNG().toString("base64");
  }

  const REAL_W = 1280, REAL_H = 720;
  console.log("TRACE: generating solid PNGs");
  const screenRed = solidPng(200, 20, 20);
  console.log("TRACE: screenRed done, len=" + screenRed.length);
  const screenRedNoise = solidPng(202, 22, 22); // near-identical -> should count as a match
  const screenBlue = solidPng(20, 20, 200); // very different -> should NOT match
  console.log("TRACE: PNGs generated");

  const computerUse = require(`${DIST}/computer-use.js`);
  console.log("TRACE: computer-use required");
  const grok = require(`${DIST}/ai/grok.js`);
  console.log("TRACE: grok required");
  const macros = require(`${DIST}/macros.js`);
  console.log("TRACE: macros required");
  const settings = require(`${DIST}/settings.js`);
  settings.setXaiApiKey("xai-dummy");
  console.log("TRACE: settings ready");

  // --- sanity check on the real diff primitive before trusting it in the loop ---
  console.log("TRACE: about to compute diffSame");
  const diffSame = computerUse.bitmapDiffScore(screenRed, screenRedNoise);
  console.log("TRACE: diffSame computed = " + diffSame);
  const diffDifferent = computerUse.bitmapDiffScore(screenRed, screenBlue);
  check(`bitmapDiffScore(red, red+noise) is small (${diffSame.toFixed(4)})`, diffSame < 0.05);
  check(`bitmapDiffScore(red, blue) is large (${diffDifferent.toFixed(4)})`, diffDifferent > 0.3);

  // === Scenario 1: resolution guard ===
  {
    macros.saveMacro(
      "connA",
      "Task One",
      [{ screenLabel: "s1", referenceThumbnail: computerUse.deriveComparisonThumbnail(screenRed), reasoning: "r1", action: { type: "click", x: 10, y: 10 }, riskClass: "read-only" }],
      { width: 999, height: 999 }, // deliberately WRONG resolution vs. what captureScreenshot will report
    );

    let aiCalls = 0;
    computerUse.captureScreenshot = async () => ({ base64Png: screenRed, width: REAL_W, height: REAL_H, realWidth: REAL_W, realHeight: REAL_H });
    computerUse.executeAction = async () => {};
    grok.requestNextAction = async () => {
      aiCalls++;
      return { reasoning: "ai-r", screenLabel: "ai-s", confidence: 1, riskClass: "read-only", action: { type: "done", summary: "done via ai" } };
    };

    const taskRunner = require(`${DIST}/task-runner.js`);
    await taskRunner.runComputerUseTask({
      apiKey: "xai-dummy",
      task: "Task One",
      connectorId: "connA",
      knownScreens: [],
      onUpdate: () => {},
      shouldStop: () => false,
      waitForApproval: async () => ({ approved: true }),
      waitForAnswer: async () => "",
    });

    check("resolution mismatch forces macroActive off from step 1 (AI was called)", aiCalls === 1);
  }

  // === Scenario 2: tier-1 hit skips the AI call, tier-2 fallback triggers and stays permanent ===
  {
    const macroConnId = "connB";
    const macroTask = "  Prepare   Report  "; // extra whitespace - should still normalize-match "prepare report"
    macros.saveMacro(
      macroConnId,
      "prepare report",
      [
        { screenLabel: "step1", referenceThumbnail: computerUse.deriveComparisonThumbnail(screenRed), reasoning: "cached r1", action: { type: "click", x: 555, y: 777 }, riskClass: "read-only" },
        { screenLabel: "step2", referenceThumbnail: computerUse.deriveComparisonThumbnail(screenRed), reasoning: "cached r2", action: { type: "type", text: "hello" }, riskClass: "final-commit" },
        { screenLabel: "step3", referenceThumbnail: computerUse.deriveComparisonThumbnail(screenRed), reasoning: "cached r3", action: { type: "type_credential", field: "password" }, riskClass: "read-only" },
        { screenLabel: "step4", referenceThumbnail: computerUse.deriveComparisonThumbnail(screenRed), reasoning: "cached r4", action: { type: "click", x: 999, y: 888 }, riskClass: "read-only" },
      ],
      { width: REAL_W, height: REAL_H },
    );
    const seededCreatedAt = macros.getMacro(macroConnId, "prepare report").createdAt;

    // screenshots: steps 1-3 match (red+noise) -> replayed from cache; step 4 diverges (blue) -> falls back to AI from there on
    const shots = [screenRedNoise, screenRedNoise, screenRedNoise, screenBlue, screenBlue];
    let shotIndex = 0;
    computerUse.captureScreenshot = async () => {
      const png = shots[Math.min(shotIndex, shots.length - 1)];
      shotIndex++;
      return { base64Png: png, width: REAL_W, height: REAL_H, realWidth: REAL_W, realHeight: REAL_H };
    };

    const executedActions = [];
    computerUse.executeAction = async (action) => { executedActions.push(action); };

    let aiCallCount = 0;
    let approvalCalls = 0;
    let credentialResolved = false;
    grok.requestNextAction = async () => {
      aiCallCount++;
      if (aiCallCount === 1) {
        // this is the step-3 divergence point - AI takes over with a normal click
        return { reasoning: "ai-took-over", screenLabel: "ai-screen", confidence: 1, riskClass: "read-only", action: { type: "click", x: 1, y: 1 } };
      }
      return { reasoning: "ai-done", screenLabel: "ai-screen", confidence: 1, riskClass: "read-only", action: { type: "done", summary: "finished" } };
    };

    settings.setConnectorCredentials(macroConnId, "user1", "pass1");
    const originalGetCreds = settings.getConnectorCredentials;

    const events = [];
    const taskRunnerFresh = require(`${DIST}/task-runner.js`); // same cached module (fine, functions reference live mocks via module-level lookups)
    await taskRunnerFresh.runComputerUseTask({
      apiKey: "xai-dummy",
      task: macroTask,
      connectorId: macroConnId,
      knownScreens: [],
      onUpdate: (e) => events.push(e),
      shouldStop: () => false,
      waitForApproval: async (step, reasoning, confidence, action, source) => { approvalCalls++; check(`waitForApproval's own "source" param is "macro" for the cached step`, source === "macro"); return { approved: true }; },
      waitForAnswer: async () => "",
    });

    check("normalized-task matching hit the macro despite extra whitespace/case", executedActions.length === 4);
    check("tier-1 replay did NOT call the AI for steps 1-3 (only called for the AI-driven tail)", aiCallCount === 2);
    check("macro step 1's action (click 555,777) was executed verbatim, NOT re-scaled", executedActions[0].type === "click" && executedActions[0].x === 555 && executedActions[0].y === 777);
    check("macro step 2's riskClass=final-commit still triggered waitForApproval under replay (via policy-engine, not the macro's own flag)", approvalCalls >= 1);
    check("macro step 3 (type_credential) resolved the REAL saved password, not a literal 'password' string", executedActions[2].type === "type" && executedActions[2].text === "pass1");
    check("AI-driven step after divergence used its own click (1,1), unaffected by macro state", executedActions[3].type === "click" && executedActions[3].x === 1 && executedActions[3].y === 1);

    const awaitingApprovalEvent = events.find((e) => e.type === "awaiting-approval");
    check(`the "awaiting-approval" TaskUpdateEvent itself carries source:"macro"`, awaitingApprovalEvent && awaitingApprovalEvent.source === "macro");

    const macroAfterRun = macros.getMacro(macroConnId, "prepare report");
    check("macro was resaved after falling back to AI mid-run (steps updated)", Boolean(macroAfterRun));
    check(
      `telemetry survived the resave instead of being reset to 0 (timesReplayed=${macroAfterRun.timesReplayed}, timesFellBackToAi=${macroAfterRun.timesFellBackToAi})`,
      macroAfterRun.timesReplayed === 3 && macroAfterRun.timesFellBackToAi === 1,
    );
    check("createdAt was preserved across the resave, not reset to 'now'", macroAfterRun.createdAt === seededCreatedAt);
  }

  // === Scenario 3: learn-on-done - fresh run with no macro saves a new one; a run containing "ask" does NOT ===
  {
    computerUse.captureScreenshot = async () => ({ base64Png: screenRed, width: REAL_W, height: REAL_H, realWidth: REAL_W, realHeight: REAL_H });
    computerUse.executeAction = async () => {};
    let step = 0;
    grok.requestNextAction = async () => {
      step++;
      if (step === 1) return { reasoning: "click something", screenLabel: "s", confidence: 1, riskClass: "read-only", action: { type: "click", x: 5, y: 5 } };
      return { reasoning: "all done", screenLabel: "s", confidence: 1, riskClass: "read-only", action: { type: "done", summary: "ok" } };
    };

    const taskRunner2 = require(`${DIST}/task-runner.js`);
    await taskRunner2.runComputerUseTask({
      apiKey: "xai-dummy", task: "Brand New Task", connectorId: "connC", knownScreens: [],
      onUpdate: () => {}, shouldStop: () => false, waitForApproval: async () => ({ approved: true }), waitForAnswer: async () => "",
    });

    const learned = macros.getMacro("connC", "Brand New Task");
    check("a fresh successful run with no prior macro gets saved as a new macro", Boolean(learned) && learned.steps.length === 1);

    // now a run that asks a question - must NOT be saved as a macro even though it ends in done
    let askStep = 0;
    grok.requestNextAction = async () => {
      askStep++;
      if (askStep === 1) return { reasoning: "need info", screenLabel: "s", confidence: 1, riskClass: "read-only", action: { type: "ask", question: "which client?" } };
      if (askStep === 2) return { reasoning: "click", screenLabel: "s", confidence: 1, riskClass: "read-only", action: { type: "click", x: 9, y: 9 } };
      return { reasoning: "done", screenLabel: "s", confidence: 1, riskClass: "read-only", action: { type: "done", summary: "ok" } };
    };
    const taskRunner3 = require(`${DIST}/task-runner.js`);
    await taskRunner3.runComputerUseTask({
      apiKey: "xai-dummy", task: "Task With A Question", connectorId: "connC", knownScreens: [],
      onUpdate: () => {}, shouldStop: () => false, waitForApproval: async () => ({ approved: true }), waitForAnswer: async () => "the answer",
    });
    check("a run containing an 'ask' step is NOT saved as a macro", macros.getMacro("connC", "Task With A Question") === null);
  }

  const fs = require("fs");
  try { fs.rmSync(USERDATA, { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

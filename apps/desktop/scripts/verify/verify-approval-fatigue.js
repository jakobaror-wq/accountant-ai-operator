// Ad-hoc verification (not part of the repo) for the "approval fatigue"
// feature added 2026-10-06: a user-requested "auto-approve similar actions
// for the rest of this run" flag, restricted by CODE (not just UI
// convention) to riskClass "external-side-effect" only via
// safety/policy-engine.ts's canAutoApproveForRestOfRun. Core claims under
// test:
//   1. The first external-side-effect approval with autoApproveRestOfRun:true
//      prompts normally and is logged as "approval-granted".
//   2. A LATER external-side-effect step of the same run is NOT prompted
//      (skips waitForApproval entirely) and is logged as
//      "approval-auto-granted" instead.
//   3. A final-commit step is ALWAYS prompted, even after a prior approval
//      tried (incorrectly, or via a confused caller) to set
//      autoApproveRestOfRun:true on it - canAutoApproveForRestOfRun refuses
//      to add final-commit to the auto-approved set, so a second
//      final-commit step still prompts too.
const { app, safeStorage } = require("electron");

safeStorage.isEncryptionAvailable = () => true;
const fakeKey = Buffer.from("k");
safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

const USERDATA = "/tmp/aiop-approval-fatigue-test-userdata";
app.setPath("userData", USERDATA);

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const { nativeImage } = require("electron");
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  function solidPng(r, g, b) {
    const w = 50, h = 50;
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      buf[i * 4 + 0] = b;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = r;
      buf[i * 4 + 3] = 255;
    }
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString("base64");
  }
  const screenPng = solidPng(10, 10, 10);
  const REAL_W = 800, REAL_H = 600;

  const computerUse = require(`${DIST}/computer-use.js`);
  const grok = require(`${DIST}/ai/grok.js`);
  const settings = require(`${DIST}/settings.js`);
  settings.setXaiApiKey("xai-dummy");

  computerUse.captureScreenshot = async () => ({
    base64Png: screenPng,
    width: REAL_W,
    height: REAL_H,
    realWidth: REAL_W,
    realHeight: REAL_H,
  });
  let executedActions = 0;
  computerUse.executeAction = async () => {
    executedActions++;
  };

  // Scripted sequence of "AI" decisions. aiStep tracks how many times
  // requestNextAction has been called.
  const scripted = [
    { reasoning: "export report 1", screenLabel: "s1", confidence: 0.99, riskClass: "external-side-effect", action: { type: "key", key: "p" } },
    { reasoning: "export report 2", screenLabel: "s2", confidence: 0.99, riskClass: "external-side-effect", action: { type: "key", key: "p" } },
    { reasoning: "final commit 1", screenLabel: "s3", confidence: 0.99, riskClass: "final-commit", action: { type: "key", key: "enter" } },
    { reasoning: "final commit 2", screenLabel: "s4", confidence: 0.99, riskClass: "final-commit", action: { type: "key", key: "enter" } },
    { reasoning: "all done", screenLabel: "s5", confidence: 0.99, riskClass: "read-only", action: { type: "done", summary: "finished" } },
  ];
  let aiStep = 0;
  grok.requestNextAction = async () => {
    const result = scripted[aiStep];
    aiStep++;
    return result;
  };

  const approvalCalls = [];
  const waitForApproval = async (step, reasoning, confidence, action, source, riskClass) => {
    approvalCalls.push({ step, riskClass });
    // Attempt autoApproveRestOfRun:true on EVERY approval, including
    // final-commit - this is deliberately "hostile" input: the code must be
    // the one refusing it for final-commit, not the caller's good behavior.
    return { approved: true, autoApproveRestOfRun: true };
  };

  const taskRunner = require(`${DIST}/task-runner.js`);
  let finalRun = null;
  await taskRunner.runComputerUseTask({
    apiKey: "xai-dummy",
    task: "Approval Fatigue Test Task",
    connectorId: "connFatigue",
    knownScreens: [],
    onUpdate: (event) => {
      if (event.type === "run-summary") finalRun = event.run;
    },
    shouldStop: () => false,
    waitForApproval,
    waitForAnswer: async () => "",
  });

  check("run finished with status 'done'", finalRun && finalRun.status === "done");
  check("executeAction was called for all 4 non-done steps", executedActions === 4);

  // === Claim 1 + 3: exactly 3 approval prompts (step1 ext-side-effect,
  // step3 final-commit, step4 final-commit) - step2 must be skipped ===
  check(
    "waitForApproval was called exactly 3 times (steps 1, 3, 4 - NOT step 2)",
    approvalCalls.length === 3,
  );
  check(
    "the 3 prompts are for steps 1, 3, 4 in that order",
    approvalCalls[0] && approvalCalls[0].step === 1 && approvalCalls[0].riskClass === "external-side-effect" &&
    approvalCalls[1] && approvalCalls[1].step === 3 && approvalCalls[1].riskClass === "final-commit" &&
    approvalCalls[2] && approvalCalls[2].step === 4 && approvalCalls[2].riskClass === "final-commit",
  );

  // === Claim 2: step 2 (external-side-effect) was auto-approved, not asked ===
  const step2 = finalRun && finalRun.steps.find((s) => s.step === 2);
  check(
    "step 2 (second external-side-effect) was executed without a prompt",
    step2 && step2.outcome === "executed" && step2.riskClass === "external-side-effect",
  );

  // === Claim 3 continued: step 4 (second final-commit) still required its
  // own prompt - canAutoApproveForRestOfRun refused to let step 3's
  // autoApproveRestOfRun:true stick for final-commit ===
  const step4 = finalRun && finalRun.steps.find((s) => s.step === 4);
  check(
    "step 4 (second final-commit) was executed (approved via its OWN prompt, not auto-approved)",
    step4 && step4.outcome === "executed" && step4.riskClass === "final-commit",
  );

  // === Audit trail: approval-auto-granted appears exactly once (step 2),
  // approval-granted appears exactly 3 times (steps 1, 3, 4) ===
  const db = require(`${DIST}/db.js`);
  const events = db.listAuditEvents(100);
  const autoGranted = events.filter((e) => e.type === "approval-auto-granted");
  const granted = events.filter((e) => e.type === "approval-granted");
  check("exactly 1 'approval-auto-granted' audit event (step 2)", autoGranted.length === 1 && autoGranted[0].payload.step === 2);
  check("exactly 3 'approval-granted' audit events (steps 1, 3, 4)", granted.length === 3);
  check(
    "the auto-granted audit event's riskClass is external-side-effect",
    autoGranted[0] && autoGranted[0].payload.riskClass === "external-side-effect",
  );

  const chainCheck = db.verifyAuditChain();
  check("audit hash-chain is still valid after this run", chainCheck.valid === true);

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

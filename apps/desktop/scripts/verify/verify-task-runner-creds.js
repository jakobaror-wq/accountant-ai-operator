// Ad-hoc verification (not part of the repo). Drives the real compiled
// task-runner.js with a scripted fake AI response requesting
// "type_credential" for a saved connector, and a captured executeAction, to
// verify: (1) the REAL secret is what actually gets typed, and (2) the real
// secret NEVER appears in any persisted/emitted event (run-history, log) -
// only the symbolic action does. This is the core security property of the
// feature: the secret must never round-trip through the AI or the audit log.
const { app, safeStorage } = require("electron");

const fakeKey = Buffer.from("test-key-not-real-crypto");
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (str) => Buffer.concat([fakeKey, Buffer.from(str, "utf-8")]);
safeStorage.decryptString = (buf) => buf.subarray(fakeKey.length).toString("utf-8");

app.setPath("userData", "/tmp/aiop-taskrunner-test-userdata");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const settings = require(`${DIST}/settings.js`);

  const connectorId = "test-connector";
  const REAL_PASSWORD = "sup3r-s3cret-pw-do-not-leak";
  settings.setConnectorCredentials(connectorId, "test-user", REAL_PASSWORD);

  // Mock computer-use.js: fake screenshot, and record every executeAction call.
  const computerUse = require(`${DIST}/computer-use.js`);
  const executedActions = [];
  computerUse.captureScreenshot = async () => ({
    base64Png: "AAAA",
    width: 1000,
    height: 800,
    visionBase64Png: "AAAA",
    visionWidth: 1000,
    visionHeight: 800,
  });
  computerUse.executeAction = async (action) => {
    executedActions.push(action);
  };

  // Mock grok.js's requestNextAction: step 1 asks to type the saved password,
  // step 2 ends the task cleanly.
  const grok = require(`${DIST}/ai/grok.js`);
  let callCount = 0;
  grok.requestNextAction = async (params) => {
    callCount += 1;
    if (callCount === 1) {
      if (params.hasSavedCredentials !== true) {
        throw new Error("test-setup-error: hasSavedCredentials should be true for this connector");
      }
      return {
        reasoning: "מסך התחברות מזוהה, משתמש בסיסמה שמורה",
        screenLabel: "מסך התחברות",
        confidence: 0.99,
        requiresApproval: false,
        action: { type: "type_credential", field: "password" },
      };
    }
    return {
      reasoning: "הושלם",
      screenLabel: "מסך התחברות",
      confidence: 0.99,
      requiresApproval: false,
      action: { type: "done", summary: "בוצע" },
    };
  };

  const taskRunner = require(`${DIST}/task-runner.js`);

  const events = [];
  await taskRunner.runComputerUseTask({
    apiKey: "dummy",
    task: "התחבר לתוכנה",
    connectorId,
    knownScreens: [],
    onUpdate: (event) => events.push(event),
    shouldStop: () => false,
    waitForApproval: async () => ({ approved: true }),
    waitForAnswer: async () => "",
  });

  const results = [];
  function check(label, cond) {
    results.push({ label, ok: Boolean(cond) });
  }

  // 1. The real password was what actually got typed.
  check("executeAction called exactly once", executedActions.length === 1);
  check(
    "the REAL password was what got executed (typed)",
    executedActions[0] && executedActions[0].type === "type" && executedActions[0].text === REAL_PASSWORD,
  );

  // 2. The symbolic action (not the secret) is what's in the emitted events / run history.
  const actionEvent = events.find((e) => e.type === "action");
  check(
    "the 'action' event carries the symbolic type_credential action, not the real value",
    actionEvent && actionEvent.action.type === "type_credential" && actionEvent.action.field === "password",
  );

  const runSummaryEvent = events.find((e) => e.type === "run-summary" && e.run.status === "done");
  check("a run-summary with status done was emitted", Boolean(runSummaryEvent));
  const step1 = runSummaryEvent && runSummaryEvent.run.steps[0];
  check(
    "the persisted run-history step carries the symbolic action, not the real value",
    step1 && step1.action.type === "type_credential" && step1.action.field === "password",
  );

  // 3. The critical security property: serialize EVERYTHING emitted and confirm
  // the real password string appears nowhere in it - not in reasoning, not in
  // any action, not anywhere.
  const fullEventsJson = JSON.stringify(events);
  check(
    "the real password string does not appear ANYWHERE in the emitted events (log/run-history)",
    !fullEventsJson.includes(REAL_PASSWORD),
  );

  const fs = require("fs");
  const runsDir = require("path").join(app.getPath("userData"), "runs");
  let runFilesOk = true;
  try {
    for (const f of fs.readdirSync(runsDir)) {
      const content = fs.readFileSync(require("path").join(runsDir, f), "utf-8");
      if (content.includes(REAL_PASSWORD)) runFilesOk = false;
    }
  } catch {}
  check("the real password string does not appear in any run-history JSON file on disk", runFilesOk);

  settings.clearConnectorCredentials(connectorId);
  try { fs.rmSync("/tmp/aiop-taskrunner-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

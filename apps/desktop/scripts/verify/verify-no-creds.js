const { app, safeStorage } = require("electron");
safeStorage.isEncryptionAvailable = () => true;
safeStorage.encryptString = (s) => Buffer.from(s, "utf-8");
safeStorage.decryptString = (b) => b.toString("utf-8");
app.setPath("userData", "/tmp/aiop-nocreds-test-userdata");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const computerUse = require(`${DIST}/computer-use.js`);
  const executedActions = [];
  computerUse.captureScreenshot = async () => ({
    base64Png: "AAAA", width: 1000, height: 800, visionBase64Png: "AAAA", visionWidth: 1000, visionHeight: 800,
  });
  computerUse.executeAction = async (action) => { executedActions.push(action); };

  const grok = require(`${DIST}/ai/grok.js`);
  grok.requestNextAction = async (params) => {
    if (params.hasSavedCredentials !== false) throw new Error("test-setup-error: expected no saved credentials");
    return {
      reasoning: "מנסה להשתמש בסיסמה שמורה למרות שאין",
      screenLabel: "מסך התחברות",
      confidence: 0.99,
      requiresApproval: false,
      action: { type: "type_credential", field: "password" },
    };
  };

  const taskRunner = require(`${DIST}/task-runner.js`);
  const events = [];
  await taskRunner.runComputerUseTask({
    apiKey: "dummy",
    task: "התחבר לתוכנה",
    connectorId: "connector-without-creds",
    knownScreens: [],
    onUpdate: (event) => events.push(event),
    shouldStop: () => false,
    waitForApproval: async () => ({ approved: true }),
    waitForAnswer: async () => "",
  });

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("nothing was ever executed on the keyboard/mouse", executedActions.length === 0);
  const errorEvent = events.find((e) => e.type === "error");
  check("an error event was emitted instead of crashing or guessing", Boolean(errorEvent));
  check("the error message is clear and mentions saved credentials", errorEvent && errorEvent.message.includes("לא נשמרו פרטי התחברות"));
  const runSummary = events.find((e) => e.type === "run-summary");
  check("the run ended with status error, not done", runSummary && runSummary.run.status === "error");

  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-nocreds-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

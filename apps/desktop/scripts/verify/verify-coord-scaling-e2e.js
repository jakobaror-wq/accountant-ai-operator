// Ad-hoc verification (not part of the repo). Runs the real compiled
// task-runner.js with a mocked screenshot (known real vs. reported size)
// and a mocked AI response clicking at a known coordinate in the DOWNSCALED
// image's space, then confirms the coordinate actually executed on the
// "screen" is correctly scaled UP to real screen space - not transposed,
// not left unscaled.
const { app } = require("electron");
app.setPath("userData", "/tmp/aiop-coordscale-test-userdata");

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // Simulate: real screen is 3200x1800, downscaled image sent to AI is 1600x900 (exact 2x scale).
  const computerUse = require(`${DIST}/computer-use.js`);
  const executedActions = [];
  computerUse.captureScreenshot = async () => ({
    base64Png: "AAAA",
    width: 1600, height: 900,     // the encoded/downscaled image the AI sees
    realWidth: 3200, realHeight: 1800, // the true physical screen
  });
  computerUse.executeAction = async (action) => { executedActions.push(action); };

  const grok = require(`${DIST}/ai/grok.js`);
  let callCount = 0;
  grok.requestNextAction = async (params) => {
    callCount += 1;
    if (callCount === 1) {
      // The AI sees a 1600x900 image and clicks at (100, 50) in THAT image's space.
      if (params.screenWidth !== 1600 || params.screenHeight !== 900) {
        throw new Error(`test-setup-error: expected AI to be told 1600x900, got ${params.screenWidth}x${params.screenHeight}`);
      }
      return {
        reasoning: "click", screenLabel: "s", confidence: 0.99, requiresApproval: false,
        action: { type: "click", x: 100, y: 50 },
      };
    }
    return { reasoning: "done", screenLabel: "s", confidence: 0.99, requiresApproval: false, action: { type: "done", summary: "done" } };
  };

  const taskRunner = require(`${DIST}/task-runner.js`);
  await taskRunner.runComputerUseTask({
    apiKey: "dummy", task: "test", connectorId: "c1", knownScreens: [],
    onUpdate: () => {},
    shouldStop: () => false,
    waitForApproval: async () => ({ approved: true }),
    waitForAnswer: async () => "",
  });

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("exactly one click was executed", executedActions.length === 1 && executedActions[0].type === "click");
  // scale = realWidth/width = 3200/1600 = 2x. AI clicked at (100,50) in the 1600x900 space ->
  // real click should be at (200, 100) on the actual 3200x1800 screen.
  check("x coordinate scaled correctly (100 * 2 = 200), not left as raw 100 or transposed", executedActions[0]?.x === 200);
  check("y coordinate scaled correctly (50 * 2 = 100)", executedActions[0]?.y === 100);

  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-coordscale-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

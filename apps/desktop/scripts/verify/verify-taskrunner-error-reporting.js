// Ad-hoc verification (not part of the repo). Directly exercises main.ts's
// real "aiop:run-task" IPC handler with a task-runner that rejects (simulating
// the disk-write-fails-inside-onUpdate scenario the QA review flagged), and
// confirms: (1) the process survives, (2) an "error" event is actually sent
// to the renderer (previously: nothing was sent at all - the task would just
// silently vanish with taskRunning reset and no explanation to the user).
const { app, ipcMain, safeStorage } = require("electron");

safeStorage.isEncryptionAvailable = () => true;
const fakeKey = Buffer.from("k");
safeStorage.encryptString = (s) => Buffer.concat([fakeKey, Buffer.from(s, "utf-8")]);
safeStorage.decryptString = (b) => b.subarray(fakeKey.length).toString("utf-8");

app.setPath("userData", "/tmp/aiop-taskrunner-error-test-userdata");

// Intercept ipcMain.handle calls to capture the "aiop:run-task" handler
// function before main.js's app.whenReady() registers it for real.
const handlers = {};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  handlers[channel] = listener;
  return originalHandle(channel, listener);
};

let unhandledRejectionFired = false;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionFired = true;
  console.log("UNHANDLED REJECTION:", String(reason).slice(0, 200));
});

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // Set up a saved xAI key so aiop:run-task doesn't short-circuit on no-api-key.
  const settings = require(`${DIST}/settings.js`);
  settings.setXaiApiKey("xai-dummy");

  // **Added**: aiop:run-task now calls focusConnectorWindow(...) BEFORE ever
  // reaching task-runner.ts (ר' main.ts, window-focus.ts - feature added
  // after this script was first written). "test-connector" has no entry in
  // WINDOW_TITLE_HINTS and no configured exe path, so the real function
  // always fails fast ("no-title-hint-configured") - the handler would
  // return {started:false} without ever calling the mocked
  // runComputerUseTask below, which is exactly why this script's checks
  // used to fail after that feature landed. This script is about
  // task-runner rejection -> error-reporting, not about window-focus logic
  // (already covered by verify-window-focus.js) - so just stub the whole
  // function to always succeed, rather than fighting its real matching logic.
  const windowFocus = require(`${DIST}/window-focus.js`);
  windowFocus.focusConnectorWindow = async () => ({ success: true });

  // Mock task-runner.js's runComputerUseTask to immediately reject, simulating
  // an uncaught throw inside onUpdate (e.g. a disk write failure).
  const taskRunner = require(`${DIST}/task-runner.js`);
  taskRunner.runComputerUseTask = async () => {
    throw new Error("simulated disk-write failure inside onUpdate");
  };

  require(`${DIST}/main.js`); // registers the real ipcMain.handle("aiop:run-task", ...)

  await new Promise((resolve) => setTimeout(resolve, 100)); // let app.whenReady().then(...) inside main.js run

  const runTaskHandler = handlers["aiop:run-task"];
  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  check("aiop:run-task handler was registered", typeof runTaskHandler === "function");

  const sentEvents = [];
  const fakeEvent = {
    sender: {
      isDestroyed: () => false,
      send: (channel, payload) => sentEvents.push({ channel, payload }),
    },
  };

  const result = await runTaskHandler(fakeEvent, "test task", "test-connector");
  check("run-task returned started:true (the rejection happens async, after returning)", result.started === true);

  // Give the fire-and-forget runComputerUseTask(...).catch(...).finally(...) chain time to settle.
  await new Promise((resolve) => setTimeout(resolve, 200));

  check("process survived the task-runner rejection without crashing", true);
  check("no unhandled rejection occurred (the rejection was properly caught)", !unhandledRejectionFired);

  const errorEvent = sentEvents.find((e) => e.channel === "aiop:task-update" && e.payload.type === "error");
  check("an 'error' event WAS sent to the renderer (previously: nothing was sent at all)", Boolean(errorEvent));
  check(
    "the error message reflects the actual internal failure, not a generic/empty message",
    errorEvent && errorEvent.payload.message.includes("simulated disk-write failure"),
  );

  const fs = require("fs");
  try { fs.rmSync("/tmp/aiop-taskrunner-error-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, sentEventTypes: sentEvents.map((e) => e.payload.type), results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

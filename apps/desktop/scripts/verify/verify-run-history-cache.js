// Ad-hoc verification (not part of the repo). Confirms the new in-memory
// cache in run-history.js still behaves identically to a full re-scan:
// correct upsert semantics on repeated saveRun for the same run (checkpoint
// pattern), correct sort order, correct incomplete-run lookup, and that
// data pre-existing on disk from a previous app run is still picked up on
// first access (lazy load).
const { app } = require("electron");
app.setPath("userData", "/tmp/aiop-runhistory-test-userdata");

app.whenReady().then(() => {
  const fs = require("fs");
  const path = require("path");
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  // Pre-seed a run file directly on disk, as if written by a previous app
  // launch, BEFORE run-history.js is ever required - tests the lazy-load path.
  const runsDir = path.join(app.getPath("userData"), "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const preExisting = {
    id: "2020-01-01T00-00-00-000Z",
    connectorId: "hashavshevet",
    task: "משימה ישנה מהרצה קודמת",
    startedAt: "2020-01-01T00:00:00.000Z",
    finishedAt: "2020-01-01T00:05:00.000Z",
    status: "done",
    steps: [],
  };
  fs.writeFileSync(path.join(runsDir, `${preExisting.id}.json`), JSON.stringify(preExisting));

  const runHistory = require(`${DIST}/run-history.js`);
  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  // 1. Pre-existing disk data is picked up on first access (lazy load works).
  check("pre-existing run from disk is found via getRun", runHistory.getRun(preExisting.id)?.task === preExisting.task);
  check("pre-existing run appears in listRuns", runHistory.listRuns().some((r) => r.id === preExisting.id));

  // 2. checkpoint pattern: saveRun called multiple times with the SAME
  // startedAt (same run, growing steps) must upsert, not create duplicates.
  const startedAt = new Date().toISOString();
  const base = { connectorId: "hashavshevet", task: "משימה חדשה", startedAt, finishedAt: startedAt, status: "in-progress", steps: [] };
  runHistory.saveRun({ ...base, steps: [{ step: 1, timestamp: startedAt, outcome: "executed" }] });
  runHistory.saveRun({ ...base, steps: [{ step: 1, timestamp: startedAt, outcome: "executed" }, { step: 2, timestamp: startedAt, outcome: "executed" }] });
  const afterTwoCheckpoints = runHistory.listRuns().filter((r) => r.startedAt === startedAt);
  check("repeated saveRun for the same run upserts (exactly one entry)", afterTwoCheckpoints.length === 1);
  check("the upserted entry has the latest steps (2), not the first checkpoint's (1)", afterTwoCheckpoints[0]?.steps.length === 2);

  // 3. findIncompleteRun finds the in-progress run for the right connector, not others.
  const incomplete = runHistory.findIncompleteRun("hashavshevet");
  check("findIncompleteRun finds the in-progress run for this connector", incomplete?.startedAt === startedAt);
  check("findIncompleteRun returns null for a connector with no in-progress run", runHistory.findIncompleteRun("dokka") === null);

  // 4. finishing the run (status done) removes it from findIncompleteRun.
  runHistory.saveRun({ ...base, status: "done", steps: [{ step: 1, timestamp: startedAt, outcome: "done" }] });
  check("a finished run no longer shows up as incomplete", runHistory.findIncompleteRun("hashavshevet") === null);

  // 5. sort order: newest first.
  const all = runHistory.listRuns();
  const sortedCorrectly = all.every((r, i) => i === 0 || all[i - 1].startedAt >= r.startedAt);
  check("listRuns is sorted newest-first", sortedCorrectly);

  // 6. cache stays consistent with disk: what's on disk matches what the cache returns.
  const onDiskFiles = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  check("cache size matches number of files on disk", runHistory.listRuns().length === onDiskFiles.length);

  try { fs.rmSync("/tmp/aiop-runhistory-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

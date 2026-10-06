// Ad-hoc verification (not part of the repo). Confirms screen-memory.js's
// new lazy per-connector cache: pre-existing disk data loads correctly,
// repeated recordScreen upserts, and - the core proof - deleting/corrupting
// the on-disk file after first load doesn't affect subsequent reads (proving
// no re-read happens), connectors stay independent, unseen connector is [].
const { app } = require("electron");
app.setPath("userData", "/tmp/aiop-screenmem-test-userdata");

app.whenReady().then(() => {
  const fs = require("fs");
  const path = require("path");
  const DIST = require("path").join(__dirname, "..", "..", "dist");

  const results = [];
  function check(label, cond) { results.push({ label, ok: Boolean(cond) }); }

  // Pre-seed disk data for connector A, before requiring the module.
  const dirA = path.join(app.getPath("userData"), "connectors", "connA");
  fs.mkdirSync(dirA, { recursive: true });
  const preExisting = [{ label: "מסך פתיחה", timesSeen: 3, firstSeenAt: "2020-01-01T00:00:00.000Z", lastSeenAt: "2020-01-02T00:00:00.000Z", exampleReasoning: "ישן" }];
  fs.writeFileSync(path.join(dirA, "screens.json"), JSON.stringify(preExisting));

  const screenMemory = require(`${DIST}/screen-memory.js`);

  // 1. Pre-existing disk data is picked up on first access.
  check("pre-existing screens loaded from disk", screenMemory.getLearnedScreens("connA").length === 1);
  check("pre-existing screen has correct label", screenMemory.getLearnedScreens("connA")[0]?.label === "מסך פתיחה");

  // 2. Unseen connector returns [] without throwing.
  check("never-seen connector returns []", Array.isArray(screenMemory.getLearnedScreens("connB")) && screenMemory.getLearnedScreens("connB").length === 0);

  // 3. recordScreen upserts (same label -> timesSeen increments, no duplicate).
  screenMemory.recordScreen("connA", "טופס לקוח", "ראיתי טופס");
  screenMemory.recordScreen("connA", "טופס לקוח", "ראיתי טופס שוב");
  const afterTwoRecords = screenMemory.getLearnedScreens("connA");
  const formEntries = afterTwoRecords.filter((s) => s.label === "טופס לקוח");
  check("repeated recordScreen for the same label upserts (exactly one entry)", formEntries.length === 1);
  check("upserted entry has timesSeen = 2", formEntries[0]?.timesSeen === 2);
  check("the pre-existing entry is still there too (3 total: original + new)", afterTwoRecords.length === 2);

  // 4. Core proof of the cache: delete the on-disk file, confirm reads still work from cache.
  fs.rmSync(path.join(dirA, "screens.json"));
  check("file was actually deleted from disk", !fs.existsSync(path.join(dirA, "screens.json")));
  const afterDelete = screenMemory.getLearnedScreens("connA");
  check("getLearnedScreens still returns correct data after the file was deleted (proves no re-read)", afterDelete.length === 2 && afterDelete.some((s) => s.label === "טופס לקוח" && s.timesSeen === 2));

  // Simulate the ~40-step-per-task pattern: many recordScreen calls despite the file being gone until the first write recreates it.
  for (let i = 0; i < 40; i++) {
    screenMemory.recordScreen("connA", "לולאת בדיקה", `סבב ${i}`);
  }
  const loopResult = screenMemory.getLearnedScreens("connA").find((s) => s.label === "לולאת בדיקה");
  check("40 rapid recordScreen calls for the same label result in exactly timesSeen=40, no errors", loopResult?.timesSeen === 40);
  check("file exists again on disk after a write happened", fs.existsSync(path.join(dirA, "screens.json")));

  // 5. Two connectors stay independent.
  screenMemory.recordScreen("connB", "מסך אחר", "תוכנה אחרת");
  check("connector B has only its own screen, unaffected by connector A's data", screenMemory.getLearnedScreens("connB").length === 1 && screenMemory.getLearnedScreens("connB")[0].label === "מסך אחר");
  check("connector A unaffected by connector B's write", screenMemory.getLearnedScreens("connA").some((s) => s.label === "לולאת בדיקה"));

  try { fs.rmSync("/tmp/aiop-screenmem-test-userdata", { recursive: true, force: true }); } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, results }, null, 2));
  app.exit(allOk ? 0 : 1);
});

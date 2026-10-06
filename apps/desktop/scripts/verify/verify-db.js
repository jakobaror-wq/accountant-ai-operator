// Ad-hoc verification (not part of the repo) for db.ts (2026-10-06) - the new
// SQLite-backed data layer (better-sqlite3, a NATIVE addon - the real risk
// here is an ABI mismatch between Electron's bundled Node and the system
// Node used to compile it, so this MUST run inside an actual Electron
// process, exactly like every other native-dependency test this session).
const { app } = require("electron");

const USERDATA = "/tmp/aiop-db-test-userdata";
app.setPath("userData", USERDATA);

const results = [];
function check(label, cond) {
  results.push({ label, ok: Boolean(cond) });
  console.log((cond ? "PASS" : "FAIL") + " - " + label);
}

app.whenReady().then(async () => {
  const DIST = require("path").join(__dirname, "..", "..", "dist");
  const db = require(`${DIST}/db.js`);

  // === Part 1: clients ===
  const client = db.createClient("חברה א.ב. בע\"מ");
  check("createClient returns a client with an id and the given name", Boolean(client.id) && client.name === "חברה א.ב. בע\"מ");
  const fetched = db.getClient(client.id);
  check("getClient round-trips the same client", fetched && fetched.id === client.id && fetched.name === client.name);
  const all = db.listClients();
  check("listClients includes the created client", all.some((c) => c.id === client.id));
  check("getClient on a nonexistent id returns null, not throw", db.getClient("does-not-exist") === null);

  // === Part 2: client facts - the source distinction is the actual safety point ===
  db.addClientFact({ clientId: client.id, key: "depreciation_method", value: "straight_line", source: "human-confirmed", createdBy: "test-user" });
  db.addClientFact({ clientId: client.id, key: "vat_rate_note", value: "exports zero-rated", source: "ai-suggested", confidence: 0.7 });
  const facts = db.getClientFacts(client.id);
  check("getClientFacts returns both facts for the client", facts.length === 2);
  const humanFact = facts.find((f) => f.key === "depreciation_method");
  const aiFact = facts.find((f) => f.key === "vat_rate_note");
  check("human-confirmed fact keeps its source marker", humanFact && humanFact.source === "human-confirmed");
  check("ai-suggested fact keeps its source marker (never silently promoted)", aiFact && aiFact.source === "ai-suggested" && aiFact.confidence === 0.7);

  // === Part 3: tamper-evident audit chain - basic append + verify ===
  db.appendAuditEvent("run-finished", { task: "task A", status: "done" });
  db.appendAuditEvent("approval-granted", { task: "task B", step: 3 });
  db.appendAuditEvent("run-finished", { task: "task B", status: "done" });
  const events = db.listAuditEvents();
  check("listAuditEvents returns all 3 appended events in order", events.length === 3 && events[0].seq < events[1].seq && events[1].seq < events[2].seq);
  check("each event's prevHash chains to the previous event's hash", events[1].prevHash === events[0].hash && events[2].prevHash === events[1].hash);
  const verifyOk = db.verifyAuditChain();
  check("verifyAuditChain reports valid:true on an untouched chain", verifyOk.valid === true);

  // === Part 4: tamper detection - directly corrupt row 2's payload via raw SQL, bypassing the API ===
  {
    const Database = require(require("path").join(__dirname, "..", "..", "node_modules", "better-sqlite3"));
    const raw = new Database(require("path").join(USERDATA, "aiop.db"));
    raw.prepare("UPDATE audit_events SET payload = ? WHERE seq = ?").run(JSON.stringify({ task: "TAMPERED", status: "done" }), events[1].seq);
    raw.close();
  }
  const verifyAfterTamper = db.verifyAuditChain();
  check(
    `tampering with event #${events[1].seq}'s payload directly in the DB is detected (brokenAtSeq=${verifyAfterTamper.brokenAtSeq})`,
    verifyAfterTamper.valid === false && verifyAfterTamper.brokenAtSeq === events[1].seq,
  );

  const fs = require("fs");
  try {
    fs.rmSync(USERDATA, { recursive: true, force: true });
  } catch {}

  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ allOk, total: results.length, failed: results.filter((r) => !r.ok).map((r) => r.label) }, null, 2));
  app.exit(allOk ? 0 : 1);
});

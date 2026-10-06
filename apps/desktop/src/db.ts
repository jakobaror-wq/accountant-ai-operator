import path from "node:path";
import crypto from "node:crypto";
import { app } from "electron";
import Database from "better-sqlite3";

/**
 * **עדכון (2026-10-06)** - שלב ראשון של "זיכרון/נתונים מובנים מקומית",
 * לפי המלצת מחקר חיצוני (§5-6 בתוכנית-העבודה). **לא** הסכמה המלאה שהוצעה
 * שם (client/tax_year/workflow/workflow_run/approval_package/...) - זו
 * החלטה מכוונת, לא פער: המחקר עצמו הזהיר מפני over-engineering לפני
 * שהוכח Connector אמיתי אחד (§6: "לא הייתי עכשיו מפתח 'ה-Agent למד
 * שלחברה הזאת בדרך כלל עושים...' בלי מנגנון provenance חזק"), ומפני הבטחת
 * "בלתי ניתן לשינוי" מוקדם מדי (§5.1: "המונח המדויק בשלב המקומי הוא
 * Tamper-evident audit trail", לא immutable).
 *
 * מה שכן נבנה כאן, בכוונה מצומצם:
 * 1. `clients`/`client_facts` - זיכרון **מינימלי ובטוח**: כל עובדה על לקוח
 *    חייבת `source` מפורש (`human-confirmed` לעומת `ai-suggested`) - אין
 *    מסלול שבו ה-AI "מסיק פעם אחת" ומשהו משתמש בזה כעובדה קבועה בשקט.
 *    שום קוד קיים עדיין לא **צורך** את הטבלה הזו (task-runner.ts לא קורא
 *    ממנה) - זו תשתית להמשך, לא שינוי התנהגות.
 * 2. `audit_events` - יומן **tamper-evident** (שרשרת hash, לא immutable)
 *    לאירועי-בטיחות קריטיים (אישור/דחייה/סיום ריצה) - משלים את יומן-הצעדים
 *    המפורט הקיים (`run-history.ts`), לא מחליף אותו. `verifyAuditChain()`
 *    מאפשרת לבדוק בדיעבד שהשרשרת לא נפגמה.
 */

export interface Client {
  id: string;
  name: string;
  createdAt: string;
}

export type ClientFactSource = "human-confirmed" | "ai-suggested";

export interface ClientFact {
  id: string;
  clientId: string;
  key: string;
  value: string;
  /** **קריטי**: כל צורכן עתידי של הטבלה הזו חייב להבחין בין שתי הערכים -
   * "ai-suggested" הוא בגדר הצעה-ממתינה-לאישור, לעולם לא עובדה-קבועה
   * שמשתמשים בה כברירת מחדל בלי אישור אנושי (ר' ההערה בראש הקובץ). */
  source: ClientFactSource;
  createdAt: string;
  createdBy?: string;
  validFrom?: string;
  confidence?: number;
}

export interface AuditEvent {
  seq: number;
  timestamp: string;
  type: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

const GENESIS_HASH = "GENESIS";

let db: Database.Database | null = null;

function dbFile(): string {
  return path.join(app.getPath("userData"), "aiop.db");
}

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbFile());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_facts (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL REFERENCES clients(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      createdBy TEXT,
      validFrom TEXT,
      confidence REAL
    );
    CREATE INDEX IF NOT EXISTS idx_client_facts_client ON client_facts(clientId);
    CREATE TABLE IF NOT EXISTS audit_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      prevHash TEXT NOT NULL,
      hash TEXT NOT NULL
    );
  `);
  return db;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createClient(name: string): Client {
  const client: Client = { id: newId(), name, createdAt: new Date().toISOString() };
  getDb().prepare("INSERT INTO clients (id, name, createdAt) VALUES (?, ?, ?)").run(client.id, client.name, client.createdAt);
  return client;
}

export function listClients(): Client[] {
  return getDb().prepare("SELECT id, name, createdAt FROM clients ORDER BY createdAt ASC").all() as Client[];
}

export function getClient(id: string): Client | null {
  return (getDb().prepare("SELECT id, name, createdAt FROM clients WHERE id = ?").get(id) as Client | undefined) ?? null;
}

export function addClientFact(input: {
  clientId: string;
  key: string;
  value: string;
  source: ClientFactSource;
  createdBy?: string;
  validFrom?: string;
  confidence?: number;
}): ClientFact {
  const fact: ClientFact = {
    id: newId(),
    clientId: input.clientId,
    key: input.key,
    value: input.value,
    source: input.source,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    validFrom: input.validFrom,
    confidence: input.confidence,
  };
  getDb()
    .prepare(
      "INSERT INTO client_facts (id, clientId, key, value, source, createdAt, createdBy, validFrom, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(fact.id, fact.clientId, fact.key, fact.value, fact.source, fact.createdAt, fact.createdBy ?? null, fact.validFrom ?? null, fact.confidence ?? null);
  return fact;
}

export function getClientFacts(clientId: string): ClientFact[] {
  return getDb()
    .prepare("SELECT id, clientId, key, value, source, createdAt, createdBy, validFrom, confidence FROM client_facts WHERE clientId = ? ORDER BY createdAt ASC")
    .all(clientId) as ClientFact[];
}

/**
 * ייצוג קנוני (סדר מפתחות קבוע) לפני חישוב ה-hash - בלי זה, אותו payload
 * עם סדר-מפתחות שונה (לדוגמה אחרי שינוי גרסת Node/V8) היה מייצר hash שונה,
 * מה שהיה שובר אימות-שרשרת על נתונים ישנים לגמרי בשקט.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function computeHash(prevHash: string, timestamp: string, type: string, payload: unknown): string {
  return crypto.createHash("sha256").update(`${prevHash}|${timestamp}|${type}|${canonicalJson(payload)}`).digest("hex");
}

export function appendAuditEvent(type: string, payload: unknown): AuditEvent {
  const database = getDb();
  const last = database.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const timestamp = new Date().toISOString();
  const hash = computeHash(prevHash, timestamp, type, payload);
  const info = database
    .prepare("INSERT INTO audit_events (timestamp, type, payload, prevHash, hash) VALUES (?, ?, ?, ?, ?)")
    .run(timestamp, type, JSON.stringify(payload), prevHash, hash);
  return { seq: Number(info.lastInsertRowid), timestamp, type, payload, prevHash, hash };
}

export function listAuditEvents(limit = 500): AuditEvent[] {
  const rows = getDb()
    .prepare("SELECT seq, timestamp, type, payload, prevHash, hash FROM audit_events ORDER BY seq ASC LIMIT ?")
    .all(limit) as { seq: number; timestamp: string; type: string; payload: string; prevHash: string; hash: string }[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown }));
}

/**
 * מאמת שהשרשרת לא נפגמה: מחשב מחדש כל hash מההתחלה ומשווה. **לא** מוכיח
 * "בלתי ניתן לשינוי" (מי שיש לו גישה ישירה לקובץ ה-DB יכול לשכתב את כל
 * השרשרת מחדש מההתחלה) - רק שאם מישהו שינה/מחק אירוע בודד **בלי** לחשב
 * מחדש את כל מה שאחריו, זה מתגלה. ר' הבהרה בראש הקובץ - "tamper-evident",
 * לא "tamper-proof".
 */
export function verifyAuditChain(): { valid: boolean; brokenAtSeq?: number } {
  const events = listAuditEvents(Number.MAX_SAFE_INTEGER);
  let expectedPrevHash = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) return { valid: false, brokenAtSeq: event.seq };
    const recomputed = computeHash(event.prevHash, event.timestamp, event.type, event.payload);
    if (recomputed !== event.hash) return { valid: false, brokenAtSeq: event.seq };
    expectedPrevHash = event.hash;
  }
  return { valid: true };
}

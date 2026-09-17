import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { RunRecord } from "./task-runner";

export interface StoredRunRecord extends RunRecord {
  id: string;
}

function runsDir(): string {
  const dir = path.join(app.getPath("userData"), "runs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * "חבילת אישור" מינימלית - סיכום מקומי ותמידי של כל ריצה (מה נעשה, מה אושר/נדחה,
 * איך הסתיים), נשמר כקובץ JSON אחד לריצה בתיקיית ה-userData - לעולם לא בענן.
 */
export function saveRun(run: RunRecord): StoredRunRecord {
  const id = run.startedAt.replace(/[:.]/g, "-");
  const stored: StoredRunRecord = { ...run, id };
  fs.writeFileSync(path.join(runsDir(), `${id}.json`), JSON.stringify(stored, null, 2), "utf-8");
  return stored;
}

export function listRuns(): StoredRunRecord[] {
  const dir = runsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as StoredRunRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is StoredRunRecord => r !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

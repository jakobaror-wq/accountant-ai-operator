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
 * שכבת קאש בזיכרון: saveRun נקרא בכל צעד של כל ריצה (checkpoint), ו-
 * findIncompleteRun נקרא בכל מעבר בין תוכנות/סיום ריצה - בלי קאש, כל קריאה
 * כזו סורקת וקוראת מחדש כל קובץ ריצה שנשמר אי-פעם (readdirSync+readFileSync
 * בלולאה), סינכרונית, על אותו תהליך שגם מצלם מסך ומזיז עכבר - ומאט עם הזמן
 * ככל שנצברות יותר ריצות. הקאש נבנה פעם אחת (עצל, בקריאה הראשונה) מהדיסק,
 * ואז מתעדכן ישירות ב-saveRun - בלי לסרוק שוב. תמיד עקבי עם הדיסק כי זו
 * האפליקציה היחידה שכותבת לתיקייה הזו. (אין today מנגנון מחיקה/ניקוי ריצות -
 * ר' docs/05-DATA-MODEL.md סעיף "מה עדיין פתוח".)
 */
let cache: Map<string, StoredRunRecord> | null = null;

function loadCache(): Map<string, StoredRunRecord> {
  if (cache) return cache;
  const dir = runsDir();
  const loaded = new Map<string, StoredRunRecord>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const run = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as StoredRunRecord;
      loaded.set(run.id, run);
    } catch {
      // קובץ פגום - מדלגים, לא מפילים את כל הטעינה בגללו
    }
  }
  cache = loaded;
  return cache;
}

/**
 * "חבילת אישור" מינימלית - סיכום מקומי ותמידי של כל ריצה (מה נעשה, מה אושר/נדחה,
 * איך הסתיים), נשמר כקובץ JSON אחד לריצה בתיקיית ה-userData - לעולם לא בענן.
 */
export function saveRun(run: RunRecord): StoredRunRecord {
  const id = run.startedAt.replace(/[:.]/g, "-");
  const stored: StoredRunRecord = { ...run, id };
  fs.writeFileSync(path.join(runsDir(), `${id}.json`), JSON.stringify(stored, null, 2), "utf-8");
  loadCache().set(id, stored);
  return stored;
}

export function listRuns(): StoredRunRecord[] {
  return [...loadCache().values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getRun(id: string): StoredRunRecord | null {
  return loadCache().get(id) ?? null;
}

/**
 * ריצה שנשארה "in-progress" בדיסק פירושה שהאפליקציה נסגרה/קרסה באמצע - לא
 * הסתיימה כרגיל. אם יש כמה כאלה לאותו connector (קרה יותר מפעם אחת בלי
 * שהמשתמש המשיך אף אחת), חייבים לבחור באופן דטרמיניסטי את **האחרונה** - לא
 * לפי סדר ה-Map (תלוי בסדר טעינה מהדיסק, לא כרונולוגי) - listRuns() כבר
 * ממוין מהחדש לישן, אז ההתאמה הראשונה שם היא תמיד הנכונה.
 */
export function findIncompleteRun(connectorId: string): StoredRunRecord | null {
  return listRuns().find((run) => run.status === "in-progress" && run.connectorId === connectorId) ?? null;
}

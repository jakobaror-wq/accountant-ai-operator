import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

export interface LearnedScreen {
  label: string;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  exampleReasoning: string;
}

/**
 * "מסכים מוכרים" לכל connector - נלמד רק ממה שהסוכן עצמו ראה בפועל אצל
 * המשתמש, לעולם לא ניחוש מראש. זו הדרך שלנו לבנות "Connector" בלי לעבור על
 * ההתחייבות ב-docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md לא להציג ידע על תוכנה
 * ספציפית בלי גישה/תיעוד רשמיים - כאן אין שום דבר שכתוב מראש על אף תוכנה.
 */
function screensFile(connectorId: string): string {
  const dir = path.join(app.getPath("userData"), "connectors", connectorId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "screens.json");
}

/**
 * קאש בזיכרון, לוקאלי-לפי-connector - recordScreen נקרא בכל אירוע "action"
 * (עד 40 פעם למשימה, ר' task-runner.ts) והיה קורא+כותב את הקובץ המלא בכל
 * פעם על אותו תהליך שגם מצלם מסך/מזיז עכבר. בניגוד ל-run-history.ts (שיש לו
 * listRuns שצריך לראות הכול, ולכן קאש-eager של כל התיקייה), כאן אין פעולת
 * "הכול" - הגישה תמיד לפי connectorId בודד, אז קאש עצל (נבנה רק לפי צורך,
 * connector אחד בכל פעם) הוא הצורה הנכונה.
 */
const cache = new Map<string, LearnedScreen[]>();

function loadConnectorScreens(connectorId: string): LearnedScreen[] {
  const cached = cache.get(connectorId);
  if (cached) return cached;
  let loaded: LearnedScreen[];
  try {
    loaded = JSON.parse(fs.readFileSync(screensFile(connectorId), "utf-8")) as LearnedScreen[];
  } catch {
    loaded = [];
  }
  cache.set(connectorId, loaded);
  return loaded;
}

export function getLearnedScreens(connectorId: string): LearnedScreen[] {
  return loadConnectorScreens(connectorId);
}

export function recordScreen(connectorId: string, label: string, reasoning: string): void {
  const current = loadConnectorScreens(connectorId);
  const now = new Date().toISOString();
  const existing = current.find((s) => s.label === label);
  const updated = existing
    ? current.map((s) => (s.label === label ? { ...s, timesSeen: s.timesSeen + 1, lastSeenAt: now } : s))
    : [...current, { label, timesSeen: 1, firstSeenAt: now, lastSeenAt: now, exampleReasoning: reasoning }];
  // כותבים לדיסק לפני עדכון הקאש, כדי שכשל כתיבה לעולם לא ישאיר את הקאש
  // "קדימה" ממה שבאמת נשמר בפועל.
  fs.writeFileSync(screensFile(connectorId), JSON.stringify(updated, null, 2), "utf-8");
  cache.set(connectorId, updated);
}

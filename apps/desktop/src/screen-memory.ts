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

export function getLearnedScreens(connectorId: string): LearnedScreen[] {
  try {
    return JSON.parse(fs.readFileSync(screensFile(connectorId), "utf-8")) as LearnedScreen[];
  } catch {
    return [];
  }
}

export function recordScreen(connectorId: string, label: string, reasoning: string): void {
  const screens = getLearnedScreens(connectorId);
  const now = new Date().toISOString();
  const existing = screens.find((s) => s.label === label);
  if (existing) {
    existing.timesSeen += 1;
    existing.lastSeenAt = now;
  } else {
    screens.push({ label, timesSeen: 1, firstSeenAt: now, lastSeenAt: now, exampleReasoning: reasoning });
  }
  fs.writeFileSync(screensFile(connectorId), JSON.stringify(screens, null, 2), "utf-8");
}

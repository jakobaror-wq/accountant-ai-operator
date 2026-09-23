import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { ComputerActionRequest } from "./ai/grok";

/**
 * "מאקרו" - רצף פעולות מוקלט מריצה מוצלחת קודמת של אותה משימה בדיוק (לפי
 * connectorId + טקסט משימה מנורמל), שמאפשר לדלג על קריאת ה-AI בצעדים
 * שבהם המסך החי עדיין תואם למה שנצפה בהקלטה - ר' docs/05-DATA-MODEL.md.
 * לעולם לא כולל ask/done - ר' isEligibleForLearning ב-task-runner.ts.
 */
export interface MacroStep {
  screenLabel: string;
  /** תמונה מוקטנת (PNG, base64) של המסך בזמן ההקלטה - לצורך השוואת-דמיון
   * מול צילום חי בכל ניסיון שידור חוזר, לא לתצוגה. */
  referenceThumbnail: string;
  reasoning: string;
  /** תמיד הגרסה הסמלית (type_credential נשאר {"type":"type_credential",...}
   * בלי הערך האמיתי) - בדיוק כמו RunStepRecord.action. */
  action: ComputerActionRequest;
  requiresApproval: boolean;
}

export interface Macro {
  connectorId: string;
  normalizedTask: string;
  recordedTask: string;
  /** הרזולוציה האמיתית של המסך בזמן ההקלטה - שידור חוזר מסורב לגמרי אם
   * הרזולוציה החיה לא תואמת בדיוק (ר' task-runner.ts). */
  recordedResolution: { width: number; height: number };
  sourceRunId?: string;
  createdAt: string;
  lastUsedAt?: string;
  timesReplayed: number;
  timesFellBackToAi: number;
  steps: MacroStep[];
}

/**
 * מתג-כיבוי גלובלי ברמת קוד - לא UI. אם שידור-חוזר מתגלה כלא אמין בפועל
 * (ר' סעיף "צריך אימות בפועל" ב-docs), אפשר לכבות את התכונה כולה בלי
 * למחוק אותה, פשוט בשינוי הערך הזה ל-false.
 */
export const MACRO_REPLAY_ENABLED = true;

/**
 * התאמת משימות שמרנית בכוונה: התאמה מדויקת (אחרי נירמול רווחים/אותיות)
 * בלבד, לא דמיון מטושטש/embeddings. התאמה מוטעית של מאקרו למשימה "כמעט
 * זהה" אבל שונה במהות היא הרבה יותר מסוכנת בתוכנה חשבונאית מהחמצת הזדמנות
 * אופטימיזציה - עדיף לפספס התאמה אמיתית (ונופל בחזרה ל-AI, תמיד בטוח)
 * מאשר להתאים בטעות למשימה הלא נכונה.
 */
export function normalizeTask(task: string): string {
  return task.trim().replace(/\s+/g, " ").toLowerCase();
}

function macrosFile(connectorId: string): string {
  const dir = path.join(app.getPath("userData"), "connectors", connectorId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "macros.json");
}

/**
 * קאש עצל לפי connector, מאותה סיבה בדיוק כמו screen-memory.ts - הגישה
 * תמיד לפי connectorId בודד, אין פעולת "הכול".
 */
const cache = new Map<string, Record<string, Macro>>();

function loadConnectorMacros(connectorId: string): Record<string, Macro> {
  const cached = cache.get(connectorId);
  if (cached) return cached;
  let loaded: Record<string, Macro>;
  try {
    loaded = JSON.parse(fs.readFileSync(macrosFile(connectorId), "utf-8")) as Record<string, Macro>;
  } catch {
    loaded = {};
  }
  cache.set(connectorId, loaded);
  return loaded;
}

function persist(connectorId: string, updated: Record<string, Macro>): void {
  fs.writeFileSync(macrosFile(connectorId), JSON.stringify(updated, null, 2), "utf-8");
  cache.set(connectorId, updated);
}

export function getMacro(connectorId: string, task: string): Macro | null {
  return loadConnectorMacros(connectorId)[normalizeTask(task)] ?? null;
}

export function saveMacro(
  connectorId: string,
  task: string,
  steps: MacroStep[],
  recordedResolution: { width: number; height: number },
  sourceRunId?: string,
): void {
  const key = normalizeTask(task);
  const macros = loadConnectorMacros(connectorId);
  const macro: Macro = {
    connectorId,
    normalizedTask: key,
    recordedTask: task,
    recordedResolution,
    sourceRunId,
    createdAt: new Date().toISOString(),
    timesReplayed: 0,
    timesFellBackToAi: 0,
    steps,
  };
  persist(connectorId, { ...macros, [key]: macro });
}

export function recordMacroReplay(connectorId: string, task: string): void {
  const key = normalizeTask(task);
  const macros = loadConnectorMacros(connectorId);
  const macro = macros[key];
  if (!macro) return;
  persist(connectorId, {
    ...macros,
    [key]: { ...macro, timesReplayed: macro.timesReplayed + 1, lastUsedAt: new Date().toISOString() },
  });
}

export function recordMacroFallback(connectorId: string, task: string): void {
  const key = normalizeTask(task);
  const macros = loadConnectorMacros(connectorId);
  const macro = macros[key];
  if (!macro) return;
  persist(connectorId, { ...macros, [key]: { ...macro, timesFellBackToAi: macro.timesFellBackToAi + 1 } });
}

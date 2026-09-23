import { captureScreenshot, executeAction, deriveComparisonThumbnail, bitmapDiffScore } from "./computer-use";
import { requestNextAction, CONFIDENCE_THRESHOLD, type HistoryEntry, type GrokStepResult } from "./ai/grok";
import { getConnectorCredentials } from "./settings";
import { getMacro, saveMacro, recordMacroReplay, recordMacroFallback, MACRO_REPLAY_ENABLED, type MacroStep } from "./macros";
import { runIdFor } from "./run-history";

export interface RunStepRecord {
  step: number;
  timestamp: string;
  reasoning?: string;
  screenLabel?: string;
  confidence?: number;
  action?: HistoryEntry["action"];
  requiresApproval?: boolean;
  decision?: "approved" | "rejected";
  outcome: "executed" | "rejected" | "stopped" | "failed" | "done" | "asked";
  error?: string;
}

export interface RunRecord {
  connectorId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  status: "in-progress" | "done" | "stopped" | "rejected" | "error" | "max-steps-reached";
  summary?: string;
  steps: RunStepRecord[];
}

export type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | {
      type: "action";
      step: number;
      reasoning: string;
      screenLabel: string;
      confidence: number;
      action: HistoryEntry["action"];
    }
  | {
      type: "awaiting-approval";
      step: number;
      reasoning: string;
      confidence: number;
      action: HistoryEntry["action"];
    }
  | { type: "awaiting-answer"; step: number; question: string }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" }
  | { type: "run-summary"; run: RunRecord };

const MAX_STEPS = 40;
// הופחת מ-500ms: 40 צעדים * 500ms = עד 20 שניות המתנה קבועה נטו לכל משימה,
// מעל latency הקריאה ל-AI עצמה. אין היום מנגנון שמזהה בפועל "המסך התייצב"
// (ר' docs/05-DATA-MODEL.md/09-COMPUTER-USE-AGENT.md) - זו עדיין השהיה קבועה
// עיוורת, רק קצרה יותר. כמו הפחתת ה-autoDelayMs של nut-js, זה שינוי שמשפיע
// על התנהגות אמיתית מול תוכנה חיצונית ולא ניתן לאמת מהסביבה הזו - צריך
// אימות בפועל שתוכנות איטיות/ישנות עדיין מספיקות "לעכל" כל שינוי מסך לפני
// שהצעד הבא מצלם ומחליט מחדש.
const STEP_PAUSE_MS = 250;

/**
 * סף התאמה לשידור-חוזר של מאקרו: bitmapDiffScore (0=זהה, 1=הפוך לגמרי) בין
 * תמונונת המסך החי לבין מה שנצפה בהקלטה. ערך שמרני בכוונה - עדיף ליפול
 * בחזרה ל-AI (תמיד בטוח, רק מבטל את יתרון המהירות לצעד הזה) מאשר "להתאים"
 * בטעות בין שני מסכים שרק נראים דומים ולשחזר קליק במקום הלא נכון. לא נבדק
 * בפועל מול תוכנה אמיתית - ר' docs/09-COMPUTER-USE-AGENT.md.
 */
const MACRO_MATCH_THRESHOLD = 0.05;

/**
 * שגיאות רשת (fetch failed וכו') מסתירות את הסיבה האמיתית מאחורי err.cause
 * (ENOTFOUND/ECONNREFUSED/תעודת TLS/פרוקסי) - בלי זה המשתמש רואה רק
 * "TypeError: fetch failed" בלי שום רמז לאבחון.
 */
function scaleActionToRealScreen(
  action: HistoryEntry["action"],
  scaleX: number,
  scaleY: number,
): HistoryEntry["action"] {
  if (scaleX === 1 && scaleY === 1) return action;
  if (action.type === "click" || action.type === "double_click") {
    return { ...action, x: Math.round(action.x * scaleX), y: Math.round(action.y * scaleY) };
  }
  return action;
}

const MAX_AI_RETRIES = 2;
const AI_RETRY_DELAY_MS = 1500;

/**
 * מבחין בין שגיאות חולפות (תקלת רשת, תקלת שרת זמנית, תשובה ריקה/פגומה חד-
 * פעמית) לבין שגיאות שלא ישתפרו מניסיון חוזר (מפתח API שגוי, בקשה לא
 * תקינה) - retry על הסוג השני רק מבזבז זמן ומעכב את הדיווח האמיתי למשתמש.
 */
function isRetryableAiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const statusMatch = err.message.match(/^xai-error:(\d+):/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 429 || status >= 500;
  }
  return true;
}

async function requestNextActionWithRetry(
  params: Parameters<typeof requestNextAction>[0],
): Promise<GrokStepResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestNextAction(params);
    } catch (err) {
      if (attempt >= MAX_AI_RETRIES || !isRetryableAiError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAY_MS));
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : "";
    return `${err.name}: ${err.message}${causeText}`;
  }
  return String(err);
}

export async function runComputerUseTask(params: {
  apiKey: string;
  task: string;
  connectorId: string;
  knownScreens: string[];
  onUpdate: (event: TaskUpdateEvent) => void;
  shouldStop: () => boolean;
  waitForApproval: (
    step: number,
    reasoning: string,
    confidence: number,
    action: HistoryEntry["action"],
  ) => Promise<boolean>;
  waitForAnswer: (step: number, question: string) => Promise<string>;
  /** ממשיכים ריצה שהופסקה (קריסה/סגירה) במקום להתחיל מאפס ולסכן פעולה כפולה. */
  resumeFrom?: { startedAt: string; steps: RunStepRecord[] };
}): Promise<void> {
  const history: HistoryEntry[] = (params.resumeFrom?.steps ?? [])
    .filter((s) => (s.outcome === "executed" || s.outcome === "done" || s.outcome === "asked") && s.reasoning && s.action)
    .map((s) => ({ reasoning: s.reasoning as string, action: s.action as HistoryEntry["action"] }));
  const steps: RunStepRecord[] = params.resumeFrom ? [...params.resumeFrom.steps] : [];
  const startedAt = params.resumeFrom?.startedAt ?? new Date().toISOString();
  const startStep = steps.length + 1;

  // מאקרו: רק לריצה טרייה (לא resumeFrom - ר' הערה ב-macros.ts/05-DATA-MODEL.md
  // למה ריצה שממשיכה קריסה לא מתאימה כמקור/יעד לשידור-חוזר). macroActive
  // הופך ל-false לצמיתות ברגע הראשון שצעד לא תואם - לעולם לא מנסים "לחזור"
  // לשידור חוזר באמצע אותה ריצה אחרי שהיא נפלה ל-AI פעם אחת.
  const macro = params.resumeFrom || !MACRO_REPLAY_ENABLED ? null : getMacro(params.connectorId, params.task);
  let macroActive = Boolean(macro);
  let macroCursor = 0;
  let resolutionChecked = false;
  let anyStepUsedAi = false;
  const executedMacroSteps: MacroStep[] = [];

  function finish(status: RunRecord["status"], summary?: string): void {
    params.onUpdate({
      type: "run-summary",
      run: {
        connectorId: params.connectorId,
        task: params.task,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        summary,
        steps,
      },
    });
  }

  const checkpoint = () => finish("in-progress");

  for (let step = startStep; step <= MAX_STEPS; step++) {
    if (params.shouldStop()) {
      params.onUpdate({ type: "stopped" });
      finish("stopped");
      return;
    }

    params.onUpdate({ type: "step-start", step });

    let screenshot;
    try {
      screenshot = await captureScreenshot();
    } catch (err) {
      const message = `screenshot-failed: ${describeError(err)}`;
      steps.push({ step, timestamp: new Date().toISOString(), outcome: "failed", error: message });
      params.onUpdate({ type: "error", step, message });
      finish("error", message);
      return;
    }
    params.onUpdate({ type: "screenshot", step, base64Png: screenshot.base64Png });

    // תמונונת-השוואה נגזרת פעם אחת לכל צעד, בין אם יש מאקרו פעיל (משמשת
    // מייד להשוואת-דמיון) ובין אם לא (נשמרת ל-executedMacroSteps, למקרה
    // שהריצה הזו תזכה להפוך בעצמה למאקרו בסיום, ר' "done" למטה).
    const stepThumbnail = deriveComparisonThumbnail(screenshot.base64Png);

    if (macro && !resolutionChecked) {
      // בדיקה חד-פעמית (לא לפי macroCursor - הוא לא מתקדם אם ההתאמה נכשלת
      // כבר בצעד הראשון, מה שהיה גורם לבדיקה הזו לרוץ מחדש כל צעד): שידור-
      // חוזר מסורב לגמרי אם הרזולוציה החיה לא תואמת בדיוק את זו שבזמן
      // ההקלטה - קואורדינטות אבסולוטיות שנשמרו במאקרו לא בטוחות לפרש נכון
      // על מסך/DPI שונה (ר' docs/05-DATA-MODEL.md).
      resolutionChecked = true;
      if (
        screenshot.realWidth !== macro.recordedResolution.width ||
        screenshot.realHeight !== macro.recordedResolution.height
      ) {
        macroActive = false;
      }
    }

    let next: GrokStepResult | undefined;
    let usedMacro = false;

    if (macroActive && macro && macroCursor < macro.steps.length) {
      const macroStep = macro.steps[macroCursor];
      if (bitmapDiffScore(stepThumbnail, macroStep.referenceThumbnail) <= MACRO_MATCH_THRESHOLD) {
        next = {
          reasoning: macroStep.reasoning,
          screenLabel: macroStep.screenLabel,
          confidence: 1,
          requiresApproval: macroStep.requiresApproval,
          action: macroStep.action,
        };
        usedMacro = true;
        macroCursor += 1;
        recordMacroReplay(params.connectorId, params.task);
      } else {
        // נפילה קבועה ל-AI לשאר הריצה הזו - לא מנסים "למצוא איפה אנחנו"
        // מחדש באמצע רצף שסטה; זה הרבה יותר מסוכן מלוותר על האופטימיזציה.
        macroActive = false;
        recordMacroFallback(params.connectorId, params.task);
      }
    }

    if (!next) {
      anyStepUsedAi = true;
      try {
        next = await requestNextActionWithRetry({
          apiKey: params.apiKey,
          task: params.task,
          screenshotBase64: screenshot.base64Png,
          screenWidth: screenshot.width,
          screenHeight: screenshot.height,
          history,
          knownScreens: params.knownScreens,
          hasSavedCredentials: Boolean(getConnectorCredentials(params.connectorId)),
        });
      } catch (err) {
        const message = `ai-request-failed: ${describeError(err)}`;
        steps.push({ step, timestamp: new Date().toISOString(), outcome: "failed", error: message });
        params.onUpdate({ type: "error", step, message });
        finish("error", message);
        return;
      }
    }

    // המודל רואה צילום מסך מוקטן (ר' computer-use.ts) ומחזיר קואורדינטות באותו
    // מרחב מוקטן - צריך לקנפס אותן בחזרה לרזולוציה האמיתית לפני כל שימוש
    // (תצוגה, אישור, ביצוע בפועל), כדי שהקליק יפגע במקום הנכון על המסך.
    // פעולה שמקורה במאקרו כבר במרחב-המסך-האמיתי (כך MacroStep.action נשמר
    // מלכתחילה, ר' למטה) - קנפוס נוסף עליה יכפיל את הסקיילינג בטעות.
    next.action = usedMacro
      ? next.action
      : scaleActionToRealScreen(next.action, screenshot.realWidth / screenshot.width, screenshot.realHeight / screenshot.height);

    params.onUpdate({
      type: "action",
      step,
      reasoning: next.reasoning,
      screenLabel: next.screenLabel,
      confidence: next.confidence,
      action: next.action,
    });

    if (next.action.type === "done") {
      steps.push({
        step,
        timestamp: new Date().toISOString(),
        reasoning: next.reasoning,
        screenLabel: next.screenLabel,
        confidence: next.confidence,
        action: next.action,
        requiresApproval: false,
        outcome: "done",
      });
      // לומדים מאקרו רק מריצה טרייה (לא resumeFrom - ר' הערה למעלה) שהסתיימה
      // ב-done אמיתי, בלי אף צעד "ask" (לא דטרמיניסטי מספיק כדי לשדר חוזר -
      // ר' macros.ts), ועם לפחות פעולה אחת בפועל. אם המאקרו הקיים כבר כיסה
      // 100% מהריצה בלי אף נפילה ל-AI - אין מה ללמוד מחדש, שומרים על אותו קובץ.
      const hasAskStep = steps.some((s) => s.outcome === "asked");
      const fullyReplayedExisting = Boolean(macro) && !anyStepUsedAi;
      if (!params.resumeFrom && !hasAskStep && !fullyReplayedExisting && executedMacroSteps.length > 0) {
        saveMacro(
          params.connectorId,
          params.task,
          executedMacroSteps,
          { width: screenshot.realWidth, height: screenshot.realHeight },
          runIdFor(startedAt),
        );
      }
      params.onUpdate({ type: "done", summary: next.action.summary });
      finish("done", next.action.summary);
      return;
    }

    if (next.action.type === "ask") {
      params.onUpdate({ type: "awaiting-answer", step, question: next.action.question });
      const answer = await params.waitForAnswer(step, next.action.question);

      if (params.shouldStop()) {
        params.onUpdate({ type: "stopped" });
        finish("stopped");
        return;
      }

      const qaReasoning = `שאלתי: "${next.action.question}" - המשתמש ענה: "${answer}"`;
      steps.push({
        step,
        timestamp: new Date().toISOString(),
        reasoning: qaReasoning,
        screenLabel: next.screenLabel,
        confidence: next.confidence,
        action: { type: "ask", question: next.action.question },
        requiresApproval: false,
        outcome: "asked",
      });
      checkpoint();
      history.push({ reasoning: qaReasoning, action: next.action });
      continue;
    }

    // רק פעולות שמשנות נתון בתוך התוכנה דורשות אישור אנושי מפורש - שאיבת מידע,
    // ניווט וייצוא קבצים זורמים חופשי (ר' דרישה מפורשת + criteria ב-grok.ts).
    if (next.requiresApproval) {
      params.onUpdate({
        type: "awaiting-approval",
        step,
        reasoning: next.reasoning,
        confidence: next.confidence,
        action: next.action,
      });
      const approved = await params.waitForApproval(step, next.reasoning, next.confidence, next.action);

      if (params.shouldStop()) {
        steps.push({
          step,
          timestamp: new Date().toISOString(),
          reasoning: next.reasoning,
          screenLabel: next.screenLabel,
          confidence: next.confidence,
          action: next.action,
          requiresApproval: true,
          decision: approved ? "approved" : "rejected",
          outcome: "stopped",
        });
        params.onUpdate({ type: "stopped" });
        finish("stopped");
        return;
      }
      if (!approved) {
        steps.push({
          step,
          timestamp: new Date().toISOString(),
          reasoning: next.reasoning,
          screenLabel: next.screenLabel,
          confidence: next.confidence,
          action: next.action,
          requiresApproval: true,
          decision: "rejected",
          outcome: "rejected",
        });
        params.onUpdate({ type: "rejected", step });
        finish("rejected");
        return;
      }
    }

    // "type_credential" הוא פעולה סמלית - הערך האמיתי (סיסמה/שם משתמש) לעולם
    // לא עובר דרך המודל ולא נכתב ליומן הריצות; הוא נשלף כאן, רגע לפני ביצוע
    // בפועל, ורק ה-action הסמלי (next.action) נשמר ב-steps/history.
    let actionToExecute = next.action;
    if (actionToExecute.type === "type_credential") {
      const creds = getConnectorCredentials(params.connectorId);
      const value = creds ? (actionToExecute.field === "username" ? creds.username : creds.password) : undefined;
      if (!value) {
        const fieldLabel = actionToExecute.field === "username" ? "שם משתמש" : "סיסמה";
        const message = `no-saved-credentials: לא נשמרו פרטי התחברות (${fieldLabel}) עבור התוכנה הזו. אפשר לשמור אותם במסך ה-AI Agent ולנסות שוב.`;
        steps.push({
          step,
          timestamp: new Date().toISOString(),
          reasoning: next.reasoning,
          screenLabel: next.screenLabel,
          confidence: next.confidence,
          action: actionToExecute,
          requiresApproval: false,
          outcome: "failed",
          error: message,
        });
        params.onUpdate({ type: "error", step, message });
        finish("error", message);
        return;
      }
      actionToExecute = { type: "type", text: value };
    }

    try {
      await executeAction(actionToExecute);
    } catch (err) {
      const message = `action-failed: ${describeError(err)}`;
      steps.push({
        step,
        timestamp: new Date().toISOString(),
        reasoning: next.reasoning,
        screenLabel: next.screenLabel,
        confidence: next.confidence,
        action: next.action,
        requiresApproval: next.requiresApproval,
        decision: next.requiresApproval ? "approved" : undefined,
        outcome: "failed",
        error: message,
      });
      params.onUpdate({ type: "error", step, message });
      finish("error", message);
      return;
    }

    steps.push({
      step,
      timestamp: new Date().toISOString(),
      reasoning: next.reasoning,
      screenLabel: next.screenLabel,
      confidence: next.confidence,
      action: next.action,
      requiresApproval: next.requiresApproval,
      decision: next.requiresApproval ? "approved" : undefined,
      outcome: "executed",
    });
    checkpoint();

    // נאסף בכל צעד שהצליח (גם כשלא היה מאקרו פעיל) - אם הריצה הזו עצמה
    // תסתיים ב-done תקין, זה מה ש-saveMacro ישמור כמאקרו חדש/מעודכן.
    executedMacroSteps.push({
      screenLabel: next.screenLabel,
      referenceThumbnail: stepThumbnail,
      reasoning: next.reasoning,
      action: next.action,
      requiresApproval: next.requiresApproval,
    });

    history.push({ reasoning: next.reasoning, action: next.action });
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }

  params.onUpdate({ type: "max-steps-reached" });
  finish("max-steps-reached");
}

export { CONFIDENCE_THRESHOLD };

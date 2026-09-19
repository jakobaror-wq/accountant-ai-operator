import { captureScreenshot, executeAction } from "./computer-use";
import { requestNextAction, CONFIDENCE_THRESHOLD, type HistoryEntry } from "./ai/grok";

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
const STEP_PAUSE_MS = 500;

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

    let next;
    try {
      next = await requestNextAction({
        apiKey: params.apiKey,
        task: params.task,
        screenshotBase64: screenshot.visionBase64Png,
        screenWidth: screenshot.visionWidth,
        screenHeight: screenshot.visionHeight,
        history,
        knownScreens: params.knownScreens,
      });
    } catch (err) {
      const message = `ai-request-failed: ${describeError(err)}`;
      steps.push({ step, timestamp: new Date().toISOString(), outcome: "failed", error: message });
      params.onUpdate({ type: "error", step, message });
      finish("error", message);
      return;
    }

    // המודל רואה צילום מסך מוקטן (ר' computer-use.ts) ומחזיר קואורדינטות באותו
    // מרחב מוקטן - צריך לקנפס אותן בחזרה לרזולוציה האמיתית לפני כל שימוש
    // (תצוגה, אישור, ביצוע בפועל), כדי שהקליק יפגע במקום הנכון על המסך.
    next.action = scaleActionToRealScreen(
      next.action,
      screenshot.width / screenshot.visionWidth,
      screenshot.height / screenshot.visionHeight,
    );

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

    try {
      await executeAction(next.action);
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

    history.push({ reasoning: next.reasoning, action: next.action });
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }

  params.onUpdate({ type: "max-steps-reached" });
  finish("max-steps-reached");
}

export { CONFIDENCE_THRESHOLD };

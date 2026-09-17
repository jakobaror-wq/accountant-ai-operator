import { captureScreenshot, executeAction } from "./computer-use";
import { requestNextAction, type HistoryEntry } from "./ai/grok";

export interface RunStepRecord {
  step: number;
  timestamp: string;
  reasoning?: string;
  action?: HistoryEntry["action"];
  requiresApproval?: boolean;
  decision?: "approved" | "rejected";
  outcome: "executed" | "rejected" | "stopped" | "failed" | "done";
  error?: string;
}

export interface RunRecord {
  task: string;
  startedAt: string;
  finishedAt: string;
  status: "done" | "stopped" | "rejected" | "error" | "max-steps-reached";
  summary?: string;
  steps: RunStepRecord[];
}

export type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | { type: "action"; step: number; reasoning: string; action: HistoryEntry["action"] }
  | { type: "awaiting-approval"; step: number; reasoning: string; action: HistoryEntry["action"] }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" }
  | { type: "run-summary"; run: RunRecord };

const MAX_STEPS = 40;
const STEP_PAUSE_MS = 500;

export async function runComputerUseTask(params: {
  apiKey: string;
  task: string;
  onUpdate: (event: TaskUpdateEvent) => void;
  shouldStop: () => boolean;
  waitForApproval: (step: number, reasoning: string, action: HistoryEntry["action"]) => Promise<boolean>;
}): Promise<void> {
  const history: HistoryEntry[] = [];
  const steps: RunStepRecord[] = [];
  const startedAt = new Date().toISOString();

  function finish(status: RunRecord["status"], summary?: string): void {
    params.onUpdate({
      type: "run-summary",
      run: { task: params.task, startedAt, finishedAt: new Date().toISOString(), status, summary, steps },
    });
  }

  for (let step = 1; step <= MAX_STEPS; step++) {
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
      const message = `screenshot-failed: ${String(err)}`;
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
        screenshotBase64: screenshot.base64Png,
        screenWidth: screenshot.width,
        screenHeight: screenshot.height,
        history,
      });
    } catch (err) {
      const message = `ai-request-failed: ${String(err)}`;
      steps.push({ step, timestamp: new Date().toISOString(), outcome: "failed", error: message });
      params.onUpdate({ type: "error", step, message });
      finish("error", message);
      return;
    }

    params.onUpdate({ type: "action", step, reasoning: next.reasoning, action: next.action });

    if (next.action.type === "done") {
      steps.push({
        step,
        timestamp: new Date().toISOString(),
        reasoning: next.reasoning,
        action: next.action,
        requiresApproval: false,
        outcome: "done",
      });
      params.onUpdate({ type: "done", summary: next.action.summary });
      finish("done", next.action.summary);
      return;
    }

    if (next.requiresApproval) {
      params.onUpdate({ type: "awaiting-approval", step, reasoning: next.reasoning, action: next.action });
      const approved = await params.waitForApproval(step, next.reasoning, next.action);

      if (params.shouldStop()) {
        steps.push({
          step,
          timestamp: new Date().toISOString(),
          reasoning: next.reasoning,
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
      const message = `action-failed: ${String(err)}`;
      steps.push({
        step,
        timestamp: new Date().toISOString(),
        reasoning: next.reasoning,
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
      action: next.action,
      requiresApproval: next.requiresApproval,
      decision: next.requiresApproval ? "approved" : undefined,
      outcome: "executed",
    });

    history.push({ reasoning: next.reasoning, action: next.action });
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }

  params.onUpdate({ type: "max-steps-reached" });
  finish("max-steps-reached");
}

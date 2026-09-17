import { captureScreenshot, executeAction } from "./computer-use";
import { requestNextAction, type HistoryEntry } from "./ai/grok";

export type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | { type: "action"; step: number; reasoning: string; action: HistoryEntry["action"] }
  | { type: "awaiting-approval"; step: number; reasoning: string; action: HistoryEntry["action"] }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" };

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

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (params.shouldStop()) {
      params.onUpdate({ type: "stopped" });
      return;
    }

    params.onUpdate({ type: "step-start", step });

    let screenshot;
    try {
      screenshot = await captureScreenshot();
    } catch (err) {
      params.onUpdate({ type: "error", step, message: `screenshot-failed: ${String(err)}` });
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
      params.onUpdate({ type: "error", step, message: `ai-request-failed: ${String(err)}` });
      return;
    }

    params.onUpdate({ type: "action", step, reasoning: next.reasoning, action: next.action });

    if (next.action.type === "done") {
      params.onUpdate({ type: "done", summary: next.action.summary });
      return;
    }

    if (next.requiresApproval) {
      params.onUpdate({ type: "awaiting-approval", step, reasoning: next.reasoning, action: next.action });
      const approved = await params.waitForApproval(step, next.reasoning, next.action);

      if (params.shouldStop()) {
        params.onUpdate({ type: "stopped" });
        return;
      }
      if (!approved) {
        params.onUpdate({ type: "rejected", step });
        return;
      }
    }

    try {
      await executeAction(next.action);
    } catch (err) {
      params.onUpdate({ type: "error", step, message: `action-failed: ${String(err)}` });
      return;
    }

    history.push({ reasoning: next.reasoning, action: next.action });
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }

  params.onUpdate({ type: "max-steps-reached" });
}

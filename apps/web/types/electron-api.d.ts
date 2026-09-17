export {};

interface LaunchResult {
  success: boolean;
  error?: string;
}

type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "done"; summary: string };

type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | { type: "action"; step: number; reasoning: string; action: ComputerActionRequest }
  | { type: "awaiting-approval"; step: number; reasoning: string; action: ComputerActionRequest }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" };

interface RunTaskResult {
  started: boolean;
  error?: "task-already-running" | "no-api-key";
}

interface ElectronAPI {
  isElectron: true;
  getConnectorPaths(): Promise<Record<string, string>>;
  pickExecutable(connectorId: string): Promise<string | null>;
  launchExecutable(connectorId: string): Promise<LaunchResult>;

  getXaiKeyStatus(): Promise<boolean>;
  saveXaiKey(key: string): Promise<boolean>;
  clearXaiKey(): Promise<boolean>;

  runTask(task: string): Promise<RunTaskResult>;
  stopTask(): Promise<boolean>;
  approveAction(): Promise<boolean>;
  rejectAction(): Promise<boolean>;
  onTaskUpdate(callback: (event: TaskUpdateEvent) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

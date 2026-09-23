export {};

interface LaunchResult {
  success: boolean;
  error?: string;
}

type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "type_credential"; field: "username" | "password" }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "ask"; question: string }
  | { type: "done"; summary: string };

interface RunStepRecord {
  step: number;
  timestamp: string;
  reasoning?: string;
  screenLabel?: string;
  confidence?: number;
  action?: ComputerActionRequest;
  requiresApproval?: boolean;
  decision?: "approved" | "rejected";
  outcome: "executed" | "rejected" | "stopped" | "failed" | "done" | "asked";
  error?: string;
}

interface LearnedScreen {
  label: string;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  exampleReasoning: string;
}

interface RunRecord {
  connectorId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  status: "in-progress" | "done" | "stopped" | "rejected" | "error" | "max-steps-reached";
  summary?: string;
  steps: RunStepRecord[];
}

interface StoredRunRecord extends RunRecord {
  id: string;
}

type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | {
      type: "action";
      step: number;
      reasoning: string;
      screenLabel: string;
      confidence: number;
      action: ComputerActionRequest;
      source: "ai" | "macro";
    }
  | {
      type: "awaiting-approval";
      step: number;
      reasoning: string;
      confidence: number;
      action: ComputerActionRequest;
    }
  | { type: "awaiting-answer"; step: number; question: string }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" }
  | { type: "run-summary"; run: RunRecord };

interface RunTaskResult {
  started: boolean;
  error?: "task-already-running" | "no-api-key";
}

interface ResolveDroppedPathResult {
  success: boolean;
  path?: string;
  error?: "invalid-shortcut" | "target-not-found";
}

interface AgentStatus {
  running: boolean;
  connectorId: string | null;
  task: string | null;
  pendingApproval: { step: number; reasoning: string; confidence: number; action: ComputerActionRequest } | null;
  pendingQuestion: { step: number; question: string } | null;
}

interface ElectronAPI {
  isElectron: true;
  getAppVersion(): Promise<string>;
  getConnectorPaths(): Promise<Record<string, string>>;
  pickExecutable(connectorId: string): Promise<string | null>;
  launchExecutable(connectorId: string): Promise<LaunchResult>;
  resolveDroppedPath(connectorId: string, droppedPath: string): Promise<ResolveDroppedPathResult>;

  getXaiKeyStatus(): Promise<boolean>;
  saveXaiKey(key: string): Promise<boolean>;
  clearXaiKey(): Promise<boolean>;

  getConnectorCredentialsStatus(connectorId: string): Promise<boolean>;
  saveConnectorCredentials(connectorId: string, username: string, password: string): Promise<boolean>;
  clearConnectorCredentials(connectorId: string): Promise<boolean>;

  runTask(task: string, connectorId: string, resumeRunId?: string): Promise<RunTaskResult>;
  stopTask(): Promise<boolean>;
  approveAction(): Promise<boolean>;
  rejectAction(): Promise<boolean>;
  answerQuestion(answer: string): Promise<boolean>;
  listRuns(): Promise<StoredRunRecord[]>;
  getLearnedScreens(connectorId: string): Promise<LearnedScreen[]>;
  getIncompleteRun(connectorId: string): Promise<StoredRunRecord | null>;
  getAgentStatus(): Promise<AgentStatus>;
  onTaskUpdate(callback: (event: TaskUpdateEvent) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

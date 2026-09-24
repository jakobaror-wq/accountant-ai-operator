import { contextBridge, ipcRenderer } from "electron";

export interface LaunchResult {
  success: boolean;
  error?: string;
}

export type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "type_credential"; field: "username" | "password" }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "ask"; question: string }
  | { type: "done"; summary: string };

export interface RunStepRecord {
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
  source?: "ai" | "macro";
}

export interface LearnedScreen {
  label: string;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  exampleReasoning: string;
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

export interface StoredRunRecord extends RunRecord {
  id: string;
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
      action: ComputerActionRequest;
      source: "ai" | "macro";
    }
  | {
      type: "awaiting-approval";
      step: number;
      reasoning: string;
      confidence: number;
      action: ComputerActionRequest;
      source: "ai" | "macro";
    }
  | { type: "awaiting-answer"; step: number; question: string }
  | { type: "rejected"; step: number }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" }
  | { type: "run-summary"; run: RunRecord };

export interface RunTaskResult {
  started: boolean;
  error?: "task-already-running" | "no-api-key" | "window-not-found";
  /** פירוט נוסף כשה-error הוא "window-not-found" - ר' window-focus.ts. */
  detail?: string;
}

export interface ResolveDroppedPathResult {
  success: boolean;
  path?: string;
  error?: "invalid-shortcut" | "target-not-found";
}

export interface AgentStatus {
  running: boolean;
  connectorId: string | null;
  task: string | null;
  pendingApproval: {
    step: number;
    reasoning: string;
    confidence: number;
    action: ComputerActionRequest;
    source: "ai" | "macro";
  } | null;
  pendingQuestion: { step: number; question: string } | null;
}

const electronAPI = {
  isElectron: true as const,

  getAppVersion: (): Promise<string> => ipcRenderer.invoke("aiop:get-app-version"),

  getConnectorPaths: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("aiop:get-connector-paths"),
  pickExecutable: (connectorId: string): Promise<string | null> =>
    ipcRenderer.invoke("aiop:pick-executable", connectorId),
  launchExecutable: (connectorId: string): Promise<LaunchResult> =>
    ipcRenderer.invoke("aiop:launch-executable", connectorId),
  resolveDroppedPath: (connectorId: string, droppedPath: string): Promise<ResolveDroppedPathResult> =>
    ipcRenderer.invoke("aiop:resolve-dropped-path", connectorId, droppedPath),

  getXaiKeyStatus: (): Promise<boolean> => ipcRenderer.invoke("aiop:get-xai-key-status"),
  saveXaiKey: (key: string): Promise<boolean> => ipcRenderer.invoke("aiop:save-xai-key", key),
  clearXaiKey: (): Promise<boolean> => ipcRenderer.invoke("aiop:clear-xai-key"),

  getConnectorCredentialsStatus: (connectorId: string): Promise<boolean> =>
    ipcRenderer.invoke("aiop:get-connector-credentials-status", connectorId),
  saveConnectorCredentials: (connectorId: string, username: string, password: string): Promise<boolean> =>
    ipcRenderer.invoke("aiop:save-connector-credentials", connectorId, username, password),
  clearConnectorCredentials: (connectorId: string): Promise<boolean> =>
    ipcRenderer.invoke("aiop:clear-connector-credentials", connectorId),

  runTask: (task: string, connectorId: string, resumeRunId?: string): Promise<RunTaskResult> =>
    ipcRenderer.invoke("aiop:run-task", task, connectorId, resumeRunId),
  stopTask: (): Promise<boolean> => ipcRenderer.invoke("aiop:stop-task"),
  approveAction: (): Promise<boolean> => ipcRenderer.invoke("aiop:approve-action"),
  rejectAction: (): Promise<boolean> => ipcRenderer.invoke("aiop:reject-action"),
  answerQuestion: (answer: string): Promise<boolean> => ipcRenderer.invoke("aiop:answer-question", answer),
  listRuns: (): Promise<StoredRunRecord[]> => ipcRenderer.invoke("aiop:list-runs"),
  getLearnedScreens: (connectorId: string): Promise<LearnedScreen[]> =>
    ipcRenderer.invoke("aiop:get-learned-screens", connectorId),
  getIncompleteRun: (connectorId: string): Promise<StoredRunRecord | null> =>
    ipcRenderer.invoke("aiop:get-incomplete-run", connectorId),
  getAgentStatus: (): Promise<AgentStatus> => ipcRenderer.invoke("aiop:get-agent-status"),
  onTaskUpdate: (callback: (event: TaskUpdateEvent) => void): (() => void) => {
    const handler = (_event: unknown, data: TaskUpdateEvent) => callback(data);
    ipcRenderer.on("aiop:task-update", handler);
    return () => ipcRenderer.removeListener("aiop:task-update", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;

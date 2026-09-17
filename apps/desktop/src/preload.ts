import { contextBridge, ipcRenderer } from "electron";

export interface LaunchResult {
  success: boolean;
  error?: string;
}

export type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "done"; summary: string };

export type TaskUpdateEvent =
  | { type: "step-start"; step: number }
  | { type: "screenshot"; step: number; base64Png: string }
  | { type: "action"; step: number; reasoning: string; action: ComputerActionRequest }
  | { type: "error"; step: number; message: string }
  | { type: "done"; summary: string }
  | { type: "stopped" }
  | { type: "max-steps-reached" };

export interface RunTaskResult {
  started: boolean;
  error?: "task-already-running" | "no-api-key";
}

const electronAPI = {
  isElectron: true as const,

  getConnectorPaths: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("aiop:get-connector-paths"),
  pickExecutable: (connectorId: string): Promise<string | null> =>
    ipcRenderer.invoke("aiop:pick-executable", connectorId),
  launchExecutable: (connectorId: string): Promise<LaunchResult> =>
    ipcRenderer.invoke("aiop:launch-executable", connectorId),

  getXaiKeyStatus: (): Promise<boolean> => ipcRenderer.invoke("aiop:get-xai-key-status"),
  saveXaiKey: (key: string): Promise<boolean> => ipcRenderer.invoke("aiop:save-xai-key", key),
  clearXaiKey: (): Promise<boolean> => ipcRenderer.invoke("aiop:clear-xai-key"),

  runTask: (task: string): Promise<RunTaskResult> => ipcRenderer.invoke("aiop:run-task", task),
  stopTask: (): Promise<boolean> => ipcRenderer.invoke("aiop:stop-task"),
  onTaskUpdate: (callback: (event: TaskUpdateEvent) => void): (() => void) => {
    const handler = (_event: unknown, data: TaskUpdateEvent) => callback(data);
    ipcRenderer.on("aiop:task-update", handler);
    return () => ipcRenderer.removeListener("aiop:task-update", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;

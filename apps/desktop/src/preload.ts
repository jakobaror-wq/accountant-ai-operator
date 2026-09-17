import { contextBridge, ipcRenderer } from "electron";

export interface LaunchResult {
  success: boolean;
  error?: string;
}

const electronAPI = {
  isElectron: true as const,
  getConnectorPaths: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("aiop:get-connector-paths"),
  pickExecutable: (connectorId: string): Promise<string | null> =>
    ipcRenderer.invoke("aiop:pick-executable", connectorId),
  launchExecutable: (connectorId: string): Promise<LaunchResult> =>
    ipcRenderer.invoke("aiop:launch-executable", connectorId),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;

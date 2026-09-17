export {};

interface LaunchResult {
  success: boolean;
  error?: string;
}

interface ElectronAPI {
  isElectron: true;
  getConnectorPaths(): Promise<Record<string, string>>;
  pickExecutable(connectorId: string): Promise<string | null>;
  launchExecutable(connectorId: string): Promise<LaunchResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

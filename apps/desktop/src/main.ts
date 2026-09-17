import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";

/**
 * ברירת המחדל היא האתר החי ב-Vercel. אפשר לדרוס בזמן פיתוח מקומי:
 *   AIOP_WEB_URL=http://localhost:3100 npm start
 */
const WEB_URL = process.env.AIOP_WEB_URL ?? "https://accountant-ai-operator.vercel.app";

function connectorPathsFile(): string {
  return path.join(app.getPath("userData"), "connector-paths.json");
}

function readConnectorPaths(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(connectorPathsFile(), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeConnectorPaths(data: Record<string, string>): void {
  fs.mkdirSync(path.dirname(connectorPathsFile()), { recursive: true });
  fs.writeFileSync(connectorPathsFile(), JSON.stringify(data, null, 2), "utf-8");
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const allowedOrigin = new URL(WEB_URL).origin;

  // קישורים חיצוניים (target=_blank, כמו כפתורי "התחבר ל-X") נפתחים בדפדפן הרגיל,
  // לא בתוך חלון האפליקציה - זה לא חלק מהמוצר.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void win.loadURL(WEB_URL);
  return win;
}

app.whenReady().then(() => {
  ipcMain.handle("aiop:get-connector-paths", () => readConnectorPaths());

  ipcMain.handle("aiop:pick-executable", async (event, connectorId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: "בחר/י את קובץ ההפעלה של התוכנה",
      properties: ["openFile"],
      filters:
        process.platform === "win32" ? [{ name: "תוכניות (exe)", extensions: ["exe"] }] : undefined,
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const chosenPath = result.filePaths[0];
    const current = readConnectorPaths();
    current[connectorId] = chosenPath;
    writeConnectorPaths(current);
    return chosenPath;
  });

  ipcMain.handle("aiop:launch-executable", async (_event, connectorId: string) => {
    const current = readConnectorPaths();
    const target = current[connectorId];
    if (!target || !fs.existsSync(target)) {
      return { success: false, error: "no-path-configured" as const };
    }
    const openError = await shell.openPath(target);
    return openError ? { success: false, error: openError } : { success: true };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

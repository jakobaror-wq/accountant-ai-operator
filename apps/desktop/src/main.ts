import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import fs from "node:fs";
import { getXaiApiKey, hasXaiApiKey, setXaiApiKey, clearXaiApiKey } from "./settings";
import { runComputerUseTask, type TaskUpdateEvent } from "./task-runner";
import { saveRun, listRuns, getRun, findIncompleteRun } from "./run-history";
import { getLearnedScreens, recordScreen } from "./screen-memory";

/**
 * ברירת המחדל היא האתר החי ב-Vercel. אפשר לדרוס בזמן פיתוח מקומי:
 *   AIOP_WEB_URL=http://localhost:3100 npm start
 */
const WEB_URL = process.env.AIOP_WEB_URL ?? "https://accountant-ai-operator.vercel.app";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * עדכון שקט לגמרי: בודק ומוריד ברקע מ-GitHub Releases (ה-repo ציבורי, אין
 * צורך בטוקן) בלי שום הודעה למשתמש, ומתקין אוטומטית רק כשהאפליקציה נסגרת
 * בפעם הבאה (autoInstallOnAppQuit) - לא quitAndInstall מיידי, כדי לא לקטוע
 * משימה שרצה כרגע.
 */
function startAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

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

let taskRunning = false;
let stopRequested = false;
let pendingApproval: { resolve: (approved: boolean) => void } | null = null;

function resolvePendingApproval(approved: boolean): void {
  pendingApproval?.resolve(approved);
  pendingApproval = null;
}

app.whenReady().then(() => {
  ipcMain.handle("aiop:get-connector-paths", () => readConnectorPaths());

  ipcMain.handle("aiop:get-xai-key-status", () => hasXaiApiKey());

  ipcMain.handle("aiop:save-xai-key", (_event, key: string) => setXaiApiKey(key));

  ipcMain.handle("aiop:clear-xai-key", () => clearXaiApiKey());

  ipcMain.handle(
    "aiop:run-task",
    async (event, task: string, connectorId: string, resumeRunId?: string) => {
      if (taskRunning) return { started: false, error: "task-already-running" as const };

      const apiKey = getXaiApiKey();
      if (!apiKey) return { started: false, error: "no-api-key" as const };

      const resumeRun = resumeRunId ? getRun(resumeRunId) : null;

      const sender = event.sender;
      taskRunning = true;
      stopRequested = false;

      void runComputerUseTask({
        apiKey,
        task,
        connectorId,
        knownScreens: getLearnedScreens(connectorId).map((s) => s.label),
        resumeFrom: resumeRun ? { startedAt: resumeRun.startedAt, steps: resumeRun.steps } : undefined,
        shouldStop: () => stopRequested,
        onUpdate: (update: TaskUpdateEvent) => {
          if (update.type === "action") recordScreen(connectorId, update.screenLabel, update.reasoning);
          if (update.type === "run-summary") saveRun(update.run);
          if (!sender.isDestroyed()) sender.send("aiop:task-update", update);
        },
        waitForApproval: () => new Promise<boolean>((resolve) => (pendingApproval = { resolve })),
      }).finally(() => {
        taskRunning = false;
      });

      return { started: true };
    },
  );

  ipcMain.handle("aiop:get-learned-screens", (_event, connectorId: string) => getLearnedScreens(connectorId));

  ipcMain.handle("aiop:get-incomplete-run", (_event, connectorId: string) => findIncompleteRun(connectorId));

  ipcMain.handle("aiop:approve-action", () => {
    if (!pendingApproval) return false;
    resolvePendingApproval(true);
    return true;
  });

  ipcMain.handle("aiop:reject-action", () => {
    if (!pendingApproval) return false;
    resolvePendingApproval(false);
    return true;
  });

  ipcMain.handle("aiop:list-runs", () => listRuns());

  ipcMain.handle("aiop:stop-task", () => {
    if (pendingApproval) resolvePendingApproval(false);
    stopRequested = true;
    return true;
  });

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
  startAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

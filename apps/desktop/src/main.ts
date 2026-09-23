import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import fs from "node:fs";
import {
  getXaiApiKey,
  hasXaiApiKey,
  setXaiApiKey,
  clearXaiApiKey,
  hasConnectorCredentials,
  setConnectorCredentials,
  clearConnectorCredentials,
} from "./settings";
import { runComputerUseTask, type TaskUpdateEvent } from "./task-runner";
import type { ComputerActionRequest } from "./ai/grok";
import { saveRun, listRuns, getRun, findIncompleteRun } from "./run-history";
import { getLearnedScreens, recordScreen } from "./screen-memory";
import { isRetryableLoadFailure, nextReloadDelay } from "./window-reload";

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

function saveConnectorTarget(connectorId: string, target: string): void {
  const current = readConnectorPaths();
  current[connectorId] = target;
  writeConnectorPaths(current);
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

  // טעינה ראשונית יכולה להיכשל בזמן שהמחשב עוד מתחבר לרשת (למשל מיד אחרי
  // הפעלה/יקיצה) - זה מציג ברירת מחדל את דף השגיאה הגנרי של Chromium
  // ("This page couldn't load") שדורש לחיצת Reload ידנית. במקום זה, מנסים
  // שוב אוטומטית עם השהיה גדלה (ר' window-reload.ts), עד שהטעינה מצליחה.
  let reloadAttempt = 0;
  win.webContents.on("did-finish-load", () => {
    reloadAttempt = 0;
  });
  win.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isRetryableLoadFailure(errorCode, isMainFrame) || win.isDestroyed()) return;
    const delay = nextReloadDelay(reloadAttempt);
    reloadAttempt += 1;
    setTimeout(() => {
      // loadURL() דוחה (reject) בדיוק כשdid-fail-load יורה - זה לא מידע חדש
      // (כבר מטופל למעלה ע"י תזמון הניסיון החוזר עצמו), אבל בלי .catch() כאן
      // ה-rejection הבלתי-מטופל מפיל את **כל תהליך ה-main** של Electron מיד
      // (התנהגות ברירת המחדל של Node מ-v15+) - כלומר בדיוק התרחיש שהניסיון
      // החוזר הזה נועד לטפל בו (רשת לא מוכנה מיד אחרי הפעלה) היה בעצם מקריס
      // את האפליקציה במקום לתקן אותה, עוד לפני שהטיימר של הניסיון הבא נורה.
      if (!win.isDestroyed()) win.loadURL(WEB_URL).catch(() => {});
    }, delay);
  });

  // אותה סיבה בדיוק חלה גם על הטעינה הראשונית - כשל רשת מיידי (למשל מחשב
  // שהתעורר הרגע) יקריס את התהליך כאן, לפני שה-listener למעלה בכלל יספיק
  // לתפוס את did-fail-load ולתזמן ניסיון חוזר.
  win.loadURL(WEB_URL).catch(() => {});
  return win;
}

let taskRunning = false;
let stopRequested = false;
let currentConnectorId: string | null = null;
let currentTask: string | null = null;
let pendingApproval: {
  step: number;
  reasoning: string;
  confidence: number;
  action: ComputerActionRequest;
  resolve: (approved: boolean) => void;
} | null = null;
let pendingQuestion: { step: number; question: string; resolve: (answer: string) => void } | null = null;

function resolvePendingApproval(approved: boolean): void {
  pendingApproval?.resolve(approved);
  pendingApproval = null;
}

function resolvePendingQuestion(answer: string): void {
  pendingQuestion?.resolve(answer);
  pendingQuestion = null;
}

interface AgentStatus {
  running: boolean;
  connectorId: string | null;
  task: string | null;
  pendingApproval: { step: number; reasoning: string; confidence: number; action: ComputerActionRequest } | null;
  pendingQuestion: { step: number; question: string } | null;
}

/**
 * מאפשר לחלון (renderer) לסנכרן מחדש את המצב שלו כשהוא נטען/נטען-מחדש -
 * למשל אחרי ניווט למסך אחר וחזרה - בזמן שמשימה עדיין רצה ברקע בתהליך הראשי.
 */
function getAgentStatus(): AgentStatus {
  return {
    running: taskRunning,
    connectorId: currentConnectorId,
    task: currentTask,
    pendingApproval: pendingApproval
      ? {
          step: pendingApproval.step,
          reasoning: pendingApproval.reasoning,
          confidence: pendingApproval.confidence,
          action: pendingApproval.action,
        }
      : null,
    pendingQuestion: pendingQuestion ? { step: pendingQuestion.step, question: pendingQuestion.question } : null,
  };
}

app.whenReady().then(() => {
  ipcMain.handle("aiop:get-app-version", () => app.getVersion());

  ipcMain.handle("aiop:get-connector-paths", () => readConnectorPaths());

  ipcMain.handle("aiop:get-xai-key-status", () => hasXaiApiKey());

  ipcMain.handle("aiop:save-xai-key", (_event, key: string) => setXaiApiKey(key));

  ipcMain.handle("aiop:clear-xai-key", () => clearXaiApiKey());

  ipcMain.handle("aiop:get-connector-credentials-status", (_event, connectorId: string) =>
    hasConnectorCredentials(connectorId),
  );

  ipcMain.handle(
    "aiop:save-connector-credentials",
    (_event, connectorId: string, username: string, password: string) =>
      setConnectorCredentials(connectorId, username, password),
  );

  ipcMain.handle("aiop:clear-connector-credentials", (_event, connectorId: string) =>
    clearConnectorCredentials(connectorId),
  );

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
      currentConnectorId = connectorId;
      currentTask = task;

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
        waitForApproval: (step, reasoning, confidence, action) =>
          new Promise<boolean>((resolve) => {
            pendingApproval = { step, reasoning, confidence, action, resolve };
          }),
        waitForAnswer: (step, question) =>
          new Promise<string>((resolve) => {
            pendingQuestion = { step, question, resolve };
          }),
      })
        .catch((err: unknown) => {
          // בלי catch כאן, כל שגיאה לא-צפויה בתוך הלולאה (כולל כשל כתיבה
          // לדיסק מתוך onUpdate - למשל דיסק מלא, נעילת קובץ זמנית) מפילה את
          // **כל תהליך ה-main** של Electron באמצע משימה, בשקט וללא הסבר -
          // בדיוק ההפך מהעיקרון "תמיד תסביר מה נכשל ולמה". עכשיו זה מדווח
          // כשגיאה רגילה במקום להקריס את האפליקציה.
          const message = `internal-error: ${err instanceof Error ? err.message : String(err)}`;
          if (!sender.isDestroyed()) {
            sender.send("aiop:task-update", { type: "error", step: 0, message });
          }
        })
        .finally(() => {
          taskRunning = false;
          currentConnectorId = null;
          currentTask = null;
        });

      return { started: true };
    },
  );

  ipcMain.handle("aiop:get-agent-status", () => getAgentStatus());

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

  ipcMain.handle("aiop:answer-question", (_event, answer: string) => {
    if (!pendingQuestion) return false;
    resolvePendingQuestion(answer);
    return true;
  });

  ipcMain.handle("aiop:list-runs", () => listRuns());

  ipcMain.handle("aiop:stop-task", () => {
    if (pendingApproval) resolvePendingApproval(false);
    if (pendingQuestion) resolvePendingQuestion("");
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

    saveConnectorTarget(connectorId, result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle("aiop:resolve-dropped-path", (_event, connectorId: string, droppedPath: string) => {
    // קיצורי דרך על שולחן העבודה (.lnk) לא מצביעים בעצמם על קובץ הפעלה - צריך
    // לפתור אותם ליעד האמיתי. שם הקיצור יכול להיות שונה לגמרי מהשם המסחרי של
    // התוכנה, אבל היעד עצמו תמיד מדויק - בדיוק למה גרירה פותרת את הבעיה הזו.
    let target = droppedPath;
    if (process.platform === "win32" && droppedPath.toLowerCase().endsWith(".lnk")) {
      try {
        target = shell.readShortcutLink(droppedPath).target;
      } catch {
        return { success: false, error: "invalid-shortcut" as const };
      }
    }
    if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return { success: false, error: "target-not-found" as const };
    }
    saveConnectorTarget(connectorId, target);
    return { success: true, path: target };
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

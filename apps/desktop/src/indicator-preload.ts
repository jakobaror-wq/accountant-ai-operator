import { contextBridge, ipcRenderer } from "electron";

/**
 * preload נפרד וזעיר לחלון-החיווי (ר' main.ts, showAgentIndicator) - לא
 * חושף שום דבר מלבד עצירת המשימה הנוכחית, בכוונה: זה לא חלון-אפליקציה
 * מלא, רק התראה קטנה שתמיד-עליון.
 */
contextBridge.exposeInMainWorld("indicatorAPI", {
  stop: (): Promise<boolean> => ipcRenderer.invoke("aiop:stop-task"),
});

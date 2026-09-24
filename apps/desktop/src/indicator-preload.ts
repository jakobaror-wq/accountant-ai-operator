import { contextBridge, ipcRenderer } from "electron";

/**
 * preload נפרד וזעיר לחלון-החיווי (ר' main.ts, showAgentIndicator) - חושף
 * רק עצירת המשימה הנוכחית וקבלת עדכוני-סטטוס חיים (חד-כיווני, main -> חלון
 * זה בלבד). זה לא חלון-אפליקציה מלא, רק התראה קטנה שתמיד-עליון.
 *
 * onStatus נוסף (2026-09-24) - לפני זה החלון הראה טקסט קבוע לאורך כל
 * הריצה ("הסוכן פעיל") בלי שום אינדיקציה על התקדמות בפועל. זה בדיוק מה
 * שגרם לדיווח משתמש "התוכנה נפתחה אבל לא קורה כלום" להיות בלתי-ניתן-
 * לאבחון מבחוץ - אין שום דרך להבחין בין "הסוכן חושב/ממתין לתשובת AI" לבין
 * "הסוכן תקוע". עכשיו main.ts שולח כאן טקסט על כל שלב.
 */
contextBridge.exposeInMainWorld("indicatorAPI", {
  stop: (): Promise<boolean> => ipcRenderer.invoke("aiop:stop-task"),
  onStatus: (callback: (text: string) => void): void => {
    ipcRenderer.on("aiop:indicator-status", (_event, text: string) => callback(text));
  },
});

import { screen } from "electron";
import { captureLiveFrame } from "./computer-use";

/**
 * קצב התצוגה החיה (~2.5fps) - עצמאי לגמרי מקצב לולאת-ההחלטות של ה-AI
 * (task-runner.ts, שתלוי בזמן-תגובת-AI, עד 45 שניות לקריאה). זו בדיוק
 * הבעיה שהתצוגה הזו פותרת: המשתמש ביקש "וידאו חי", לא "מצגת שקפים" שמתעדכנת
 * רק פעם בכמה שניות-עד-עשרות-שניות. **דגל-אימות**: עלות CPU אמיתית של
 * desktopCapturer בקצב הזה על Windows אמיתי לא נמדדה מהסביבה הזו (Linux+
 * Xvfb) - אם כבד מדי בפועל, להאט (600-800ms); אם לא "חי" מספיק, להדק (250ms).
 */
const LIVE_FRAME_INTERVAL_MS = 400;

/**
 * קצב מהיר יותר ועצמאי מצילום-המסך: קריאת מיקום-עכבר היא פעולה סינכרונית
 * זולה (אין קידוד תמונה), אז אפשר/כדאי לדגום אותה בתדירות גבוהה יותר כדי
 * שנקודת-המצביע בתצוגה תזוז חלק, גם כשהפריים הרקעי מתעדכן לאט יותר.
 */
const CURSOR_POLL_INTERVAL_MS = 150;

export interface CursorPosition {
  x: number;
  y: number;
}

type FrameSender = Pick<Electron.WebContents, "send" | "isDestroyed">;

let frameInterval: ReturnType<typeof setInterval> | null = null;
let cursorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * מתחיל את שני האינטרוולים העצמאיים (פריים + מיקום-עכבר). אידמפוטנטי -
 * קריאה חוזרת עוצרת קודם אינטרוול קודם אם קיים, כדי שלעולם לא ירוצו שני
 * זוגות אינטרוולים בו-זמנית (למשל אם aiop:run-task נקרא שוב לפני שהריצה
 * הקודמת ניקתה את עצמה - לא אמור לקרות בזכות הנעילה הגלובלית, אבל זה חינם
 * להגן נגד זה גם כאן).
 */
export function startLiveFeed(sender: FrameSender): void {
  stopLiveFeed();

  frameInterval = setInterval(() => {
    if (sender.isDestroyed()) return;
    captureLiveFrame()
      .then((frame) => {
        if (!sender.isDestroyed()) sender.send("aiop:live-frame", frame);
      })
      .catch(() => {
        // כשל-צילום בודד בתצוגה-חיה הוא לא קריטי (בניגוד לכשל ב-captureScreenshot
        // של לולאת ה-AI) - פשוט מדלגים על הפריים הזה, הבא בתור ינסה שוב.
      });
  }, LIVE_FRAME_INTERVAL_MS);

  cursorInterval = setInterval(() => {
    if (sender.isDestroyed()) return;
    const point: CursorPosition = screen.getCursorScreenPoint();
    sender.send("aiop:cursor-position", point);
  }, CURSOR_POLL_INTERVAL_MS);
}

export function stopLiveFeed(): void {
  if (frameInterval) {
    clearInterval(frameInterval);
    frameInterval = null;
  }
  if (cursorInterval) {
    clearInterval(cursorInterval);
    cursorInterval = null;
  }
}

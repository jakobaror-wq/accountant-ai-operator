import { shell } from "electron";
import { getWindows, getActiveWindow, type Window } from "@nut-tree-fork/nut-js";

/**
 * בעבר, aiop:run-task פשוט התחיל לצלם את המסך הראשי בלי שום ניסיון להביא
 * לקדמת הבמה את התוכנה הרלוונטית ל-connectorId - אם המשתמש עבד ידנית
 * בתוכנה אחרת (או שהתוכנה הנכונה לא הייתה פתוחה בכלל), הסוכן פשוט "ראה" את
 * מה שכבר היה על המסך ונתקע, בלי שגיאה ברורה. הפונקציה הזו סוגרת את הפער:
 * מוצא/פותח/מביא לקדמה בוודאות את החלון הנכון **לפני** שהלולאה של ה-AI
 * מתחילה בכלל, ומחזירה כשל ברור אם זה לא הצליח - במקום להמשיך "עיוור".
 *
 * מבוסס על window API של nut-js (getWindows/getActiveWindow/Window.focus) -
 * כבר תלות קיימת בפרויקט (מותקנת עבור mouse/keyboard), לא נוספה תלות חדשה.
 */

export interface FocusResult {
  success: boolean;
  /** קוד שגיאה יציב לצורך טיפול ב-UI. */
  error?: string;
  /** תיאור טקסטואלי מפורט יותר, לצורך אבחון - לא בהכרח מוצג בשלמותו למשתמש. */
  detail?: string;
}

/**
 * מחרוזות-רמז לזיהוי חלון לפי כותרת, לכל תוכנה. **ניחוש שמרני, לא מאומת
 * בפועל** - כותרות החלון האמיתיות של התוכנות האלה לא ידועות מהסביבה הזו.
 * אם ההתאמה נכשלת בבדיקה חיה, זה המקום היחיד שצריך לעדכן (הוסיפו את
 * הכותרת האמיתית שמופיעה בפועל בשורת הכותרת של החלון).
 */
const WINDOW_TITLE_HINTS: Record<string, string[]> = {
  hashavshevet: ["חשבשבת", "Hashavshevet"],
  hisulit: ["חיסולית", "Hisulit"],
  shikulit: ["שיקלולית", "שיקולית", "Shikulit"],
  konto: ["קונטו", "Konto"],
  dokka: ["Dokka", "דוקה", "דוקא"],
};

/** שם ידידותי להצגה (למשל בחיווי "הסוכן פעיל") - בלי לשכפל את רשימת ה-
 * connectors המלאה מ-apps/web/lib/connectors.ts (חבילה נפרדת). */
export function getConnectorDisplayName(connectorId: string): string {
  return WINDOW_TITLE_HINTS[connectorId]?.[0] ?? connectorId;
}

const LAUNCH_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 500;
const FOCUS_VERIFY_DELAY_MS = 200;

function titleMatchesHints(title: string, hints: string[]): boolean {
  const lower = title.toLowerCase();
  return hints.some((hint) => lower.includes(hint.toLowerCase()));
}

async function findMatchingWindow(hints: string[]): Promise<Window | null> {
  const windows = await getWindows();
  for (const win of windows) {
    try {
      const title = await win.getTitle();
      if (title && titleMatchesHints(title, hints)) return win;
    } catch {
      // חלון שנעלם/נסגר בין קבלת הרשימה לקריאת הכותרת - מדלגים, לא נכשלים.
    }
  }
  return null;
}

/**
 * focus() של nut-js לא תמיד מצליח בפועל (תלוי במנהל-החלונות של מערכת
 * ההפעלה) - במקום לסמוך על ערך ההחזרה שלו בלבד, בודקים בפועל דרך
 * getActiveWindow() אחרי השהיה קצרה שהחלון הנכון באמת הפך לפעיל.
 */
async function focusAndVerify(win: Window, hints: string[]): Promise<boolean> {
  try {
    await win.focus();
  } catch {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, FOCUS_VERIFY_DELAY_MS));
  try {
    const active = await getActiveWindow();
    const title = await active.getTitle();
    return titleMatchesHints(title, hints);
  } catch {
    return false;
  }
}

export async function focusConnectorWindow(connectorId: string, exePath: string | undefined): Promise<FocusResult> {
  const hints = WINDOW_TITLE_HINTS[connectorId];
  if (!hints || hints.length === 0) {
    return { success: false, error: "no-title-hint-configured", detail: `אין הגדרת זיהוי-חלון לתוכנה "${connectorId}"` };
  }

  let win = await findMatchingWindow(hints);

  if (!win) {
    if (!exePath) {
      return {
        success: false,
        error: "not-open-and-no-path-configured",
        detail: "התוכנה לא פתוחה כרגע, ואין נתיב הפעלה שמור עבורה - הגדירו אותו במסך אינטגרציות.",
      };
    }

    const openError = await shell.openPath(exePath);
    if (openError) {
      return { success: false, error: "launch-failed", detail: `פתיחת התוכנה נכשלה: ${openError}` };
    }

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline && !win) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      win = await findMatchingWindow(hints);
    }

    if (!win) {
      return {
        success: false,
        error: "window-not-found-after-launch",
        detail: "התוכנה הופעלה אך לא זוהה חלון שלה בזמן שהוקצב - ייתכן שהיא עדיין נטענת, או שהגדרת זיהוי-החלון לא מדויקת.",
      };
    }
  }

  const focused = await focusAndVerify(win, hints);
  if (!focused) {
    return {
      success: false,
      error: "focus-failed",
      detail: "נמצא חלון מתאים, אך לא הצלחתי להביא אותו לקדמת הבמה בפועל.",
    };
  }

  return { success: true };
}

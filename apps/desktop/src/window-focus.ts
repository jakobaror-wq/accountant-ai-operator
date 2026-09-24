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
 *
 * **עדכון (2026-09-24) - באג קידוד אמיתי שהתגלה בבדיקה חיה:** אצל המשתמש,
 * `Window.getTitle()` של nut-js מחזיר טקסט משובש (תווי החלפה "�") עבור
 * חלונות עם כותרת בעברית - כנראה קריאה ל-API לא-Unicode ברמת הספרייה
 * הנטיבית של nut-js ב-Windows. חלונות עם כותרת אנגלית-בלבד (חלונות מערכת
 * כמו "Quick Settings") הוצגו תקין - זה מה שחשף שהבעיה ספציפית לטקסט
 * שאינו ASCII, לא תקלה כללית. המשמעות: **שום מחרוזת עברית ב-
 * WINDOW_TITLE_HINTS לא תוכל אף פעם להתאים** לטקסט שכבר משובש בזמן ריצה,
 * לא משנה כמה מדויק הרמז - זו לא בעיה שניתן לתקן על ידי "ניחוש טוב יותר".
 * לכן ההתאמה **לא מסתמכת על קריאת כותרת בכלל** כשצריך להפעיל את התוכנה
 * בעצמנו - במקום זאת מזהים "איזה חלון חדש הופיע" לפי מיקום/גודל
 * (Region), שהוא מספרי ולא תלוי-קידוד. התאמה לפי כותרת עדיין מנוסה קודם
 * כניסיון ראשון זול (עובד מצוין לתוכנות עם כותרת לא-עברית), אבל היא
 * best-effort בלבד, לא תלות יחידה.
 */

export interface FocusResult {
  success: boolean;
  /** קוד שגיאה יציב לצורך טיפול ב-UI. */
  error?: string;
  /** תיאור טקסטואלי מפורט יותר, לצורך אבחון - לא בהכרח מוצג בשלמותו למשתמש. */
  detail?: string;
}

/**
 * מחרוזות-רמז לזיהוי חלון לפי כותרת, לכל תוכנה - **ניסיון ראשון זול
 * בלבד**, לא תלות יחידה (ר' הבהרה למעלה על באג הקידוד). שימושי בעיקר
 * לזיהוי חלון **שכבר פתוח** לפני שמחליטים להפעיל את התוכנה מחדש.
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

interface WindowRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

function regionSignature(region: WindowRegion): string {
  return `${region.left},${region.top},${region.width},${region.height}`;
}

function titleMatchesHints(title: string, hints: string[]): boolean {
  const lower = title.toLowerCase();
  return hints.some((hint) => lower.includes(hint.toLowerCase()));
}

/** התאמה לפי כותרת בלבד, בין חלונות **שכבר פתוחים כרגע** - ר' הבהרה
 * למעלה: זו רק ניחוש ראשון זול, לא נכשלים "קשה" אם זה לא מצליח. */
async function findMatchingWindowByTitle(hints: string[]): Promise<Window | null> {
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
 * כשההתאמה נכשלת, מציגים בהודעת השגיאה את כל כותרות החלונות הפתוחים
 * בפועל שכן ניתנות לקריאה - שימושי לתוכנות שהתקלה בהן היא רמז שגוי, לא
 * באג-קידוד (ר' הבהרה בראש הקובץ).
 */
async function listAllWindowTitles(): Promise<string[]> {
  const windows = await getWindows();
  const titles: string[] = [];
  for (const win of windows) {
    try {
      const title = await win.getTitle();
      if (title) titles.push(title);
    } catch {
      // חלון שנעלם באמצע - מדלגים.
    }
  }
  return titles;
}

async function snapshotWindowRegions(): Promise<Set<string>> {
  const windows = await getWindows();
  const signatures = new Set<string>();
  for (const win of windows) {
    try {
      signatures.add(regionSignature(await win.getRegion()));
    } catch {
      // חלון שנעלם באמצע - מדלגים.
    }
  }
  return signatures;
}

/**
 * מוצא חלון "חדש" שהופיע מאז תצלום-מצב קודם - **לא תלוי בקריאת כותרת
 * בכלל**, בדיוק כדי לעקוף את באג הקידוד (ר' הבהרה בראש הקובץ). בין כמה
 * מועמדים חדשים, מעדיפים אחד שכן ניתן להתאים לפי כותרת (אם זה בכל זאת
 * ניתן לקריאה תקינה), ואחרת בוחרים את הגדול ביותר - סביר יותר שזה חלון-
 * אפליקציה אמיתי מאשר חלון-התראה/פופאפ קטן שנפתח באותו רגע במקרה.
 */
async function findNewWindowSince(before: Set<string>, hints: string[]): Promise<Window | null> {
  const windows = await getWindows();
  const candidates: { win: Window; matchesHint: boolean; area: number }[] = [];

  for (const win of windows) {
    try {
      const region = await win.getRegion();
      if (before.has(regionSignature(region))) continue; // היה קיים כבר קודם - לא חדש
      let matchesHint = false;
      try {
        const title = await win.getTitle();
        matchesHint = Boolean(title) && titleMatchesHints(title, hints);
      } catch {
        // כותרת לא ניתנת לקריאה - לא פוסל את המועמד, רק לא נותן לו בונוס-עדיפות.
      }
      candidates.push({ win, matchesHint, area: region.width * region.height });
    } catch {
      // חלון שנעלם באמצע - מדלגים.
    }
  }

  if (candidates.length === 0) return null;
  const hinted = candidates.find((c) => c.matchesHint);
  if (hinted) return hinted.win;
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0].win;
}

/**
 * focus() של nut-js לא תמיד מצליח בפועל (תלוי במנהל-החלונות של מערכת
 * ההפעלה) - במקום לסמוך על ערך ההחזרה שלו בלבד, בודקים בפועל דרך
 * getActiveWindow() אחרי השהיה קצרה. האימות הוא לפי **מיקום/גודל**, לא
 * לפי כותרת (ר' באג הקידוד בראש הקובץ) - כך זה עובד גם לחלונות עם כותרת
 * עברית משובשת.
 */
async function focusAndVerify(win: Window): Promise<{ ok: boolean; activeTitle?: string }> {
  let targetSignature: string;
  try {
    targetSignature = regionSignature(await win.getRegion());
  } catch {
    return { ok: false };
  }

  try {
    await win.focus();
  } catch {
    return { ok: false };
  }

  await new Promise((resolve) => setTimeout(resolve, FOCUS_VERIFY_DELAY_MS));
  try {
    const active = await getActiveWindow();
    const activeSignature = regionSignature(await active.getRegion());
    let activeTitle: string | undefined;
    try {
      activeTitle = await active.getTitle();
    } catch {
      // לא קריטי - זה רק מידע נוסף לאבחון אם האימות נכשל.
    }
    return { ok: activeSignature === targetSignature, activeTitle };
  } catch {
    return { ok: false };
  }
}

export async function focusConnectorWindow(connectorId: string, exePath: string | undefined): Promise<FocusResult> {
  const hints = WINDOW_TITLE_HINTS[connectorId];
  if (!hints || hints.length === 0) {
    return { success: false, error: "no-title-hint-configured", detail: `אין הגדרת זיהוי-חלון לתוכנה "${connectorId}"` };
  }

  // ניסיון ראשון זול: אולי התוכנה כבר פתוחה וניתן לזהות אותה לפי כותרת.
  let win = await findMatchingWindowByTitle(hints);

  if (!win) {
    if (!exePath) {
      return {
        success: false,
        error: "not-open-and-no-path-configured",
        detail: "התוכנה לא פתוחה כרגע, ואין נתיב הפעלה שמור עבורה - הגדירו אותו במסך אינטגרציות.",
      };
    }

    // תצלום-מצב **לפני** ההפעלה - הבסיס לזיהוי "מה חדש" בלי תלות בכותרת.
    const beforeLaunch = await snapshotWindowRegions();

    const openError = await shell.openPath(exePath);
    if (openError) {
      return { success: false, error: "launch-failed", detail: `פתיחת התוכנה נכשלה: ${openError}` };
    }

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline && !win) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      win = await findNewWindowSince(beforeLaunch, hints);
    }

    if (!win) {
      const openTitles = await listAllWindowTitles();
      const titlesText =
        openTitles.length > 0
          ? openTitles
              .slice(0, 15)
              .map((t) => `"${t}"`)
              .join(", ")
          : "לא זוהה אף חלון פתוח כלל - ייתכן שזו לא בעיית-התאמת-שם אלא בעיה רחבה יותר בזיהוי חלונות במערכת הזו";
      return {
        success: false,
        error: "window-not-found-after-launch",
        detail: `התוכנה הופעלה אך לא זוהה שום חלון חדש בזמן שהוקצב (גם לא לפי מיקום/גודל, לא רק לפי כותרת). חלונות פתוחים שזוהו בפועל: ${titlesText}. ייתכן שהתוכנה עדיין נטענת (נדרש timeout ארוך יותר), או שיש בעיה כללית יותר בזיהוי חלונות על המחשב הזה.`,
      };
    }
  }

  const focusResult = await focusAndVerify(win);
  if (!focusResult.ok) {
    const activeInfo = focusResult.activeTitle ? ` החלון הפעיל בפועל אחרי הניסיון (אם ניתן לקריאה): "${focusResult.activeTitle}".` : "";
    return {
      success: false,
      error: "focus-failed",
      detail: `נמצא חלון מתאים, אך לא הצלחתי לוודא שהוא הפך לפעיל בפועל.${activeInfo}`,
    };
  }

  return { success: true };
}

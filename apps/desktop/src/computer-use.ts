import { desktopCapturer, nativeImage, screen } from "electron";
import { mouse, keyboard, Point, Button, Key } from "@nut-tree-fork/nut-js";

/**
 * nut-js מוסיף עיכוב קבוע לפני כל פעולת קלט מדומה - ברירת המחדל שלו היא
 * 100ms לפני כל קליק/גלילה, ו-300ms לפני **כל תו** שמוקלד וכל לחיצת/שחרור
 * מקש. זה לא "אנימציה" - mouse.setPosition() כבר מיידי ללא עיכוב - זה
 * עיכוב מלאכותי בנפרד, שמצטבר בכבדות במיוחד בהקלדת טקסט (מספר/סכום בן 6
 * ספרות = לפחות 1.8 שניות עיכוב, לפני שנכתב אפילו תו אחד בפועל).
 * הוקטן במידה (לא אופס) - עדיין יש עיכוב אמיתי, למקרה שתוכנה ישנה/איטית
 * לא קולטת אירועי קלט מהירים מדי. בניגוד לשיפורי היעילות הקודמים בסבב הזה
 * (שכולם היו רה-פקטור פנימי טהור בלי סיכון להתנהגות), זה שינוי שבאמת
 * משפיע על מה שנקלד בפועל בתוכנה החיצונית - כדאי לבדוק בפועל מול התוכנות
 * האמיתיות שהזנת טקסט/מקשים עדיין אמינה במלואה לפני לסמוך על זה.
 */
mouse.config.autoDelayMs = 20;
keyboard.config.autoDelayMs = 30;

export interface ScreenshotResult {
  /** התמונה היחידה שמקודדת בפועל - ברזולוציה המקורית, או מוקטנת אם המסך
   * גדול משמעותית (ר' MAX_VISION_DIMENSION). משמשת גם לתצוגה למשתמש
   * (UI, לא נשמר ביומן הביקורת) וגם לקריאה ל-AI - אותה תמונה בדיוק. */
  base64Png: string;
  width: number;
  height: number;
  /** הרזולוציה הפיזית האמיתית של המסך - לא בהכרח שווה ל-width/height למעלה
   * (אם צולמה גרסה מוקטנת). משמשת רק לקנפוס קואורדינטות קליק חזרה למסך
   * האמיתי (ר' task-runner.ts, scaleActionToRealScreen). */
  realWidth: number;
  realHeight: number;
}

/**
 * מגבלת רזולוציה לצילום שנשלח ל-AI: מסכים רגילים (עד ~1600px בצלע הארוכה,
 * כמו FHD) לא מוקטנים בכלל - אין שינוי סיכון. רק מסכים גדולים משמעותית
 * (1440p/4K) מוקטנים, כדי לחסוך רוחב פס וזמן תגובה בלי לפגוע בקריאות -
 * יש שם עודף רזולוציה ממילא. לא הצלחנו לאמת מול תיעוד רשמי של xAI מספר
 * מדויק לגודל האופטימלי (התיעוד לא נגיש מהסביבה הזו, ומקורות משניים
 * סותרים) - הבחירה כאן שמרנית ומבוססת על עקרון כללי שתקף בכל ספקי ה-vision.
 */
const MAX_VISION_DIMENSION = 1600;

export async function captureScreenshot(): Promise<ScreenshotResult> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  if (sources.length === 0) throw new Error("no-screen-source");
  // desktopCapturer.getSources() לא מבטיח שה-source הראשון הוא המסך הראשי -
  // בהגדרת שני מסכים (נפוץ אצל רואי חשבון) זה עלול לצלם מסך אחד בזמן
  // שהקואורדינטות מחושבות לפי הרזולוציה של מסך אחר לגמרי, מה שיזיז כל קליק
  // למקום שגוי. מתאימים לפי display_id של המסך הראשי בפועל; אם הפלטפורמה לא
  // ממלאת display_id באופן אמין - נופלים חזרה לראשון, כמו קודם.
  const source =
    sources.find((s) => s.display_id === String(primaryDisplay.id)) ?? sources[0];

  const fullImage = source.thumbnail;
  const longestSide = Math.max(width, height);
  const scale = longestSide > MAX_VISION_DIMENSION ? MAX_VISION_DIMENSION / longestSide : 1;
  // מקודדים תמונה אחת בלבד (לא שתיים) - אם המסך בגודל רגיל, זו התמונה
  // המקורית ממש; רק על מסכים גדולים משמעותית יש בכלל resize. אין יותר
  // קידוד PNG כפול (מקור + מוקטן) בכל צעד - רק זו שבאמת בשימוש.
  const image = scale < 1 ? fullImage.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }) : fullImage;
  const size = image.getSize();

  return {
    base64Png: image.toPNG().toString("base64"),
    width: size.width,
    height: size.height,
    realWidth: width,
    realHeight: height,
  };
}

/**
 * תמונה זעירה (64x48) שנגזרת מצילום מסך קיים - לא צילום נפרד - לשימוש
 * ב-macros.ts: השוואת-דמיון בין המסך החי לבין מה שנצפה בהקלטת מאקרו קודמת.
 * קטנה בכוונה - הרזולוציה המלאה לא נדרשת בשביל "האם זה בערך אותו מסך",
 * ושומרת את macros.json קטן (referenceThumbnail אחד לכל צעד מאקרו).
 */
export function deriveComparisonThumbnail(base64Png: string): string {
  const small = nativeImage.createFromBuffer(Buffer.from(base64Png, "base64")).resize({ width: 64, height: 48 });
  return small.toPNG().toString("base64");
}

/**
 * הפרש ממוצע-מוחלט לפי בית, מנורמל ל-0..1 (0=זהה, 1=הפוך לגמרי). שתי
 * תמונות בגדלים שונים (למשל שידור-חוזר על מסך שממש שונה) נחשבות שונות
 * לגמרי (1) בלי לנסות להשוות פיקסל-לפיקסל בין מבנים לא תואמים.
 */
export function bitmapDiffScore(aBase64Png: string, bBase64Png: string): number {
  const a = nativeImage.createFromBuffer(Buffer.from(aBase64Png, "base64")).toBitmap();
  const b = nativeImage.createFromBuffer(Buffer.from(bBase64Png, "base64")).toBitmap();
  if (a.length === 0 || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number };

const KEY_MAP: Record<string, Key> = {
  enter: Key.Enter,
  tab: Key.Tab,
  escape: Key.Escape,
  backspace: Key.Backspace,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  space: Key.Space,
};

export async function executeAction(action: ComputerAction): Promise<void> {
  switch (action.type) {
    case "click":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.click(action.button === "right" ? Button.RIGHT : Button.LEFT);
      return;

    case "double_click":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.doubleClick(Button.LEFT);
      return;

    case "type":
      await keyboard.type(action.text);
      return;

    case "key": {
      const key = KEY_MAP[action.key.toLowerCase()];
      if (!key) throw new Error(`unknown-key:${action.key}`);
      await keyboard.pressKey(key);
      await keyboard.releaseKey(key);
      return;
    }

    case "scroll":
      if (action.amount > 0) await mouse.scrollDown(action.amount);
      else await mouse.scrollUp(-action.amount);
      return;

    case "wait":
      await new Promise((resolve) => setTimeout(resolve, action.ms));
      return;
  }
}

/**
 * לוגיקה טהורה (בלי Next.js/Electron) שהועברה מ-apps/desktop/src/ai/grok.ts
 * ב-2026-10-07 - ר' ההערה הראשית ב-route.ts לסיפור המלא. מופרדת מ-route.ts
 * לקובץ נפרד כדי שאפשר יהיה לבדוק אותה ישירות (`node --experimental-strip-types`,
 * ר' apps/web/scripts/verify/verify-prompt-building.mjs) בלי לדרוש שרת Next.js
 * רץ או Electron - route.ts files מוגבלים ל-exports ספציפיים (GET/POST/וכו'),
 * אז לא ניתן לייצא מהן ישירות פונקציות-עזר לבדיקה.
 */

export type RiskClass = "read-only" | "navigation" | "reversible-edit" | "external-side-effect" | "final-commit" | "unknown";

const ALL_RISK_CLASSES: readonly RiskClass[] = [
  "read-only",
  "navigation",
  "reversible-edit",
  "external-side-effect",
  "final-commit",
  "unknown",
];

export function isValidRiskClass(value: unknown): value is RiskClass {
  return typeof value === "string" && (ALL_RISK_CLASSES as readonly string[]).includes(value);
}

export type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "type_credential"; field: "username" | "password" }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "ask"; question: string }
  | { type: "done"; summary: string };

export interface HistoryEntry {
  reasoning: string;
  action: ComputerActionRequest;
}

export interface GrokStepResult {
  reasoning: string;
  screenLabel: string;
  confidence: number;
  riskClass: RiskClass;
  action: ComputerActionRequest;
}

/** שם המודל - Grok עם תמיכת Vision. אם xAI משנים שם/גרסת מודל, זה המקום
 * היחיד לעדכן. */
export const DEFAULT_GROK_MODEL = "grok-4.6";

export const SYSTEM_PROMPT = `אתה פועל כרואה חשבון/מנהל חשבונות מומחה שמפעיל תוכנת מחשב עבור משתמש, בהתבסס על צילומי מסך - לא כמובן-מאליו-קליקר. תפעל במקצועיות, בזהירות, ובשיפוט חשבונאי - כמו שרואה חשבון אמיתי היה נוהג מול הנתונים והתוכנה של לקוח.
בכל שלב תקבל: תיאור משימה, גודל המסך בפיקסלים (0,0 בפינה השמאלית-עליונה), היסטוריית פעולות קודמות (כולל שאלות ותשובות קודמות), רשימת מסכים מוכרים בתוכנה הזו (אם יש, מריצות קודמות), וצילום מסך נוכחי.
עליך להחזיר תמיד JSON יחיד בפורמט הבא, ללא טקסט נוסף:
{"reasoning": "הסבר קצר של מה שאתה רואה ולמה בחרת בפעולה", "screenLabel": "שם קצר וקבוע למסך הנוכחי (2-4 מילים)", "confidence": <0 עד 1>, "riskClass": "read-only"|"navigation"|"reversible-edit"|"external-side-effect"|"final-commit"|"unknown", "action": {...}}

**screenLabel:** תן שם עקבי וקצר לסוג המסך שאתה רואה עכשיו (למשל "מסך פתיחה", "טופס לקוח", "מאזן בוחן") - לא תיאור חופשי, אלא שם קבוע שיחזור על עצמו בכל פעם שתראה מסך מאותו הסוג, גם בהרצות עתידיות. אם המסך תואם אחד ה"מסכים המוכרים" שקיבלת - השתמש באותו שם בדיוק, אל תמציא שם חדש.

ה-action חייב להיות אחד מהבאים בדיוק:
{"type":"click","x":<number>,"y":<number>,"button":"left"|"right"}
{"type":"double_click","x":<number>,"y":<number>}
{"type":"type","text":"<string>"}
{"type":"type_credential","field":"username"|"password"}  // הזנת שם משתמש/סיסמה שמורים - ר' הסבר ייעודי למטה, לעולם לא עם "type"
{"type":"key","key":"enter"|"tab"|"escape"|"backspace"|"delete"|"up"|"down"|"left"|"right"|"space"}
{"type":"scroll","amount":<number>}  // חיובי = למטה, שלילי = למעלה
{"type":"wait","ms":<number>}
{"type":"ask","question":"<string>"}  // שאלה ממוקדת למשתמש - ר' כלל הביטחון למטה
{"type":"done","summary":"<string>"}  // רק כשהמשימה הושלמה במלואה, או כשאי אפשר להמשיך - ר' סוף ההוראות

**type_credential - כניסה לתוכנה:** אם אתה נתקל במסך התחברות (שדות שם משתמש/סיסמה) של התוכנה, **לעולם אל תמציא או תנחש ערכים ואל תשתמש ב-"type" עבור שדות כאלה**. השתמש ב-"type_credential" עם ה-field המתאים - הערך האמיתי נשלף באופן מקומי ובטוח בזמן הביצוע, ואתה לא רואה ולא צריך לדעת אותו. תראה בפרומפט אם יש פרטי התחברות שמורים לתוכנה הנוכחית. אם אין - אל תנסה "type_credential", השתמש ב-"ask" כדי להסביר למשתמש שצריך לשמור פרטי התחברות במסך ה-AI Agent קודם.

**confidence - כלל מחייב:** דרג בין 0 ל-1 עד כמה אתה בטוח שזיהית נכון את המסך ושהפעולה שבחרת היא הנכונה. אם הביטחון שלך נמוך מ-0.95 - **אל תנחש ואל תפעל**. השתמש ב-action מסוג "ask" ושאל שאלה ממוקדת וברורה שתעזור לך להמשיך בבטחה (למשל: "אני רואה שני לקוחות בשם דומה - X בע\"מ ו-X אחזקות - לאיזה מהם מתכוון?"). רואה חשבון מקצועי לא מנחש נתונים - הוא שואל. עדיף לשאול יותר מדי מאשר לטעות בנתון פיננסי.

**riskClass - כלל מחייב, לפי סוג הפעולה. שים לב: אתה מסווג מה הפעולה היא, לא קובע אם היא "מותרת" - ההחלטה הסופית אם צריך אישור אנושי נעשית בקוד, לא על ידך, ולכן חשוב שהסיווג יהיה מדויק ולא "נוח":**
- **"read-only"**: שאיבת/קריאת מידע בלבד - חיפוש, סינון, בחירת שורה לצפייה, קריאת ערך קיים מהמסך.
- **"navigation"**: מעבר בין מסכים/לשוניות/תפריטים, פתיחת דוח/מסך לצפייה, גלילה.
- **"reversible-edit"**: הזנת נתונים לשדה בטופס, בחירת ערך מרשימה, מילוי טופס חדש - **כל עוד השינוי עדיין לא נשמר/אושר בתוכנה** (ניתן לבטל ע"י סגירה בלי שמירה).
- **"external-side-effect"**: יצירת קובץ חדש על הדיסק - ייצוא לדוח/PDF/Excel, הדפסה לקובץ. זו פעולה עם השפעה אמיתית מחוץ לתוכנה עצמה, גם אם היא "רק קריאה" מבחינת הנתונים.
- **"final-commit"**: כל פעולה שמשנה **לצמיתות** מידע בתוך התוכנה עצמה - שמירה, מחיקה, אישור/פרסום מסמך, רישום פקודת יומן, תשלום, לחיצה על "כן"/"אישור"/"מחק" בדיאלוג ששומר שינוי.
- **"unknown"**: אם אתה לא בטוח לאיזו מהקטגוריות למעלה הפעולה שייכת. אל תנחש ואל "תעגל כלפי מטה" לקטגוריה פחות-מסוכנת כדי להימנע מעצירה - עדיף לסווג "unknown" ולתת לקוד להחליט.
- "ask", "done" ו-"type_credential" תמיד "read-only" - התחברות לתוכנה לא משנה נתון פיננסי בתוכה, היא רק פותחת גישה.

פעולות read-only/navigation/reversible-edit מתבצעות מיד, כדי לא להטריד אותך בכל צעד ניווט/קריאה. external-side-effect/final-commit/unknown תמיד עוצרות לאישור אנושי מפורש לפני הביצוע - זו החלטת-קוד קבועה, לא תלויה בך.

תמיד תעדיף לבדוק את התוצאה של הפעולה הקודמת לפני שתמשיך - אם משהו לא כמצופה, אל תמשיך "עיוור", תסביר את זה ב-reasoning ותנסה גישה אחרת.
אם המשימה נכשלת, נתקעת, או שאי אפשר להשלים אותה (למשל אחרי כמה ניסיונות, או תשובה מהמשתמש ששוללת המשך) - החזר "done" עם summary **שמסביר בפירוט במה נכשלת ולמה** (מה ניסית, מה קרה, מה חסם אותך). לעולם אל תמציא הצלחה שלא הייתה.`;

/** מגבלה על כמה צעדי היסטוריה נשלחים במלואם בכל קריאה ל-AI - ר' ההערה
 * המקורית ב-grok.ts (לפני המעבר לכאן) למה. */
export const MAX_HISTORY_ENTRIES_IN_PROMPT = 20;

export function buildUserPrompt(params: {
  task: string;
  screenWidth: number;
  screenHeight: number;
  history: HistoryEntry[];
  knownScreens: string[];
  hasSavedCredentials: boolean;
}): string {
  const recentHistory = params.history.slice(-MAX_HISTORY_ENTRIES_IN_PROMPT);
  const truncatedCount = params.history.length - recentHistory.length;
  const historyText =
    recentHistory.length === 0
      ? "(זו הפעולה הראשונה)"
      : (truncatedCount > 0
          ? `(${truncatedCount} צעדים קודמים נוספים בוצעו ולא מוצגים כאן במלואם - הפירוט המלא שמור ביומן הביקורת)\n`
          : "") +
        recentHistory.map((h, i) => `${truncatedCount + i + 1}. ${h.reasoning} -> ${JSON.stringify(h.action)}`).join("\n");

  const knownScreensText =
    params.knownScreens.length === 0 ? "(אין עדיין מסכים מוכרים בתוכנה הזו)" : params.knownScreens.join(", ");

  const credentialsText = params.hasSavedCredentials
    ? "יש פרטי התחברות שמורים לתוכנה הזו - מותר להשתמש ב-type_credential במסך התחברות."
    : "אין פרטי התחברות שמורים לתוכנה הזו - אם תיתקל במסך התחברות, אל תשתמש ב-type_credential, שאל את המשתמש.";

  return `משימה: ${params.task}\nגודל מסך: ${params.screenWidth}x${params.screenHeight}\n\nמסכים מוכרים בתוכנה הזו: ${knownScreensText}\n\n${credentialsText}\n\nהיסטוריית פעולות:\n${historyText}\n\nמה הפעולה הבאה?`;
}

export function extractJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no-json-in-response");
    return JSON.parse(match[0]);
  }
}

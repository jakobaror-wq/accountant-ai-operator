import { net } from "electron";

const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * מודל ברירת המחדל - Grok עם תמיכת Vision. אם xAI משנים שם/גרסת מודל, זה
 * המקום היחיד לעדכן (ר' apps/desktop/README.md).
 */
export const DEFAULT_GROK_MODEL = "grok-4.6";

/** סף הביטחון - מתחתיו הסוכן חייב לשאול במקום לנחש (ר' SYSTEM_PROMPT). */
export const CONFIDENCE_THRESHOLD = 0.95;

/**
 * **עדכון (2026-09-24) - באג אמיתי שהתגלה בבדיקה חיה:** עד עכשיו לקריאת
 * net.fetch כאן לא היה שום timeout - אם הבקשה נתקעת (פרוקסי תקוע, handshake
 * TLS שלא מסתיים, DNS איטי) הלולאה בtask-runner.ts פשוט ממתינה **לצמיתות**,
 * בלי שום שגיאה ובלי שום סימן חזותי לבעיה. זה בדיוק תואם דיווח משתמש: התוכנה
 * הנכונה נפתחת, חלון-החיווי מראה "הסוכן פעיל", ואז שום דבר לא קורה - לא
 * קליק, לא הודעת שגיאה, כלום. עכשיו יש AbortController עם timeout מפורש -
 * אם התגובה לא מגיעה בזמן, זה נכשל בבירור (ולפי isRetryableAiError
 * ב-task-runner.ts, זה עדיין ינסה שוב עד MAX_AI_RETRIES לפני שיוצג למשתמש).
 */
const AI_REQUEST_TIMEOUT_MS = 45000;

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

export interface GrokStepResult {
  reasoning: string;
  screenLabel: string;
  confidence: number;
  requiresApproval: boolean;
  action: ComputerActionRequest;
}

export interface HistoryEntry {
  reasoning: string;
  action: ComputerActionRequest;
}

const SYSTEM_PROMPT = `אתה פועל כרואה חשבון/מנהל חשבונות מומחה שמפעיל תוכנת מחשב עבור משתמש, בהתבסס על צילומי מסך - לא כמובן-מאליו-קליקר. תפעל במקצועיות, בזהירות, ובשיפוט חשבונאי - כמו שרואה חשבון אמיתי היה נוהג מול הנתונים והתוכנה של לקוח.
בכל שלב תקבל: תיאור משימה, גודל המסך בפיקסלים (0,0 בפינה השמאלית-עליונה), היסטוריית פעולות קודמות (כולל שאלות ותשובות קודמות), רשימת מסכים מוכרים בתוכנה הזו (אם יש, מריצות קודמות), וצילום מסך נוכחי.
עליך להחזיר תמיד JSON יחיד בפורמט הבא, ללא טקסט נוסף:
{"reasoning": "הסבר קצר של מה שאתה רואה ולמה בחרת בפעולה", "screenLabel": "שם קצר וקבוע למסך הנוכחי (2-4 מילים)", "confidence": <0 עד 1>, "requiresApproval": true|false, "action": {...}}

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

**requiresApproval - כלל מחייב, לפי סוג הפעולה:**
- **false (חופשי, בלי אישור)**: שאיבת/קריאת מידע - ניווט, פתיחת מסכים/דוחות לצפייה, חיפוש, סינון, גלילה, בחירת שורה לצפייה בלבד. **וגם** יצירת/ייצוא קבצים - ייצוא לדוח/PDF/Excel, הדפסה לקובץ - כל עוד זה לא משנה נתון קיים בתוכנה עצמה.
- **true (חובה אישור אנושי לפני ביצוע)**: כל פעולה שמשנה מידע בתוך התוכנה עצמה - שמירה, עריכת שדה ואישורה, מחיקה, הוספת/עריכת רשומה, רישום פקודת יומן, אישור/פרסום מסמך, תשלום, לחיצה על "כן"/"אישור"/"מחק" בדיאלוג ששומר שינוי.
- אם לא ברור לאיזו קטגוריה הפעולה שייכת - שים true (ברירת המחדל הבטוחה).
- "ask", "done" ו-"type_credential" הם תמיד false - התחברות לתוכנה לא משנה נתון פיננסי בתוכה, היא רק פותחת גישה.

כשה-requiresApproval הוא true, הפעולה תוצג למשתמש לאישור מפורש ולא תבוצע לפני שהוא מאשר; פעולות עם false מתבצעות מיד, כדי לא להטריד את המשתמש בכל צעד ניווט/קריאה.

תמיד תעדיף לבדוק את התוצאה של הפעולה הקודמת לפני שתמשיך - אם משהו לא כמצופה, אל תמשיך "עיוור", תסביר את זה ב-reasoning ותנסה גישה אחרת.
אם המשימה נכשלת, נתקעת, או שאי אפשר להשלים אותה (למשל אחרי כמה ניסיונות, או תשובה מהמשתמש ששוללת המשך) - החזר "done" עם summary **שמסביר בפירוט במה נכשלת ולמה** (מה ניסית, מה קרה, מה חסם אותך). לעולם אל תמציא הצלחה שלא הייתה.`;

/**
 * מגבלה על כמה צעדי היסטוריה נשלחים במלואם בכל קריאה ל-AI. בלי זה, במשימה
 * ארוכה (מתקרבת ל-MAX_STEPS) כל השלבים הקודמים נשלחים מחדש בכל צעד - גדילה
 * ליניארית שמייקרת ומאטה כל קריאה. השלבים הראשונים עדיין נשמרים במלואם
 * ביומן הביקורת (run-history) - זו רק חיתוך של מה שנשלח ל-AI עצמו, לא של
 * מה שנשמר למשתמש.
 */
const MAX_HISTORY_ENTRIES_IN_PROMPT = 20;

function buildUserPrompt(params: {
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

function extractJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no-json-in-response");
    return JSON.parse(match[0]);
  }
}

export async function requestNextAction(params: {
  apiKey: string;
  task: string;
  screenshotBase64: string;
  screenWidth: number;
  screenHeight: number;
  history: HistoryEntry[];
  knownScreens: string[];
  hasSavedCredentials: boolean;
  model?: string;
}): Promise<GrokStepResult> {
  // net.fetch (לא ה-fetch הגלובלי של Node) - רץ על מנוע הרשת של Chromium,
  // בדיוק כמו חלון הדפדפן של האפליקציה - אז הוא יורש אוטומטית הגדרות proxy
  // ברמת המערכת/רשת, בניגוד ל-fetch של Node שמתעלם מהן. זה מה שהסביר מקרה
  // שבו שאר האפליקציה (שנטענת מ-Vercel דרך אותו חלון) עובדת אבל קריאות ה-AI
  // נכשלות עם "fetch failed" - היו יוצאות ישירות בלי לעבור דרך פרוקסי נדרש.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), AI_REQUEST_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof net.fetch>>;
  try {
    response = await net.fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model ?? DEFAULT_GROK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: buildUserPrompt(params) },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${params.screenshotBase64}` },
              },
            ],
          },
        ],
      }),
      signal: timeoutController.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`xai-timeout: לא התקבלה תגובה מ-xAI תוך ${AI_REQUEST_TIMEOUT_MS / 1000} שניות`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`xai-error:${response.status}:${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("xai-empty-response");

  const parsed = extractJson(content) as GrokStepResult;
  if (!parsed?.action?.type) throw new Error("xai-malformed-response");

  // ברירת מחדל בטוחה: תשובה בלי confidence תקין נחשבת ביטחון 0 - כדי שהחוסר
  // בהירות של המודל עצמו יסומן בבירור למשתמש (ר' agent page), לא ייעלם בשקט.
  const confidence =
    typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0;
  const screenLabel =
    typeof parsed.screenLabel === "string" && parsed.screenLabel.trim() ? parsed.screenLabel.trim() : "לא מזוהה";
  // ברירת מחדל בטוחה נוספת: "ask"/"done"/"type_credential" לעולם לא דורשים
  // אישור (אלה לא פעולות שמשנות נתון בתוכנה); לכל פעולה אחרת, אם המודל לא
  // ציין requiresApproval תקין - מניחים שכן נדרש אישור (עדיף לעצור לחינם
  // מאשר לשנות נתון בלי אישור אדם).
  const requiresApproval =
    parsed.action.type === "ask" || parsed.action.type === "done" || parsed.action.type === "type_credential"
      ? false
      : typeof parsed.requiresApproval === "boolean"
        ? parsed.requiresApproval
        : true;

  return { ...parsed, confidence, screenLabel, requiresApproval };
}

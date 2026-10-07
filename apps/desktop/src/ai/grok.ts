import { isValidRiskClass, type RiskClass } from "../safety/policy-engine";
import { WEB_URL } from "../settings";

/**
 * **שינוי-שורש (2026-10-07) - ראיה חיה מהמשתמש:** דיווח `xai-timeout` חדש
 * הראה ששני נתיבי-רשת עצמאיים לגמרי (Chromium net.fetch וגם Node fetch
 * הגלובלי - קוד שונה, תהליכים שונים) נתקעים **באופן זהה** למשך 45 השניות
 * המלאות, בעוד שה-DNS ל-api.x.ai הצליח מיידית (1ms). זו לא עוד תקלת-קוד
 * אחת שהתיקון הקודם (נתיב-גיבוי Node, auth-server-whitelist) לא כיסה - זו
 * ראיה לחסימת-רשת **ברמת התשתית** (פיירוול/EDR ארגוני, נפוץ במיוחד במשרדי
 * רואי-חשבון) שחוסמת גישה יוצאת ל-api.x.ai באופן שקט, בלי קשר לאיזו
 * מחסנית-HTTP משתמשים בה - אף תיקון בתוך האפליקציה לא יכול לעקוף חסימה
 * ברמה הזו. הפתרון: להפסיק לנסות להגיע ל-xAI **מרשת המשתמש** בכלל, ובמקום
 * זה לקרוא לשרת שלנו (WEB_URL, שכבר מוכח נגיש - זה אותו אתר שנטען בהצלחה
 * בחלון הראשי) - השרת (Vercel) מבצע את הקריאה בפועל ל-xAI מתשתית שלו, לא
 * מהרשת הארגונית החסומה. כל מנגנון-הגיבוי-הכפול שהיה כאן (callXaiOnce פעמיים,
 * diagnoseDns) הוסר - הוא נבנה כדי לעקוף בעיית-רשת-מקומית בהגעה ישירה ל-xAI,
 * וכבר לא רלוונטי כש-xAI לא נקרא ישירות מהמחשב של המשתמש בכלל.
 */
const NEXT_ACTION_URL = `${WEB_URL}/api/agent/next-action`;

/** סף הביטחון - מתחתיו הסוכן חייב לשאול במקום לנחש. נאכף בפרומפט בצד
 * השרת (ר' apps/web/app/api/agent/next-action/route.ts) - מוגדר גם כאן
 * כי קוד בצד ה-client (למשל agent/page.tsx) צריך את הערך לתצוגה. */
export const CONFIDENCE_THRESHOLD = 0.95;

/**
 * זמן-המתנה לקריאה **לשרת שלנו** (לא ישירות ל-xAI יותר, ר' ההערה למעלה).
 * מעט ארוך יותר מה-timeout הפנימי של ה-route עצמו (ר' AI_REQUEST_TIMEOUT_MS
 * ב-route.ts) - כדי שהשרת תמיד יספיק להחזיר הודעת-שגיאה נקייה משלו (כולל
 * מה שבאמת קרה מול xAI) לפני שהלקוח מוותר ומציג שגיאת-רשת גנרית פחות
 * אינפורמטיבית.
 */
const NEXT_ACTION_TIMEOUT_MS = 50000;

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
  /** **עדכון (2026-10-05, Gate 1):** המודל לא קובע יותר "צריך אישור?"
   * ישירות - הוא מסווג לאיזו קטגוריה הפעולה שייכת, והקוד (policy-engine.ts)
   * קובע באופן דטרמיניסטי אם זה דורש אישור. ר' הערה ב-safety/policy-engine.ts. */
  riskClass: RiskClass;
  action: ComputerActionRequest;
}

export interface HistoryEntry {
  reasoning: string;
  action: ComputerActionRequest;
}

/**
 * בניית-הפרומפט (SYSTEM_PROMPT/buildUserPrompt), הקריאה האמיתית ל-xAI, ושם
 * המודל (היה DEFAULT_GROK_MODEL כאן) עברו כולם ל-
 * apps/web/app/api/agent/next-action/route.ts - ר' ההערה למעלה. זה המקום
 * היחיד היום לעדכן את שם/גרסת המודל או את נוסח ההנחיה למודל.
 */
async function callNextActionEndpoint(body: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NEXT_ACTION_TIMEOUT_MS);
  try {
    return await fetch(NEXT_ACTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
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
  const body = JSON.stringify(params);

  let response: Response;
  const start = Date.now();
  try {
    response = await callNextActionEndpoint(body);
  } catch (err) {
    const elapsed = Date.now() - start;
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `timeout אחרי ${elapsed}ms`
        : err instanceof Error
          ? `${err.message} (${elapsed}ms)`
          : `${String(err)} (${elapsed}ms)`;
    // "next-action-unreachable" (לא "xai-timeout") - הבחנה מכוונת: זו כעת
    // שגיאת-רשת בהגעה **לשרת שלנו** (WEB_URL), לא ל-xAI - אם זו נכשלת,
    // כנראה שום דבר לא יעבוד (גם טעינת האתר עצמה הייתה נכשלת), לא ספציפי
    // ל-xAI בכלל.
    throw new Error(`next-action-unreachable: ${NEXT_ACTION_URL} - ${detail}`);
  }

  if (!response.ok) {
    // ה-route (route.ts) מבחין בתשובת-שגיאה מובנית בין כשל שמקורו ב-xAI עצמו
    // (status/detail אמיתיים של xAI - נשמר בפורמט "xai-error:STATUS:" הקיים,
    // כדי ש-isRetryableAiError ב-task-runner.ts ימשיך להחליט נכון על 429/5xx)
    // לבין כשל אחר (השרת שלנו לא הצליח להגיע בכלל ל-xAI, או בקשה פגומה) -
    // שלא אמור להיחשב "שגיאת xAI עם status מספרי אמיתי".
    let text = "";
    let errorBody: { error?: string; status?: number; detail?: string } | null = null;
    try {
      text = await response.text();
      errorBody = JSON.parse(text);
    } catch {
      // תשובה לא-JSON (למשל 502/504 גולמי מ-Vercel עצמו, לא מה-route שלנו) -
      // text כבר מכיל את מה שהתקבל, נשתמש בו כמו שהוא.
    }
    if (errorBody?.error === "xai-error" && typeof errorBody.status === "number") {
      throw new Error(`xai-error:${errorBody.status}:${(errorBody.detail ?? "").slice(0, 500)}`);
    }
    const errorTag = errorBody?.error ?? `http-${response.status}`;
    throw new Error(`next-action-error:${errorTag}:${(errorBody?.detail ?? text).slice(0, 500)}`);
  }

  const parsed = (await response.json()) as GrokStepResult;
  if (!parsed?.action?.type) throw new Error("xai-malformed-response");

  // ברירת-מחדל בטוחה גם כאן, לא רק בשרת - הגנה-כפולה: תשובה שעברה ברשת
  // (ולא רק "מה שהמודל החזיר") עלולה תיאורטית להיפגם/להיחתך, ואין סיבה
  // לסמוך על שכבה אחת בלבד (ר' עקרון דומה בכל הבדיקות fail-closed בפרויקט
  // הזה - policy-engine.ts, macros.ts).
  const confidence =
    typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0;
  const screenLabel =
    typeof parsed.screenLabel === "string" && parsed.screenLabel.trim() ? parsed.screenLabel.trim() : "לא מזוהה";
  const riskClass: RiskClass =
    parsed.action.type === "ask" || parsed.action.type === "done" || parsed.action.type === "type_credential"
      ? "read-only"
      : isValidRiskClass(parsed.riskClass)
        ? parsed.riskClass
        : "unknown";

  return { ...parsed, confidence, screenLabel, riskClass };
}

import { NextResponse } from "next/server";
import {
  DEFAULT_GROK_MODEL,
  SYSTEM_PROMPT,
  buildUserPrompt,
  extractJson,
  isValidRiskClass,
  type GrokStepResult,
  type HistoryEntry,
  type RiskClass,
} from "./prompt";

/**
 * **שינוי-שורש (2026-10-07) - ראיה חיה מהמשתמש:** עד עכשיו, apps/desktop
 * קרא ל-api.x.ai **ישירות מהמחשב של המשתמש**. דיווח חדש הראה ששני נתיבי-
 * רשת עצמאיים לגמרי (Chromium net.fetch וגם Node fetch הגלובלי) נתקעו
 * **באופן זהה** למשך 45 השניות המלאות, בעוד שה-DNS הצליח מיידית - ראיה
 * לחסימת-רשת ברמת התשתית (פיירוול/EDR ארגוני, נפוץ במשרדי רואי-חשבון),
 * לא תקלת-קוד שניתן לעקוף מתוך האפליקציה. הפתרון: נקודת-הקצה הזו מריצה
 * את הקריאה בפועל ל-xAI **מתשתית Vercel**, לא מרשת המשתמש - apps/desktop
 * (ר' apps/desktop/src/ai/grok.ts) קורא לכתובת הזו במקום ל-api.x.ai ישירות.
 *
 * מפתח ה-API של המשתמש (xAI) מגיע בגוף הבקשה בכל קריאה - **לא נשמר כאן
 * בשום מקום, לא נכתב ללוג** - רק מועבר הלאה ל-xAI ונשכח ברגע שהתגובה חוזרת.
 * זה אותו מודל "המשתמש מביא מפתח משלו" כמו קודם - רק שינוי **מאיפה** הקריאה
 * יוצאת פיזית, לא מי מחזיק/משלם על המפתח.
 *
 * כל לוגיקת בניית-הפרומפט (SYSTEM_PROMPT/buildUserPrompt), חילוץ-ה-JSON
 * מתוך תשובת המודל, ושם המודל (DEFAULT_GROK_MODEL לשעבר) - כולם הועברו
 * לכאן במלואם מ-apps/desktop/src/ai/grok.ts, ויושבים ב-`./prompt.ts` (לא
 * כאן) - route.ts files מוגבלים ל-exports ספציפיים (GET/POST/וכו'), אז
 * לוגיקה-טהורה שרוצים לבדוק ישירות (ר' apps/web/scripts/verify/) צריכה
 * קובץ נפרד. **אין חבילת-שיתוף משותפת בין apps/desktop ל-apps/web כרגע** -
 * זה שכפול מכוון ופרגמטי מול grok.ts, לא רה-ארגון מונוריפו-שלם שלא קשור
 * לבעיה הדחופה. אם משנים את נוסח-ההנחיה/המודל - `./prompt.ts` הוא המקום
 * היחיד לעדכן מעכשיו (grok.ts כבר לא מכיל את זה בכלל).
 */
const XAI_URL = "https://api.x.ai/v1/chat/completions";

/**
 * timeout פנימי לקריאה בפועל ל-xAI - קצר מ-`maxDuration` למטה, כדי שתמיד
 * נספיק להחזיר תשובת-שגיאה נקייה משלנו (עם הפירוט האמיתי) לפני ש-Vercel
 * עצמו היה הורג את הפונקציה בלי שום הסבר.
 */
const AI_REQUEST_TIMEOUT_MS = 40000;

/**
 * **דגל-אימות**: הערך בפועל שה-plan של Vercel מאפשר לא נבדק מהסביבה הזו -
 * אם הפונקציה עדיין נחתכת מוקדם מדי בפועל (לפני 40 שניות), צריך לבדוק/
 * לשדרג את תוכנית ה-Vercel של הפרויקט.
 */
export const maxDuration = 60;

interface NextActionRequestBody {
  apiKey: string;
  task: string;
  screenshotBase64: string;
  screenWidth: number;
  screenHeight: number;
  history: HistoryEntry[];
  knownScreens: string[];
  hasSavedCredentials: boolean;
  model?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<NextActionRequestBody>;
  try {
    body = (await request.json()) as Partial<NextActionRequestBody>;
  } catch {
    return NextResponse.json({ error: "invalid-request", detail: "גוף הבקשה אינו JSON תקין" }, { status: 400 });
  }

  if (!body.apiKey || !body.task || !body.screenshotBase64 || !body.screenWidth || !body.screenHeight) {
    return NextResponse.json({ error: "invalid-request", detail: "חסרים שדות חובה בבקשה" }, { status: 400 });
  }

  const xaiBody = JSON.stringify({
    model: body.model ?? DEFAULT_GROK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildUserPrompt({
              task: body.task,
              screenWidth: body.screenWidth,
              screenHeight: body.screenHeight,
              history: body.history ?? [],
              knownScreens: body.knownScreens ?? [],
              hasSavedCredentials: Boolean(body.hasSavedCredentials),
            }),
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${body.screenshotBase64}` } },
        ],
      },
    ],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let xaiResponse: Response;
  const start = Date.now();
  try {
    xaiResponse = await fetch(XAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}` },
      body: xaiBody,
      signal: controller.signal,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `xAI לא ענה תוך ${elapsed}ms (timeout מצד השרת שלנו)`
        : err instanceof Error
          ? `${err.message} (${elapsed}ms)`
          : `${String(err)} (${elapsed}ms)`;
    // זו כעת שגיאת-רשת מ-**תשתית Vercel** ל-xAI - אם זו נכשלת, סביר שזו
    // תקלה אצל xAI עצמו או ב-Vercel, לא ברשת-המשתמש (שכבר לא חלק מהנתיב).
    return NextResponse.json({ error: "xai-unreachable", detail }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!xaiResponse.ok) {
    const detail = await xaiResponse.text();
    return NextResponse.json({ error: "xai-error", status: xaiResponse.status, detail: detail.slice(0, 500) }, { status: 502 });
  }

  let content: string | undefined;
  try {
    const data = (await xaiResponse.json()) as { choices?: { message?: { content?: string } }[] };
    content = data.choices?.[0]?.message?.content;
  } catch {
    return NextResponse.json({ error: "xai-empty-response", detail: "תשובת xAI אינה JSON תקין" }, { status: 502 });
  }
  if (!content) {
    return NextResponse.json({ error: "xai-empty-response", detail: "תשובת xAI לא כללה תוכן" }, { status: 502 });
  }

  let parsed: Partial<GrokStepResult>;
  try {
    parsed = extractJson(content) as Partial<GrokStepResult>;
  } catch {
    return NextResponse.json({ error: "xai-malformed-response", detail: content.slice(0, 500) }, { status: 502 });
  }
  if (!parsed?.action?.type) {
    return NextResponse.json({ error: "xai-malformed-response", detail: content.slice(0, 500) }, { status: 502 });
  }

  // ברירות-מחדל בטוחות - אותה לוגיקה שהייתה ב-grok.ts (נשמרת גם שם כהגנה
  // כפולה על הלקוח, לא כי אי אפשר לסמוך על השרת - שתי השכבות בודקות את
  // אותו הדבר, בכוונה).
  const confidence =
    typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1 ? parsed.confidence : 0;
  const screenLabel =
    typeof parsed.screenLabel === "string" && parsed.screenLabel.trim() ? parsed.screenLabel.trim() : "לא מזוהה";
  const riskClass: RiskClass =
    parsed.action.type === "ask" || parsed.action.type === "done" || parsed.action.type === "type_credential"
      ? "read-only"
      : isValidRiskClass(parsed.riskClass)
        ? parsed.riskClass
        : "unknown";

  const result: GrokStepResult = {
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    screenLabel,
    confidence,
    riskClass,
    action: parsed.action,
  };
  return NextResponse.json(result);
}

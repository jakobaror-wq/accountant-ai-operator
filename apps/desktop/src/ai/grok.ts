import { net } from "electron";
import dns from "node:dns";
import { isValidRiskClass, type RiskClass } from "../safety/policy-engine";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_HOSTNAME = "api.x.ai";

/**
 * **עדכון (2026-10-05) - טלמטריית-רשת, לפי המלצת מחקר חיצוני (Gate 0 §0.5-0.6):**
 * עד עכשיו, "xai-timeout" היה כל המידע שקיבלנו - לא ידוע אם זה נתקע ב-DNS,
 * ב-TCP connect, ב-TLS handshake, או בהמתנה לתשובה בפועל. זה הפך כל דיווח-
 * כשל לניחוש נוסף. הפונקציה הזו מודדת ומדווחת רזולוציית-DNS בנפרד (זמן +
 * איזו משפחת-כתובת נבחרה בפועל - IPv4 מול IPv6, ר' dns.setDefaultResultOrder
 * ב-main.ts) **לפני** כל ניסיון - כדי שהודעת-השגיאה הבאה (אם תהיה) תכיל
 * עובדות אבחוניות אמיתיות, לא רק "נכשל אחרי 45 שניות".
 */
async function diagnoseDns(): Promise<string> {
  const start = Date.now();
  try {
    const result = await dns.promises.lookup(XAI_HOSTNAME, { verbatim: false });
    return `DNS:${result.address}(IPv${result.family}, ${Date.now() - start}ms)`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `DNS-FAILED:${message}(${Date.now() - start}ms)`;
  }
}

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

const SYSTEM_PROMPT = `אתה פועל כרואה חשבון/מנהל חשבונות מומחה שמפעיל תוכנת מחשב עבור משתמש, בהתבסס על צילומי מסך - לא כמובן-מאליו-קליקר. תפעל במקצועיות, בזהירות, ובשיפוט חשבונאי - כמו שרואה חשבון אמיתי היה נוהג מול הנתונים והתוכנה של לקוח.
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

/** הצורה המינימלית המשותפת שאנחנו צריכים מ-Response - גם net.fetch (Electron/Chromium)
 * וגם fetch הגלובלי (Node/undici) מקיימים אותה, למרות שהטיפוסים המלאים שלהם שונים. */
interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<MinimalFetchResponse>;

async function callXaiOnce(fetchImpl: FetchLike, url: string, apiKey: string, body: string): Promise<MinimalFetchResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
  const url = `${XAI_BASE_URL}/chat/completions`;
  const body = JSON.stringify({
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
  });

  // net.fetch (לא ה-fetch הגלובלי של Node) - רץ על מנוע הרשת של Chromium, בדיוק
  // כמו חלון הדפדפן של האפליקציה - אז הוא יורש אוטומטית הגדרות proxy ברמת
  // המערכת/רשת. זה הנתיב הראשי.
  const dnsDiag = await diagnoseDns();

  let response: MinimalFetchResponse;
  const primaryStart = Date.now();
  try {
    response = await callXaiOnce(net.fetch as unknown as FetchLike, url, params.apiKey, body);
  } catch (primaryErr) {
    // **עדכון (2026-09-28) - נתיב-גיבוי, אחרי שתיקון קודם (auth-server-whitelist)
    // לא פתר את ה-xai-timeout אצל המשתמש בפועל:** במקום לנחש שוב איזו הגדרת-
    // רשת ספציפית חוסמת, מנסים נתיב רשת **שונה לגמרי** - fetch הגלובלי של Node
    // (undici) - שרץ על מחסנית TLS/DNS/socket עצמאית לחלוטין מתהליך-הרשת של
    // Chromium שנתקע. תוכנות אבטחה/EDR ארגוניות מטפלות לעיתים אחרת בתהליך-
    // הרשת הנפרד של Chromium (utility process) לעומת קוד שרץ ישירות על תהליך
    // Node הראשי - זה עשוי לעקוף חסימה שלא הצלחנו לאבחן במדויק. אם **שני**
    // הנתיבים נכשלים, הודעת השגיאה כוללת מה בדיוק קרה בכל אחד מהם, פלוס
    // טלמטריית ה-DNS (ר' diagnoseDns למעלה) - ראיה מדויקת יותר לאבחון הבא,
    // בלי לדרוש מהמשתמש להריץ בדיקות ידניות נפרדות.
    const primaryElapsed = Date.now() - primaryStart;
    const primaryDetail =
      primaryErr instanceof Error && primaryErr.name === "AbortError"
        ? `timeout אחרי ${primaryElapsed}ms`
        : primaryErr instanceof Error
          ? `${primaryErr.message} (${primaryElapsed}ms)`
          : `${String(primaryErr)} (${primaryElapsed}ms)`;
    console.warn(`[grok] ${dnsDiag} | נתיב הרשת הראשי (Chromium net.fetch) נכשל (${primaryDetail}) - מנסה נתיב חלופי (Node fetch).`);

    const fallbackStart = Date.now();
    try {
      response = await callXaiOnce(globalThis.fetch as unknown as FetchLike, url, params.apiKey, body);
    } catch (fallbackErr) {
      const fallbackElapsed = Date.now() - fallbackStart;
      const fallbackDetail =
        fallbackErr instanceof Error && fallbackErr.name === "AbortError"
          ? `timeout אחרי ${fallbackElapsed}ms`
          : fallbackErr instanceof Error
            ? `${fallbackErr.message} (${fallbackElapsed}ms)`
            : `${String(fallbackErr)} (${fallbackElapsed}ms)`;
      throw new Error(
        `xai-timeout: שני נתיבי הרשת ל-xAI נכשלו. ${dnsDiag} | הראשי (Chromium): ${primaryDetail}. החלופי (Node): ${fallbackDetail}.`,
      );
    }
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
  // **עדכון (2026-10-05, Gate 1)**: ברירת מחדל בטוחה דומה לרוח הישנה, אבל
  // על riskClass סגור במקום boolean פתוח - "ask"/"done"/"type_credential"
  // תמיד "read-only" (לא פעולות שמשנות נתון בתוכנה); לכל פעולה אחרת, אם
  // המודל לא החזיר ערך תקין מתוך אוצר-המילים הסגור - נופלים ל-"unknown",
  // שה-policy-engine (לא כאן) ממפה תמיד לדרישת-אישור. ה-fail-closed היחיד
  // שבאמת קובע מה מותר בלי אישור הוא בטבלה ב-safety/policy-engine.ts, לא
  // כאן - הקוד הזה רק מוודא שמגיע ערך תקין מתוך אוצר-המילים, לא קובע מדיניות.
  const riskClass: RiskClass =
    parsed.action.type === "ask" || parsed.action.type === "done" || parsed.action.type === "type_credential"
      ? "read-only"
      : isValidRiskClass(parsed.riskClass)
        ? parsed.riskClass
        : "unknown";

  return { ...parsed, confidence, screenLabel, riskClass };
}

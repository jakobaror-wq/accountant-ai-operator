const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * מודל ברירת המחדל - Grok עם תמיכת Vision. אם xAI משנים שם/גרסת מודל, זה
 * המקום היחיד לעדכן (ר' apps/desktop/README.md).
 */
export const DEFAULT_GROK_MODEL = "grok-4.6";

/** סף הביטחון - מתחתיו הסוכן חייב לשאול במקום לנחש (ר' SYSTEM_PROMPT). */
export const CONFIDENCE_THRESHOLD = 0.95;

export type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "ask"; question: string }
  | { type: "done"; summary: string };

export interface GrokStepResult {
  reasoning: string;
  screenLabel: string;
  confidence: number;
  action: ComputerActionRequest;
}

export interface HistoryEntry {
  reasoning: string;
  action: ComputerActionRequest;
}

const SYSTEM_PROMPT = `אתה פועל כרואה חשבון/מנהל חשבונות מומחה שמפעיל תוכנת מחשב עבור משתמש, בהתבסס על צילומי מסך - לא כמובן-מאליו-קליקר. תפעל במקצועיות, בזהירות, ובשיפוט חשבונאי - כמו שרואה חשבון אמיתי היה נוהג מול הנתונים והתוכנה של לקוח.
בכל שלב תקבל: תיאור משימה, גודל המסך בפיקסלים (0,0 בפינה השמאלית-עליונה), היסטוריית פעולות קודמות (כולל שאלות ותשובות קודמות), רשימת מסכים מוכרים בתוכנה הזו (אם יש, מריצות קודמות), וצילום מסך נוכחי.
עליך להחזיר תמיד JSON יחיד בפורמט הבא, ללא טקסט נוסף:
{"reasoning": "הסבר קצר של מה שאתה רואה ולמה בחרת בפעולה", "screenLabel": "שם קצר וקבוע למסך הנוכחי (2-4 מילים)", "confidence": <0 עד 1>, "action": {...}}

**screenLabel:** תן שם עקבי וקצר לסוג המסך שאתה רואה עכשיו (למשל "מסך פתיחה", "טופס לקוח", "מאזן בוחן") - לא תיאור חופשי, אלא שם קבוע שיחזור על עצמו בכל פעם שתראה מסך מאותו הסוג, גם בהרצות עתידיות. אם המסך תואם אחד ה"מסכים המוכרים" שקיבלת - השתמש באותו שם בדיוק, אל תמציא שם חדש.

ה-action חייב להיות אחד מהבאים בדיוק:
{"type":"click","x":<number>,"y":<number>,"button":"left"|"right"}
{"type":"double_click","x":<number>,"y":<number>}
{"type":"type","text":"<string>"}
{"type":"key","key":"enter"|"tab"|"escape"|"backspace"|"delete"|"up"|"down"|"left"|"right"|"space"}
{"type":"scroll","amount":<number>}  // חיובי = למטה, שלילי = למעלה
{"type":"wait","ms":<number>}
{"type":"ask","question":"<string>"}  // שאלה ממוקדת למשתמש - ר' כלל הביטחון למטה
{"type":"done","summary":"<string>"}  // רק כשהמשימה הושלמה במלואה, או כשאי אפשר להמשיך - ר' סוף ההוראות

**confidence - כלל מחייב:** דרג בין 0 ל-1 עד כמה אתה בטוח שזיהית נכון את המסך ושהפעולה שבחרת היא הנכונה. אם הביטחון שלך נמוך מ-0.95 - **אל תנחש ואל תפעל**. השתמש ב-action מסוג "ask" ושאל שאלה ממוקדת וברורה שתעזור לך להמשיך בבטחה (למשל: "אני רואה שני לקוחות בשם דומה - X בע\"מ ו-X אחזקות - לאיזה מהם מתכוון?"). רואה חשבון מקצועי לא מנחש נתונים - הוא שואל. עדיף לשאול יותר מדי מאשר לטעות בנתון פיננסי.

**כל פעולה שאינה "ask" או "done" תוצג למשתמש לאישור לפני שתבוצע בפועל** - זה קורה אוטומטית במערכת, אתה לא צריך להתחשב בזה בבחירת הפעולה עצמה; פשוט הצע את הפעולה הנכונה ביותר לדעתך.

תמיד תעדיף לבדוק את התוצאה של הפעולה הקודמת לפני שתמשיך - אם משהו לא כמצופה, אל תמשיך "עיוור", תסביר את זה ב-reasoning ותנסה גישה אחרת.
אם המשימה נכשלת, נתקעת, או שאי אפשר להשלים אותה (למשל אחרי כמה ניסיונות, או תשובה מהמשתמש ששוללת המשך) - החזר "done" עם summary **שמסביר בפירוט במה נכשלת ולמה** (מה ניסית, מה קרה, מה חסם אותך). לעולם אל תמציא הצלחה שלא הייתה.`;

function buildUserPrompt(params: {
  task: string;
  screenWidth: number;
  screenHeight: number;
  history: HistoryEntry[];
  knownScreens: string[];
}): string {
  const historyText =
    params.history.length === 0
      ? "(זו הפעולה הראשונה)"
      : params.history
          .map((h, i) => `${i + 1}. ${h.reasoning} -> ${JSON.stringify(h.action)}`)
          .join("\n");

  const knownScreensText =
    params.knownScreens.length === 0 ? "(אין עדיין מסכים מוכרים בתוכנה הזו)" : params.knownScreens.join(", ");

  return `משימה: ${params.task}\nגודל מסך: ${params.screenWidth}x${params.screenHeight}\n\nמסכים מוכרים בתוכנה הזו: ${knownScreensText}\n\nהיסטוריית פעולות:\n${historyText}\n\nמה הפעולה הבאה?`;
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
  model?: string;
}): Promise<GrokStepResult> {
  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
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
  });

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

  return { ...parsed, confidence, screenLabel };
}

const XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * מודל ברירת המחדל - Grok עם תמיכת Vision. אם xAI משנים שם/גרסת מודל, זה
 * המקום היחיד לעדכן (ר' apps/desktop/README.md).
 */
export const DEFAULT_GROK_MODEL = "grok-4.6";

export type ComputerActionRequest =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number }
  | { type: "done"; summary: string };

export interface GrokStepResult {
  reasoning: string;
  action: ComputerActionRequest;
}

export interface HistoryEntry {
  reasoning: string;
  action: ComputerActionRequest;
}

const SYSTEM_PROMPT = `אתה סוכן שמפעיל תוכנת מחשב עבור משתמש, בהתבסס על צילומי מסך.
בכל שלב תקבל: תיאור משימה, גודל המסך בפיקסלים (0,0 בפינה השמאלית-עליונה), היסטוריית פעולות קודמות, וצילום מסך נוכחי.
עליך להחזיר תמיד JSON יחיד בפורמט הבא, ללא טקסט נוסף:
{"reasoning": "הסבר קצר של מה שאתה רואה ולמה בחרת בפעולה", "action": {...}}

ה-action חייב להיות אחד מהבאים בדיוק:
{"type":"click","x":<number>,"y":<number>,"button":"left"|"right"}
{"type":"double_click","x":<number>,"y":<number>}
{"type":"type","text":"<string>"}
{"type":"key","key":"enter"|"tab"|"escape"|"backspace"|"delete"|"up"|"down"|"left"|"right"|"space"}
{"type":"scroll","amount":<number>}  // חיובי = למטה, שלילי = למעלה
{"type":"wait","ms":<number>}
{"type":"done","summary":"<string>"}  // רק כשהמשימה הושלמה במלואה

תמיד תעדיף לבדוק את התוצאה של הפעולה הקודמת לפני שתמשיך - אם משהו לא כמצופה, אל תמשיך "עיוור", תסביר את זה ב-reasoning ותנסה גישה אחרת. אם המשימה לא ברורה או תקועה אחרי כמה ניסיונות, עדיין תחזיר "done" עם summary שמסביר מה קרה ולמה לא הושלם - אל תמציא הצלחה.`;

function buildUserPrompt(params: {
  task: string;
  screenWidth: number;
  screenHeight: number;
  history: HistoryEntry[];
}): string {
  const historyText =
    params.history.length === 0
      ? "(זו הפעולה הראשונה)"
      : params.history
          .map((h, i) => `${i + 1}. ${h.reasoning} -> ${JSON.stringify(h.action)}`)
          .join("\n");

  return `משימה: ${params.task}\nגודל מסך: ${params.screenWidth}x${params.screenHeight}\n\nהיסטוריית פעולות:\n${historyText}\n\nמה הפעולה הבאה?`;
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
  return parsed;
}

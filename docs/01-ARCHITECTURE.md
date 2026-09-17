# Architecture - Accountant AI Operator

## 1. עיקרון מפריד: מה רץ בענן מול מה שחייב לרוץ מקומית

זו ההחלטה הארכיטקטונית המרכזית של כל המערכת, ונובעת ישירות מדרישת האבטחה (סעיף "התחברות אוטומטית" במפרט המקור):

| רץ ב-Vercel/Supabase (ענן) | רץ חובה על המחשב המקומי (Windows) |
|---|---|
| ממשק צ'אט, Dashboard, Approval Inbox, Decision Log, Audit Trail (תצוגה) | פתיחת/הפעלת חשבשבת/חיסולית/שיקלולית/קונטו בפועל |
| AI Orchestrator (תכנון, קבלת החלטות, ניסוח Tool Calls) | שליפת Credentials מ-Windows Credential Manager / DPAPI |
| Workflow Engine (State Machine, Checkpoints) - ה-**state** נשמר ב-Supabase | ביצוע ה-Click/Type/UI Automation/Playwright בפועל |
| Approval Engine (חוקי מתי נדרש אישור) | OCR/Vision Fallback על תמונות מסך מקומיות |
| Audit Trail (Storage) | Device Pairing - Handshake מול המשרד |
| Skills Library, Workflow Builder (עריכה/תצוגה) | הקלטת פעולות סמנטיות ב-Training Mode |

**מסקנה קריטית:** ה-AI (שרץ בענן) **לעולם** לא מקבל סיסמה, לא רואה screenshot גולמי עם מידע רגיש ללא סינון, ולא שולח קליק ישירות. הוא שולח **Tool Call מובנה** ("readTrialBalance עבור לקוח X") ל-Local Agent; ה-Local Agent הוא היחיד שנוגע בפועל בתוכנה, במקלדת, בעכבר ובאישורים. הענן מקבל בחזרה רק **תוצאה מובנית** (`ToolResult` - ר' `04-TOOL-REGISTRY.md`), לא זרם וידאו/מקלדת גולמי.

## 2. מבנה ה-Monorepo (מתוכנן - לא נוצר עדיין בקוד בשלב 0)

```
accountant-ai-operator/
├── apps/
│   ├── web/                 # Next.js - Dashboard, צ'אט, Approval Inbox וכו' (Vercel)
│   ├── local-agent/         # .NET - שירות Windows, Computer Use בפועל
│   └── browser-extension/   # Chrome, מוגבל להרשאות מינימליות
├── services/
│   ├── ai-orchestrator/     # תכנון + קבלת החלטות (מריץ מול Claude API)
│   ├── workflow-engine/     # State Machine, Checkpoints, Resume
│   └── approval-engine/     # חוקי אישור, Selective Approval
├── packages/
│   ├── computer-use/        # שכבת הפעלת מחשב (ר' סעיף 4)
│   ├── connectors/          # Connector לכל תוכנה (ר' סעיף 5)
│   ├── skills/              # Skills שנלמדו/הוגדרו
│   ├── accounting-engine/   # כללים דטרמיניסטיים (איזון חובה/זכות, בדיקות סבירות...)
│   ├── audit/                # תיעוד פעולות והחלטות
│   └── shared/               # Types/Zod Schemas/Utilities משותפים
└── supabase/                 # DB, Auth, Storage, RLS - ר' 05-DATA-MODEL.md
```

Web + Services + Supabase נפרסים בענן (Vercel + Supabase). `local-agent` ו-`browser-extension` הם ה**חלקים היחידים** שמותקנים ורצים אצל הלקוח.

## 3. זרימת נתונים (Request Lifecycle)

```
משתמש (צ'אט, apps/web)
   │  "הכן דוח שנתי ללקוח X לשנת 2025"
   ▼
ai-orchestrator  ──(1) מזהה לקוח/שנה, בונה Plan ראשוני
   │
   ▼
workflow-engine  ──(2) יוצר Workflow Run + Checkpoint 0, שומר ל-Supabase
   │  Tool Call (למשל inspectApplicationState) מוצפן/מזוהה ל-Local Agent המשויך למשרד
   ▼  (WebSocket/Realtime Channel מאומת, לא HTTP פתוח)
apps/local-agent (אצל הלקוח)
   │  (3) שולף Credential מ-DPAPI/Credential Manager - בעצמו, לא מהענן
   │  (4) מפעיל Connector (חשבשבת/וכו') לפי סדר העדיפות (API>קבצים>Browser>UIA>Vision)
   │  (5) מבצע פעולה בפועל, קורא תוצאה, בונה evidence (לוג סמנטי + screenshot Reference מקומי)
   ▼
ToolResult מובנה חוזר ל-workflow-engine
   │  (6) accounting-engine מריץ בדיקות דטרמיניסטיות (איזון, סבירות, כפילות)
   │  (7) ai-orchestrator מפרש, מחליט על הצעד הבא / שואל הבהרה / ממשיך
   ▼
Checkpoint חדש נשמר (Resumable מכאן והלאה)
   │  ... חוזר על עצמו עד השלמת התוכנית ...
   ▼
approval-engine בונה Approval Package
   ▼
Approval Inbox (apps/web) - משתמש מאשר/דוחה/עורך
   ▼
executeApprovedActions - רק כעת מתבצע רישום סופי/בלתי הפיך, שוב דרך Local Agent
   ▼
audit מתעד הכול
```

## 4. שכבת Computer Use (`packages/computer-use`)

חייבת לרוץ בתוך `local-agent` (Windows), לא בענן. שכבת הפשטה אחידה מעל:
1. **Windows UI Automation** (UIA) - ראשי לאפליקציות Desktop (חיסולית, שיקלולית, חשבשבת אם Desktop).
2. **Playwright** - לתוכנות מבוססות Web (קונטו אם Web, ואולי חשבשבת Web).
3. **OCR/Vision** - Fallback בלבד, כשה-2 הראשונים נכשלים (לפי דרישת המפרט המקורי - לא ערוץ ראשי).

כל פעולה עוברת דרך "אסטרטגיית איתור" מדורגת (מפורט ב-`03-AGENT-STATE-MACHINE.md` סעיף Recovery): Accessibility Tree → מזהה סמנטי → OCR/Vision → בדיקת שינוי מסך → **לעולם לא קליק לפי קואורדינטות בלבד ללא אימות**.

## 5. Software Connector - תבנית אחידה (`packages/connectors`)

כל Connector (`hashavshevet`, `hisulit`, `shikulit`, `konto`, ובעתיד נוספים) הוא מודול שמממש ממשק קבוע:

```ts
interface SoftwareConnector {
  id: string;
  openApplication(): Promise<ToolResult>;
  detectWindow(): Promise<ToolResult>;
  selectClient(clientId: string): Promise<ToolResult>;
  knownScreens: ScreenDescriptor[];
  actions: ConnectorAction[];            // כל אחת עם Zod schema לקלט/פלט
  preconditions: Precondition[];
  successCriteria: SuccessCriterion[];
  knownErrors: KnownError[];
  verifyResult(action, result): Promise<VerificationOutcome>;
  actionsRequiringApproval: string[];     // תת-קבוצה של actions
  recoveryStrategy: RecoveryStrategy;
}
```

סדר עדיפות מימוש לכל פעולה בתוך Connector (מהמפרט המקורי): **API רשמי → ייבוא/ייצוא קבצים → Browser Automation → Windows UI Automation → Vision/OCR**. גם כשמשתמשים ב-API, `apps/web` מציג למשתמש מה בוצע - שקיפות מלאה בכל מקרה.

**הערה קריטית:** אף Connector לא ייבנה במלואו ולא יוצג כ"פעיל" לפני קבלת תיעוד רשמי, גישה מורשית וסביבת בדיקה מהיצרן הרלוונטי (ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`). כרגע יש רק את ה-Interface והמבנה, ללא מימוש.

## 6. AI Orchestrator - איך הוא "מבין" מסך

ה-Orchestrator **לא** רואה פיקסלים. הוא מקבל מ-`inspectApplicationState` (Tool) ייצוג מובנה: שם המסך שזוהה (`knownScreens` של ה-Connector), רשימת שדות/ערכים שנקראו (מ-UIA Accessibility Tree קודם כול, לא מ-OCR), ואם התוכן חדש/לא מזוהה - Vision Model מקבל את ה-screenshot לצורך זיהוי בלבד (לא לצורך "קליקים"). כל תוצאה נושאת `confidence`; מתחת לסף מוגדר הסוכן לא ממשיך לבד (ר' State Machine).

## 7. איך נלמד Workflow מהדגמה (Training Mode)

ר' פירוט מלא ב-`06-MVP-PLAN.md` (רכיב MVP #6) ובתיאור ה-Skill Format. בקצרה: `local-agent` מתעד **פעולות סמנטיות** (מסך→שדה→ערך→מקור→פעולה→תוצאה) דרך אותה שכבת Computer Use - לא הקלטת מקלדת/עכבר גולמית. ה-Orchestrator הופך רצף פעולות סמנטי ל-Workflow מוצע, המשתמש עורך, והתוצאה נשמרת כ-Skill ב-`packages/skills` (ובענן, ב-Supabase, לשימוש חוזר).

## 8. סיכונים ארכיטקטוניים מרכזיים

1. **שינוי ממשק בתוכנת היעד** (עדכון גרסה) שובר Connector - נדרש Validation אחרי כל פעולה + Recovery Strategy, לא רק "לפני".
2. **Latency בין ענן ל-Local Agent** - כל Tool Call עובר רשת; Workflow ארוך (סגירה שנתית) חייב Checkpoint תכוף כדי שניתוק לא יאבד עבודה.
3. **MFA/CAPTCHA** עוצרים אוטומציה מוחלטת - חובה Human-in-the-loop synchronous handoff (ר' State Machine, מצב `AwaitingHumanAuth`).
4. **רישוי/תנאי שימוש** של התוכנות המקוריות מול אוטומציה - שאלה פתוחה, ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`.

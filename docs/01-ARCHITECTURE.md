# Architecture - Accountant AI Operator

> **עדכון (2026-09-23):** מסמך זה שוכתב במלואו כדי לתאר את הארכיטקטורה **בפועל**, אחרי שהכיוון הארכיטקטוני המקורי (ענן + Local Agent נפרד) הוחלף לגמרי. הגרסה הקודמת של המסמך (המתוארת בענן/Supabase/Local Agent נפרד) נשמרת בהיסטוריית ה-git לרפרנס, אך אינה משקפת את הקוד הקיים.

## 1. עקרון-העל: הכול רץ בתוך אפליקציית ה-Desktop

בניגוד לתכנון המקורי (Orchestrator בענן + Local Agent נפרד ב-.NET שמתקשר איתו דרך Supabase Realtime), הארכיטקטון בפועל הרבה יותר פשוט: **תהליך Electron אחד** (`apps/desktop`) מריץ את כל הלוגיקה - צילומי מסך, קריאה ל-AI, ביצוע קליקים/הקלדה, אחסון מוצפן מקומי, יומן ביקורת. אין Orchestrator נפרד, אין Workflow Engine, אין State בענן.

| רץ ב-Vercel (`apps/web`) | רץ בתוך תהליך ה-Electron (`apps/desktop`) |
|---|---|
| דפי UI סטטיים/React בלבד - `/agent`, `/audit`, `/integrations`, `/download` | כל הלוגיקה בפועל: לולאת ה-agent, צילום מסך, קריאות ל-AI, ביצוע עכבר/מקלדת |
| נטען **בתוך** חלון ה-`BrowserWindow` של Electron - זה לא "הענן" עבור המשתמש, זו רק שכבת התצוגה | אחסון מוצפן מקומי (`safeStorage`/DPAPI): מפתח ה-API, סיסמאות התחברות לתוכנות |
| אין שום נתיב קובץ, סיסמה, צילום מסך, או תוצאה של ריצה שנשלח לשרת Vercel | יומן ביקורת מקומי (JSON לכל ריצה), זיכרון מסכים לכל connector |
| ה-API היחיד שהוא קורא לו הוא `api.github.com` (בדיקת גרסה להורדה) | הקריאה החיצונית היחידה מלבד GitHub: `api.x.ai` (xAI Grok, לצורך ה-vision) |

**מסקנה קריטית שעדיין תקפה מהתכנון המקורי:** ה-AI לעולם לא מקבל סיסמה בפועל. כשצריך להזין שם משתמש/סיסמה שמורים, המודל מבקש פעולה סמלית (`type_credential`, ר' סעיף 4) - הערך האמיתי נשלף מקומית ומוקלד רגע לפני הביצוע, בלי לעבור אף פעם דרך הבקשה/תשובה מול ה-AI ובלי להישמר ביומן הביקורת.

## 2. מבנה המונוריפו (כפי שהוא בפועל)

```
accountant-ai-operator/
├── apps/
│   ├── web/                      # Next.js, דפי ה-UI, נפרס ל-Vercel
│   │   ├── app/agent/            # מסך ה-AI Agent - משימות, תור, אישור/שאלה, לוג
│   │   ├── app/audit/            # יומן ביקורת מלא, עם עימוד וייצוא
│   │   ├── app/integrations/     # חיבור תוכנות - גרירה/בחירת קובץ
│   │   ├── app/download/         # עמוד הורדת האפליקציה
│   │   ├── app/api/download/desktop/route.ts  # מפנה ל-.exe העדכני מ-GitHub Releases
│   │   ├── components/           # ConnectorCard, IntegrationsGrid, RunHistory וכו'
│   │   ├── lib/connectors.ts     # רשימת התוכנות הנתמכות (סטטית)
│   │   └── types/electron-api.d.ts   # טיפוסי TypeScript מקבילים ידנית ל-preload.ts
│   └── desktop/                  # Electron - כל הלוגיקה בפועל
│       └── src/
│           ├── main.ts           # תהליך ה-Main: חלון, IPC handlers, auto-updater
│           ├── preload.ts        # contextBridge - חושף window.electronAPI לצד ה-renderer
│           ├── task-runner.ts    # לולאת ה-agent: צילום → החלטת AI → אישור? → ביצוע → חזור
│           ├── computer-use.ts   # צילום מסך (desktopCapturer) + עכבר/מקלדת (nut-js)
│           ├── ai/grok.ts        # קליינט xAI Grok, system prompt, ניתוח תשובה בטוח
│           ├── settings.ts       # אחסון מוצפן מקומי - מפתח API + פרטי התחברות
│           ├── screen-memory.ts  # זיכרון מסכים שנלמדו בפועל, לפי connector
│           ├── run-history.ts    # יומן ביקורת מקומי (JSON per run)
│           └── window-reload.ts  # ניסיון חוזר אוטומטי אם טעינת ה-UI נכשלת
└── docs/                          # המסמכים האלה
```

אין `services/`, אין `packages/`, אין `apps/local-agent`, אין Supabase בקוד בפועל (יש שרידי SQL ב-`supabase/migrations` שלא בשימוש על ידי אף אפליקציה).

## 3. זרימת הריצה בפועל (Request Lifecycle)

```
משתמש (מסך /agent) מקליד משימה, לוחץ "התחל"
   │  IPC: aiop:run-task(task, connectorId)
   ▼
main.ts  - נועל (רק ריצה אחת בו-זמנית), קורא ל-task-runner.ts
   ▼
task-runner.ts - לולאה עד MAX_STEPS=40:
   1. computer-use.ts.captureScreenshot() - צילום, מוקטן אם המסך גדול מ-1600px
   2. ai/grok.ts.requestNextAction() - שולח היסטוריה (עד 20 צעדים אחרונים) + צילום ל-xAI,
      מקבל reasoning + screenLabel + confidence + requiresApproval + action
      (עם retry אוטומטי על תקלות רשת/שרת חולפות, לא על שגיאות מפתח API)
   3. אם action="ask" - עוצר, שואל את המשתמש, ממתין לתשובה, ממשיך
   4. אם requiresApproval=true - עוצר, מציג למשתמש לאישור/דחייה
   5. אם action="type_credential" - שולף את הסיסמה/שם המשתמש האמיתיים לוקאלית
      (settings.ts), מקליד אותם - הערך עצמו לא נכנס ליומן/להיסטוריה
   6. מבצע (computer-use.ts.executeAction) - עכבר/מקלדת בפועל
   7. שומר checkpoint ליומן הביקורת (run-history.ts) + מעדכן זיכרון מסכים (screen-memory.ts)
   ▼
עד action="done", שגיאה, דחייה, עצירה ידנית, או MAX_STEPS
   ▼
run-history.ts שומר את הריצה המלאה - נגיש דרך /audit
```

אין Workflow Engine נפרד, אין accounting-engine דטרמיניסטי, אין Approval Package מובנה - ה-`requiresApproval` נקבע ע"י המודל עצמו לפי כללים ב-system prompt (ר' `04-TOOL-REGISTRY.md` סעיף "אכיפת אישור" לפרטים על המגבלה האמיתית כאן).

## 4. איך הסוכן "רואה" את המסך - Vision-first, לא UIA/Playwright

בניגוד לתכנון המקורי (UIA ראשי, Vision כ-Fallback בלבד): המימוש בפועל הוא **Vision-first ובלעדי**. אין שכבת Accessibility Tree, אין Playwright, אין "אסטרטגיית איתור מדורגת". xAI Grok מקבל צילום מסך גולמי (base64 PNG) ובוחר ישירות קואורדינטת קליק/טקסט להקליד/מקש ללחוץ, לפי מה שהוא רואה בתמונה.

מגבלת ביטחון קיימת בפועל: `CONFIDENCE_THRESHOLD = 0.95` ב-`ai/grok.ts` - אם המודל מדווח ביטחון נמוך יותר, ה-system prompt מנחה אותו לבחור `action: "ask"` במקום לנחש. זו בקרה בפרומפט, לא אכיפה דטרמיניסטית בקוד (הקוד רק דואג לברירת מחדל בטוחה אם השדה חסר/פגום - ר' `requestNextAction`'s safe defaults).

## 5. "Connector" - הרבה יותר פשוט ממה שתוכנן

אין ממשק `SoftwareConnector` עם Zod schemas, `verifyResult`, `recoveryStrategy` וכו'. Connector בפועל הוא רשומה סטטית (`apps/web/lib/connectors.ts`): `id`, `name`, `description`. המשתמש בוחר/גורר את קובץ ה-`.exe` (או קיצור דרך) פעם אחת דרך `/integrations`, הנתיב נשמר מקומית (`connector-paths.json`), ומשם האפליקציה רק מפעילה אותו (`shell.openPath`) ומריצה את לולאת ה-Vision מעליו - אין אינטגרציה ייעודית לפי סוג התוכנה.

תוכנות נתמכות כרגע: Hashavshevet (חשבשבת), Hisulit (חיסולית), Shikulit (שיקולית), Konto (קונטו), Dokka.

**הערה שעדיין תקפה מהתכנון המקורי:** אף Connector לא מוצג כמבוסס על תיעוד רשמי/API של היצרן - זו אוטומציית Vision גנרית, לא אינטגרציה רשמית (ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`).

## 6. סיכונים ארכיטקטוניים מרכזיים (מעודכן)

1. **שינוי ממשק בתוכנת היעד** (עדכון גרסה) עדיין שובר את היכולת של ה-AI לזהות מסכים נכון - אין היום מנגנון Validation/Recovery ייעודי מעבר לביטחון-ה-AI-עצמו וללולאת ניסיון-חוזר על שגיאות רשת.
2. **Latency מול xAI** - כל צעד שולח תמונה ומחכה לתשובה; משימות ארוכות (עד 40 צעדים) יכולות לקחת זמן משמעותי. יש retry אוטומטי על תקלות חולפות (`task-runner.ts`), אין עדיין caching/מאקרו לצעדים חוזרים (רעיון פתוח, לא ממומש).
3. **MFA/CAPTCHA** עוצרים אוטומציה - אין today מצב ייעודי לזה מעבר ל-`action: "ask"` הכללי.
4. **רישוי/תנאי שימוש** של התוכנות המקוריות מול אוטומציית Vision - שאלה פתוחה, ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`.
5. **אמינות הקלדה/קליק** - עיכובי הקלט המובנים של `nut-js` הוקטנו (ר' commit "Reduce nut-js's built-in per-input-event delay") לטובת מהירות; זה שינוי שעדיין דורש אימות מול תוכנות ישנות/איטיות בפועל.
</content>

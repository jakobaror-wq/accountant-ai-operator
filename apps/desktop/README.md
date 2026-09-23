# Accountant AI Operator - Desktop

אפליקציית שולחן-עבודה (Electron) שטוענת בתוכה את אותו אתר שרץ ב-Vercel (`apps/web`) ומריצה **בתוכה** את כל הלוגיקה בפועל של המוצר: סוכן ה-AI שמפעיל תוכנות הנה"ח, אחסון מוצפן מקומי, ויומן ביקורת. זו לא רק "עטיפה" לאתר - זה התהליך שבו קורה כל הפעולה בפועל. ר' `../../docs/01-ARCHITECTURE.md` להסבר המלא של החלוקה בין `apps/web` (UI בלבד) לכאן (כל הלוגיקה).

## יכולות (`window.electronAPI`, נחשף דרך `contextBridge`)

### חיבור תוכנות (בחירת קובץ)
- `pickExecutable(connectorId)` - פותח דיאלוג בחירת קובץ מקומי (native, לא HTML), שומר את הנתיב שנבחר.
- `launchExecutable(connectorId)` - מפעיל את הקובץ שנשמר לאותו connectorId דרך `shell.openPath`.
- `getConnectorPaths()` - מחזיר את כל הנתיבים השמורים.

שום נתיב קובץ לא נשלח לענן - השמירה מקומית בלבד (`app.getPath("userData")/connector-paths.json`).

### סוכן ה-AI (Computer Use)
- `runTask(task, connectorId)` - מתחיל משימה חדשה: הסוכן מצלם מסך, מחליט על הפעולה הבאה מול xAI Grok (vision), מבצע אותה (עכבר/מקלדת דרך `nut-js`), וחוזר על זה עד סיום או עד 40 צעדים. פירוט מלא ב-`../../docs/09-COMPUTER-USE-AGENT.md`.
- `stopTask()` - עצירה לפני הצעד הבא (לא באמצע פעולה שכבר החלה).
- `approveAction()` / `rejectAction()` - מענה לבקשת אישור על פעולה שמשנה נתון בתוכנה.
- `answerQuestion(answer)` - מענה לשאלה שה-AI שאל (`action:"ask"`).
- `getAgentStatus()` - סטטוס ריצה נוכחי (לשחזור UI אחרי רענון עמוד).
- `onTaskUpdate(callback)` - מאזין לאירועי לולאת הסוכן בזמן אמת (צילום, פעולה, שגיאה, סיום וכו').

### הגדרות ופרטי התחברות שמורים (מוצפן)
- `getSettings()` / `setXaiApiKey(key)` - ניהול מפתח ה-API של xAI.
- `getConnectorCredentials(connectorId)` / `setConnectorCredentials(connectorId, username, password)` / `clearConnectorCredentials(connectorId)` / `hasConnectorCredentials(connectorId)` - ניהול שם משתמש/סיסמה שמורים לכל תוכנה, כדי שהסוכן יוכל להתחבר אוטומטית בלי שהמשתמש יקליד ידנית בכל ריצה.

כל השמירה כאן מוצפנת דרך `safeStorage` של Electron (DPAPI על Windows, ברמת מערכת ההפעלה) - קובץ `settings.enc` יחיד ב-`userData`. **הסיסמה עצמה אף פעם לא נשלחת ל-AI** - ר' מנגנון `type_credential` ב-`../../docs/04-TOOL-REGISTRY.md` §3.

### יומן ביקורת
- `listRuns()` / `getRun(id)` - קריאת היסטוריית ריצות (JSON מקומי לכל ריצה, `userData/runs/`).

## הרצה מקומית (פיתוח)

```bash
npm install
AIOP_WEB_URL=http://localhost:3100 npm start
```

מריצים `apps/web`'s dev server (`npm run dev`, פורט 3100) בטרמינל נפרד קודם - האפליקציה טוענת את הכתובת הזו בתוך `BrowserWindow`.

## בנייה

```bash
npm run dist:win     # NSIS installer ל-Windows (עם קיצור דרך לשולחן העבודה)
npm run dist:linux   # AppImage, לבדיקה מקומית בלבד
```

בנייה ל-Windows דורשת בפועל Windows runner (ר' `../../.github/workflows/build-desktop.yml` שמריץ את זה אוטומטית ב-GitHub Actions ומפרסם Release עם קובץ ה-`.exe`, נגיש גם דרך `/download` באתר). האפליקציה לא חתומה דיגיטלית (Code Signing) - Windows SmartScreen עשוי להציג אזהרה בהתקנה הראשונה.

## מבנה קוד עיקרי (`src/`)

| קובץ | תפקיד |
|---|---|
| `main.ts` | תהליך ה-Main: יצירת חלון, כל ה-IPC handlers, auto-reload בכשל טעינה |
| `preload.ts` | `contextBridge` - חושף את `window.electronAPI` המתואר למעלה, לא יותר |
| `task-runner.ts` | לולאת סוכן ה-AI (עד 40 צעדים): צילום → החלטת AI → אישור/שאלה אם צריך → ביצוע → checkpoint |
| `computer-use.ts` | צילום מסך (`desktopCapturer`, כולל התאמה נכונה למסך הראשי במערכת רב-מסכים) + עכבר/מקלדת (`nut-js`) |
| `ai/grok.ts` | קליינט xAI Grok - system prompt, בניית ה-prompt מההיסטוריה, ניתוח תשובה עם ברירות מחדל בטוחות |
| `settings.ts` | אחסון מוצפן מקומי - מפתח API + פרטי התחברות |
| `screen-memory.ts` | זיכרון מסכים שנלמדו בפועל, לפי connector (`connectors/<id>/screens.json`) |
| `run-history.ts` | יומן ביקורת מקומי (`runs/*.json`), עם cache בזיכרון |
| `window-reload.ts` | ניסיון חוזר אוטומטי (exponential backoff) אם טעינת ה-UI מ-Vercel נכשלת |

## אייקון

`build/icon-source.svg` הוא המקור; `build/icon.png` ו-`build/icon.ico` נוצרו ממנו (Sharp + png-to-ico). לשינוי הלוגו - עורכים את ה-SVG ומריצים מחדש את סקריפט ההמרה (ר' היסטוריית ה-commit שיצר את הקבצים לרפרנס לפקודה המדויקת).

## מגבלות ידועות

ר' `../../docs/09-COMPUTER-USE-AGENT.md` (סעיף "מגבלות ידועות") ו-`../../docs/02-THREAT-MODEL.md` לפירוט מלא - בתמצית: לא נבדק Windows אמיתי מקצה לקצה מסביבת הפיתוח, אין עדיין שכבת אכיפת-אישור דטרמיניסטית נפרדת מה-AI עצמו, ואין caching/מאקרו לצעדים חוזרים.

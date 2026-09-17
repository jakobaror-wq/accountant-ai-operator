# v1 - מודל חיבור לתוכנות (לפני Computer Use מלא)

## החלטה (עדכון v1.1)

לפני בניית שכבת Computer Use מלאה (UIA/Playwright/OCR, ר' `01-ARCHITECTURE.md`), הגרסה הראשונה היא **מסך חיבורים** - `apps/web` מסך `/integrations`, עם התחברות אמיתית (Supabase Auth, magic link) ונתוני החיבור נשמרים לפי משרד (`connector_configs`, ר' `05-DATA-MODEL.md`). לכל אחת מ-4 התוכנות המשרד בוחר את סוג החיבור:

1. **דרך דפדפן** - מדביקים כתובת התחברות, וכפתור "התחבר ל-X" פותח אותה בכרטיסייה חדשה. זהה במהות לדפוס "התחברות לבנק" הקיים ב-SolFinx, בלי שלב ה-Scraping האוטומטי - זה עדיין לא קיים כאן.
2. **מותקן על המחשב** - **אפליקציית Desktop** (`apps/desktop`, Electron) עם לוגו וקיצור-דרך על שולחן העבודה. בתוכה: כפתור "בחר תוכנה" פותח דיאלוג קבצים **מקומי ורגיל** (לא URL, לא עריכת JSON ידנית) לבחירת קובץ ה-exe, וכפתור "פתח את X" מריץ אותו.

### עדכון v1.1 - למה זנחנו את גישת ה-Protocol Handler/PowerShell

הגרסה הקודמת (v1.0) דרשה מהמשתמש להריץ `install.ps1`, ואז **לערוך ידנית קובץ config.json** עם נתיבי exe מדויקים. זה סורבל מדי בפועל. הוחלף באפליקציית Desktop אחת (Electron) שעושה את אותו דבר בלחיצת כפתור על דיאלוג קבצים רגיל - בלי עריכת קבצים, בלי Registry ידני, ועם קיצור-דרך יפה על שולחן העבודה. שני ההיבטים שכן נשמרו מהגרסה הקודמת:

- **החיבור לענן נשאר**: האפליקציה טוענת בתוכה את אותו אתר שרץ ב-Vercel (`BrowserWindow.loadURL`), כך שזו עדיין אותה מערכת, לא כלי נפרד - עדכון עתידי באתר מגיע גם למשתמשי ה-Desktop בלי לבנות מחדש את האפליקציה.
- **אותה החלטת אבטחה**: הנתיב הנבחר **נשמר רק מקומית** (קובץ JSON בתיקיית `userData` של Electron, לא בענן, לא ב-Supabase) ונקרא רק לפי `connectorId` - שום קלט חיצוני (מהדף שנטען) לא יכול לגרום להפעלת קובץ; רק לחיצה על "בחר תוכנה" בתוך האפליקציה עצמה (native dialog, לא HTML) קובעת מה ניתן להפעיל. ר' `02-THREAT-MODEL.md` סעיף Elevation of Privilege.

## איך זה עובד טכנית

`apps/desktop/src/main.ts` יוצר חלון עם `preload.ts` שחושף ל-`window.electronAPI` שלוש פעולות (`getConnectorPaths`, `pickExecutable`, `launchExecutable`) דרך `contextBridge` (עם `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). קומפוננטת `apps/web/components/ConnectorCard.tsx` בודקת אם `window.electronAPI` קיים: אם כן - מציגה את כפתורי הבחירה/הפעלה; אם לא (דפדפן רגיל) - מציגה קישור להורדת האפליקציה (`/download`).

בנייה ל-Windows (NSIS, עם קיצור-דרך לשולחן העבודה ואייקון) רצה ב-GitHub Actions על runner של Windows אמיתי (`.github/workflows/build-desktop.yml`) - לא cross-compile מה-Sandbox של הפיתוח - ומפרסמת Release עם קובץ ה-`.exe`.

## מה במפורש **לא** ב-v1.1 הזה

- אין קריאת נתונים אוטומטית מהתוכנה אחרי שהיא נפתחת (זה שלב 2-4 בתוכנית הפיתוח).
- הנתיב המקומי לכל תוכנה לא מסונכרן בין מחשבים (אם עובדים מכמה תחנות, בוחרים פעם אחת בכל תחנה) - שיפור עתידי אם יידרש.
- האפליקציה לא חתומה דיגיטלית (Code Signing) - Windows SmartScreen עשוי להציג אזהרה בהתקנה הראשונה. חתימה דורשת תעודה בתשלום, לא נכלל ב-v1.
- אין עדיין Connector אמיתי - כל ה-4 "תוכנות" הן Placeholder שהמשרד ממלא בעצמו (URL/נתיב מקומי), בהתאם למחויבות ב-`07-ASSUMPTIONS-OPEN-QUESTIONS.md` שלא להציג אינטגרציה כפעילה בלי תיעוד/גישה/סביבת בדיקה רשמיים.

## איך להריץ מקומית

```bash
# האתר
cd apps/web
npm install
npm run dev     # http://localhost:3100

# אפליקציית ה-Desktop (בטרמינל נפרד)
cd apps/desktop
npm install
AIOP_WEB_URL=http://localhost:3100 npm start
```

הורדת אפליקציית ה-Desktop המותקנת מוסברת במסך `/download` באתר (מפנה ל-GitHub Releases של הריפו).

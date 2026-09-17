# v1 - מודל חיבור לתוכנות (לפני Computer Use מלא)

## החלטה

לפני בניית שכבת Computer Use מלאה (UIA/Playwright/OCR, ר' `01-ARCHITECTURE.md`), הגרסה הראשונה שנבנתה היא **מסך חיבורים ידני** - `apps/web` מסך `/integrations`. לכל אחת מ-4 התוכנות המשרד בוחר בעצמו את סוג החיבור:

1. **דרך דפדפן** - אם לתוכנה יש כתובת אינטרנט להתחברות, המשרד מדביק אותה, וכפתור "התחבר ל-X" פותח אותה בכרטיסייה חדשה (`window.open`/`target="_blank"`). זהה במהות לדפוס "התחברות לבנק" הקיים ב-SolFinx (כפתור עם קישור), רק **בלי** שלב הקריאה/Scraping האוטומטי - זה עדיין לא קיים כאן.
2. **מותקן על המחשב** - כפתור "פתח את X" שולח קישור מסוג `accountant-ai-operator://launch/<connectorId>` שמופעל ע"י **Local Launcher** קטן (`apps/web/public/local-launcher/*.ps1`) שנרשם כ-Protocol Handler תחת המשתמש הנוכחי (HKCU, ללא הרשאות Administrator).

## למה ככה, ולא Computer Use מהתחלה

- זו הבקשה המפורשת: "תתחיל בבניית הגרסה הראשונה לפני שיפורים ועדכונים" - השלב הזה עצמו כבר שימושי (חוסך למשתמש לחפש/לפתוח כל תוכנה בנפרד) בלי לחכות למימוש המלא של Local Agent + Credential Vault + State Machine.
- הוא גם **תואם את מדיניות האבטחה** שכבר נקבעה ב-`02-THREAT-MODEL.md`: אין כאן שום Credential, שום קריאה אוטומטית של נתונים, שום שליחה של דבר לענן - רק פתיחת כתובת/תוכנה. סיכון נמוך משמעותית מגרסה עתידית שקוראת ומזינה נתונים.
- הוא בונה את התשתית לשלב הבא: ה-Local Launcher הזה הוא **הגרעין** של `apps/local-agent` העתידי - אותו מנגנון רישום (Device-local, HKCU) יורחב בהמשך ליכולות Computer Use מלאות, בלי לשנות את חוזה ה-URI.

## החלטת אבטחה מכוונת - למה ה-URI לא מכיל נתיב קובץ

Custom Protocol Handler הוא **גלובלי במערכת ההפעלה** - כל אתר יכול לנסות להפעיל אותו, לא רק `apps/web`. לכן `launcher.ps1` **לעולם לא** מקבל נתיב הפעלה מה-URL עצמו; הוא מקבל רק `connectorId`, ומחפש את הנתיב האמיתי אך ורק ב-`config.json` המקומי (Whitelist שהמשרד עורך בעצמו, פעם אחת, על המחשב שלו). כך גם אתר זדוני שיודע את שם ה-Protocol לא יכול לגרום להפעלת תוכנה שרירותית - ר' `02-THREAT-MODEL.md` סעיף Elevation of Privilege.

## מה במפורש **לא** ב-v1 הזה

- אין קריאת נתונים אוטומטית מהתוכנה אחרי שהיא נפתחת (זה שלב 2-4 בתוכנית הפיתוח).
- אין אחסון Supabase ל-config של החיבורים - כרגע `localStorage` בדפדפן בלבד (v1, פר-מכשיר, לא פר-משרד). המעבר ל-`connector_credential_ref` (`05-DATA-MODEL.md`) הוא שיפור מתוכנן, לא בוצע.
- אין זיהוי (Ping/Detection) אם ה-Local Launcher מותקן בפועל - כמו ש-SolFinx גילה עם הבנקים, זיהוי אמין של Custom Protocol Handler קשה/לא אמין בדפדפנים; ב-v1 יש רק מדריך התקנה + לוג מקומי (`launcher.log`) לדיבוג, בלי ניחוש UX.
- אין עדיין Connector אמיתי - כל ה-4 "תוכנות" הן Placeholder שהמשרד ממלא בעצמו (URL/נתיב), בהתאם למחויבות ב-`07-ASSUMPTIONS-OPEN-QUESTIONS.md` שלא להציג אינטגרציה כפעילה בלי תיעוד/גישה/סביבת בדיקה רשמיים.

## איך להריץ מקומית

```bash
cd apps/web
npm install
npm run dev
```

מסך הבית מפנה ל-`/integrations`. מדריך ה-Local Launcher נמצא ב-`/integrations/local-launcher`, והקבצים להורדה ב-`/public/local-launcher/`.

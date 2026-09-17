# Accountant AI Operator

> סוכן AI אוטונומי המפעיל בפועל תוכנות חשבונאות ישראליות קיימות (חשבשבת, חיסולית, שיקלולית, קונטו), מבצע תהליך עבודה מלא ומגיש חבילת אישור לרו"ח - לא Dashboard, לא אינטגרציית API בלבד.

**סטטוס נוכחי: v1 - מסך חיבורים (`apps/web`). עדיין אין קריאת נתונים אוטומטית מאף תוכנה, ואין שום Connector אמיתי - ר' [docs/08-V1-CONNECTION-MODEL.md](docs/08-V1-CONNECTION-MODEL.md).**

## הרצה מקומית

```bash
cd apps/web
npm install
npm run dev
```

## מסמכי שלב 0

| מסמך | תוכן |
|---|---|
| [docs/00-PRD.md](docs/00-PRD.md) | חזון, פרסונות, תהליכי משתמש, קריטריוני הצלחה, מה לא בפנים |
| [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) | מבנה ה-Monorepo, מה רץ איפה (Vercel/Supabase מול מחשב מקומי), זרימת נתונים |
| [docs/02-THREAT-MODEL.md](docs/02-THREAT-MODEL.md) | נכסים, תוקפים, גבולות אמון, איומים ומיטיגציות |
| [docs/03-AGENT-STATE-MACHINE.md](docs/03-AGENT-STATE-MACHINE.md) | מצבי הסוכן, מעברים, Checkpoints, התאוששות |
| [docs/04-TOOL-REGISTRY.md](docs/04-TOOL-REGISTRY.md) | כל Tool שה-AI רשאי לקרוא לו, סכימת קלט/פלט, מתי נדרש אישור |
| [docs/05-DATA-MODEL.md](docs/05-DATA-MODEL.md) | סכימת Supabase, ישויות, RLS, שכבות זיכרון |
| [docs/06-MVP-PLAN.md](docs/06-MVP-PLAN.md) | מה בדיוק ב-MVP, תוכנת Demo, קריטריוני קבלה |
| [docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md](docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md) | הנחות, חסמים ושאלות פתוחות לפני כל קוד משמעותי |
| [docs/08-V1-CONNECTION-MODEL.md](docs/08-V1-CONNECTION-MODEL.md) | מודל החיבור ב-v1: כפתורי דפדפן מול Local Launcher לתוכנות מותקנות |

## עקרון על

המשתמש לא מאשר כל לחיצה. הוא מאשר **תוצאות בלתי הפיכות**: רישום סופי, שינוי בלתי הפיך, דריסת נתונים, סגירת תקופה, חתימה/הגשה, שליחה לגורם חיצוני. כל השאר (קריאה, ניתוח, חישוב, הכנת טיוטה) קורה אוטומטית ומתועד.

אין להציג אף אינטגרציה עם חשבשבת/חיסולית/שיקלולית/קונטו כפעילה לפני קבלת תיעוד רשמי, גישה מורשית וסביבת בדיקה מהיצרן/מהלקוח.

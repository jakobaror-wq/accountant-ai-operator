# Accountant AI Operator

> סוכן AI אוטונומי המפעיל בפועל תוכנות חשבונאות ישראליות קיימות (חשבשבת, חיסולית, שיקלולית, קונטו), מבצע תהליך עבודה מלא ומגיש חבילת אישור לרו"ח - לא Dashboard, לא אינטגרציית API בלבד.

**סטטוס נוכחי: סוכן AI פעיל שמפעיל תוכנות בפועל (מסך `/agent`) - לא רק מסך חיבורים. ר' [docs/09-COMPUTER-USE-AGENT.md](docs/09-COMPUTER-USE-AGENT.md) לפירוט המלא.**

## הרצה מקומית

```bash
# אתר ה-UI (Next.js)
cd apps/web
npm install
npm run dev            # פועל על http://localhost:3100

# אפליקציית שולחן העבודה (Electron) - בטרמינל נפרד
cd apps/desktop
npm install
AIOP_WEB_URL=http://localhost:3100 npm start
```

## מסמכים

| מסמך | תוכן |
|---|---|
| [docs/00-PRD.md](docs/00-PRD.md) | חזון, פרסונות, תהליכי משתמש, קריטריוני הצלחה, מה לא בפנים |
| [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) | הארכיטקטורה בפועל - תהליך Electron אחד, לא ענן+Local Agent נפרד |
| [docs/02-THREAT-MODEL.md](docs/02-THREAT-MODEL.md) | נכסים, תוקפים, גבולות אמון, איומים ומיטיגציות |
| [docs/03-AGENT-STATE-MACHINE.md](docs/03-AGENT-STATE-MACHINE.md) | מצבי הסוכן, מעברים, Checkpoints, התאוששות |
| [docs/04-TOOL-REGISTRY.md](docs/04-TOOL-REGISTRY.md) | פעולות המחשב הגולמיות שה-AI מבצע, ומה עדיין לא אכיפה דטרמיניסטית |
| [docs/05-DATA-MODEL.md](docs/05-DATA-MODEL.md) | קבצים מקומיים (לא Supabase) - יומן ביקורת, זיכרון מסכים, הגדרות מוצפנות |
| [docs/06-MVP-PLAN.md](docs/06-MVP-PLAN.md) | **היסטורי** - התוכנית המקורית, הוחלפה בפועל בכיוון אחר |
| [docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md](docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md) | הנחות, חסמים ושאלות פתוחות |
| [docs/08-V1-CONNECTION-MODEL.md](docs/08-V1-CONNECTION-MODEL.md) | מודל חיבור התוכנות - גרירה/בחירת קובץ מקומית |
| [docs/09-COMPUTER-USE-AGENT.md](docs/09-COMPUTER-USE-AGENT.md) | לולאת ה-AI Agent - צילום מסך, החלטה, אישור, ביצוע |

## עקרון על

המשתמש לא מאשר כל לחיצה. הוא מאשר **תוצאות בלתי הפיכות**: רישום סופי, שינוי בלתי הפיך, דריסת נתונים, סגירת תקופה, חתימה/הגשה, שליחה לגורם חיצוני. כל השאר (קריאה, ניתוח, חישוב, הכנת טיוטה) קורה אוטומטית ומתועד.

אין להציג אף אינטגרציה עם חשבשבת/חיסולית/שיקלולית/קונטו כפעילה לפני קבלת תיעוד רשמי, גישה מורשית וסביבת בדיקה מהיצרן/מהלקוח.

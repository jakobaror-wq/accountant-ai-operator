# Accountant AI Operator - Web UI

זהו אפליקציית ה-Next.js שמספקת את שכבת התצוגה (UI) של Accountant AI Operator - סוכן AI שמפעיל תוכנות הנה"ח ישראליות (חשבשבת, חיסולית, שיקלולית, קונטו, Dokka) דרך צילומי מסך + עכבר/מקלדת סינתטיים.

**חשוב להבין:** האפליקציה הזו **לא רצה עצמאית** בתור המוצר - היא רק שכבת ה-UI שנטענת בתוך אפליקציית ה-Desktop (`apps/desktop`, Electron). כל הלוגיקה בפועל (צילום מסך, קריאה ל-AI, ביצוע קליקים/הקלדה, אחסון מוצפן, יומן ביקורת) רצה בתוך תהליך ה-Electron, לא כאן. ר' `../../docs/01-ARCHITECTURE.md` להבנה מלאה של החלוקה.

## מסכים עיקריים

| נתיב | תוכן |
|---|---|
| `/agent` | המסך המרכזי - הקלדת משימה בשפה חופשית, תור משימות, לוג חי של הסוכן, צילום מסך אחרון, אישור/דחייה של פעולות, מענה לשאלות, ניהול פרטי התחברות שמורים |
| `/audit` | יומן ביקורת מלא - כל הריצות שבוצעו, עם עימוד וצפייה בפרטי כל צעד |
| `/integrations` | חיבור התוכנות - בחירת/גרירת קובץ ה-`.exe` לכל תוכנה נתמכת |
| `/download` | עמוד הורדת אפליקציית ה-Desktop (מפנה ל-GitHub Releases) |

## הרצה מקומית (פיתוח)

```bash
npm install
npm run dev
```

הכתובת: [http://localhost:3100](http://localhost:3100) (**לא** 3000 - הפורט הזה מוגדר ידנית ב-`package.json`, כי `apps/desktop`'s dev mode מצפה לו).

להרצה מלאה כולל שכבת ה-Electron (כדי לבדוק פיצ'רים שתלויים ב-`window.electronAPI`), ר' `../desktop/README.md`.

## מבנה קוד רלוונטי

- `app/agent/page.tsx` - המסך המרכזי, כולל לוגיקת תור המשימות והתקשורת עם `window.electronAPI`.
- `app/audit/page.tsx` - יומן הביקורת, עם עימוד (`PAGE_SIZE=20`).
- `app/api/download/desktop/route.ts` - route handler שמפנה דינמית ל-`.exe` העדכני מ-GitHub Releases (עם caching מוגבל, לא no-store).
- `components/ConnectorCard.tsx` / `components/IntegrationsGrid.tsx` - כרטיסי חיבור התוכנות.
- `lib/connectors.ts` - רשימת התוכנות הנתמכות (סטטית, כרגע 5).
- `types/electron-api.d.ts` - טיפוסי TypeScript המקבילים **ידנית** ל-`apps/desktop/src/preload.ts`. אם משנים את משטח ה-API בצד ה-Electron, יש לעדכן גם כאן.

## בדיקה שהאפליקציה זמינה כברירת מחדל בדפדפן רגיל

מכיוון ש-`window.electronAPI` לא קיים בדפדפן רגיל (רק בתוך Electron), רוב הקומפוננטות בודקות את קיומו ומציגות הודעה/קישור-הורדה מתאימים במקום להישבר. זה מאפשר `npm run dev`/`next build` רגילים בלי צורך בהרצת Electron בכל פעם, לצורך פיתוח מהיר על ה-UI בלבד.

## פריסה (Deployment)

נפרס אוטומטית ל-Vercel (`accountant-ai-operator.vercel.app`) בכל push ל-branch הראשי. אפליקציית ה-Desktop טוענת את אותו אתר שרץ ב-Vercel (`BrowserWindow.loadURL`), כך שעדכון באתר מגיע גם למשתמשי ה-Desktop בלי לבנות מחדש את האפליקציה - למעט שינויים שדורשים גם עדכון ב-`preload.ts`/`main.ts` עצמם.

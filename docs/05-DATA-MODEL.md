# Data Model - Accountant AI Operator

> **עדכון (2026-09-23):** מסמך זה שוכתב במלואו. אין Supabase בקוד בפועל - אין `office`/`client`/`tax_year`/`workflow_run`/`approval_package`/`skill` וכו'. כל האחסון הוא **קבצים מקומיים בתוך `app.getPath("userData")`** של אפליקציית ה-Electron, לעולם לא נשלח לשום שרת חוץ מ-xAI (לצורך ה-vision עצמו) ו-GitHub (בדיקת גרסה).

## 1. עקרון: קבצים מקומיים, לא סכמת DB עם RLS

אין Multi-tenancy, אין `office_id`, אין RLS - זו החלטה מפורשת (ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md` §3.1): **מחשב לוקאלי יחיד**, לא ריבוי-משתמשים. כל נתון שמור בקובץ JSON או קובץ מוצפן בתיקיית `userData` של Electron - אין DB, אין Auth, אין רשת מעורבת בשמירה/קריאה של אף אחד מהם.

## 2. `settings.enc` - מפתח API ופרטי התחברות (מוצפן)

מנוהל ב-`apps/desktop/src/settings.ts`. קובץ יחיד, מוצפן ב-`safeStorage` (DPAPI על Windows, ברמת מערכת ההפעלה - לא מפתח הצפנה שמנוהל בקוד). תוכן ה-JSON הפנימי (אחרי פענוח):

```ts
interface StoredSettings {
  xaiApiKey?: string;
  connectorCredentials?: Record<string, { username: string; password: string }>;  // לפי connectorId
}
```

אם `safeStorage.isEncryptionAvailable()` מחזיר `false` (נדיר, בעיקר בסביבות בדיקה ללא keyring), הכתיבה נכשלת בעדינות (מחזירה `false`) והמשתמש מקבל הודעה ברורה - לא קריסה שקטה.

## 3. `runs/*.json` - יומן ביקורת (audit trail)

מנוהל ב-`apps/desktop/src/run-history.ts`. קובץ JSON אחד לכל ריצה (`<startedAt-מנוקה>.json`), נכתב מחדש (upsert, לא append) בכל checkpoint לאורך הריצה:

```ts
interface StoredRunRecord {
  id: string;
  connectorId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  status: "in-progress" | "done" | "stopped" | "rejected" | "error" | "max-steps-reached";
  summary?: string;
  steps: RunStepRecord[];  // step, timestamp, reasoning?, screenLabel?, confidence?, action?, requiresApproval?, decision?, outcome, error?
}
```

**חשוב:** `action` בכל `RunStepRecord` הוא תמיד הגרסה הסמלית (למשל `{"type":"type_credential","field":"password"}`, לעולם לא הערך האמיתי - ר' `04-TOOL-REGISTRY.md` §3). אין צילומי מסך שמורים ביומן - רק metadata טקסטואלי.

נטען פעם אחת עצל לזיכרון (Map, לפי `id`) ומתעדכן ישירות בכתיבה - לא נסרק מחדש מהדיסק בכל קריאה (תוקן ב-commit "Cache run history in memory instead of re-scanning disk on every call"). `findIncompleteRun(connectorId)` מוצא ריצה שנשארה `in-progress` - סימן שהאפליקציה נסגרה/קרסה באמצע, לאפשר המשך (`resumeFrom`) בלי לחזור על פעולות שכבר בוצעו.

## 4. `connectors/<connectorId>/screens.json` - זיכרון מסכים

מנוהל ב-`apps/desktop/src/screen-memory.ts`. קובץ JSON נפרד לכל connector:

```ts
interface LearnedScreen {
  label: string;
  timesSeen: number;
  firstSeenAt: string;
  lastSeenAt: string;
  exampleReasoning: string;
}
```

נלמד **רק** ממה שהסוכן ראה בפועל בזמן ריצה - אין שום דבר כתוב מראש על אף תוכנה ספציפית (עקרון שנשמר מהתכנון המקורי, ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`). משמש כרמז הקשר ל-AI ("אם המסך תואם אחד המסכים המוכרים, השתמש באותו שם") - לא כמנגנון עקיפת-AI (אין עדיין "מאקרו" שמדלג על קריאת ה-AI לגמרי - רעיון פתוח, לא ממומש). נטען עצל לפי connector (לא כל התיקייה בבת אחת) ומתעדכן ישירות בכתיבה, מאותה סיבה כמו יומן הביקורת.

## 5. `connector-paths.json` - נתיבי קבצי הפעלה

מנוהל ב-`apps/desktop/src/main.ts` (`readConnectorPaths`/`writeConnectorPaths`). מיפוי פשוט `Record<connectorId, absolutePath>` - הנתיב לקובץ ה-`.exe` (או מה שנבחר/נגרר) של כל תוכנה. לא מוצפן (לא נתון רגיש) - רק מקומי.

## 6. אין שכבות זיכרון היררכיות (office/client/tax_year)

בניגוד לתכנון המקורי - אין היום שום זיכרון בסקופ של "משרד"/"לקוח"/"שנת מס"/"Workflow". הזיכרון היחיד הוא `screens.json` לפי connector (סעיף 4). אם בעתיד יידרש הקשר ברמת לקוח/שנה, זו תוספת חדשה, לא הרחבה של מנגנון קיים.

## 7. אין Decision Log / Approval Package נפרדים

אין טבלת `decision` נפרדת עם `alternatives`/`rationale`/`confidence` לכל החלטה - ה-`reasoning` וה-`confidence` שכבר קיימים בכל `RunStepRecord` (סעיף 3) הם כל מה שנשמר. אין `approval_package`/`approval_item`/`exception` נפרדים - אישור/דחייה הם רק שדה `decision` על הצעד עצמו.

## 8. מה עדיין פתוח

- אין עדיין מנגנון ניקוי/pruning ליומן הביקורת - הוא גדל לצמיתות (ר' `docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md` לשאלת מדיניות שימור נתונים).
- אין עדיין "מאקרו" שממפה רצף פעולות שכבר בוצע לביצוע חוזר בלי קריאת AI - נדון כרעיון יעילות עתידי, לא קיים.
</content>

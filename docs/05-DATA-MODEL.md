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

נלמד **רק** ממה שהסוכן ראה בפועל בזמן ריצה - אין שום דבר כתוב מראש על אף תוכנה ספציפית (עקרון שנשמר מהתכנון המקורי, ר' `07-ASSUMPTIONS-OPEN-QUESTIONS.md`). משמש כרמז הקשר ל-AI ("אם המסך תואם אחד המסכים המוכרים, השתמש באותו שם") - זה **לא** אותו מנגנון כמו ה-macros.json שמדלג בפועל על קריאת ה-AI (ר' סעיף 4א למטה); screens.json הוא רק רמז-שם, לא נתונים לצורך שידור-חוזר. נטען עצל לפי connector (לא כל התיקייה בבת אחת) ומתעדכן ישירות בכתיבה, מאותה סיבה כמו יומן הביקורת.

### 4א. `connectors/<connectorId>/macros.json` - שידור-חוזר בלי קריאת AI (מאקרו)

מנוהל ב-`apps/desktop/src/macros.ts`. קובץ JSON נפרד לכל connector, `Record<normalizedTask, Macro>`:

```ts
interface MacroStep {
  screenLabel: string;
  referenceThumbnail: string;   // PNG מוקטן (64x48, base64) - להשוואת-דמיון, לא לתצוגה
  reasoning: string;
  action: ComputerActionRequest;  // תמיד הגרסה הסמלית - type_credential נשאר סמלי
  requiresApproval: boolean;
}
interface Macro {
  connectorId: string;
  normalizedTask: string;       // task.trim().replace(/\s+/g," ").toLowerCase()
  recordedTask: string;
  recordedResolution: { width: number; height: number };
  sourceRunId?: string;
  createdAt: string;
  lastUsedAt?: string;
  timesReplayed: number;
  timesFellBackToAi: number;
  steps: MacroStep[];
}
```

**מתי נלמד:** בסוף כל ריצה שהסתיימה ב-`status:"done"` אמיתי, לא הייתה `resumeFrom`, ולא הכילה אף צעד `ask` (לא דטרמיניסטי מספיק לשידור-חוזר בטוח). כל הצעדים שבוצעו בפועל (`outcome:"executed"`) נשמרים כ-`MacroStep` - כולל תמונונת-השוואה שנגזרה מהצילום של אותו צעד. שמירה היא **עדכון/דריסה** לפי `(connectorId, normalizedTask)`, לא הוספה - כל משימה מחזיקה מאקרו אחד (העדכני ביותר) בלבד.

**מתי משתמשים בו (בזמן ריצה חדשה):** התאמה **מדויקת בלבד** אחרי נרמול (בלי fuzzy/embeddings - החלטת עיצוב מכוונת: התאמה שגויה בין שתי משימות "קרובות" מסוכנת הרבה יותר מהחמצת אופטימיזציה). אם נמצא מאקרו מתאים, בכל צעד: (1) בדיקת-רזולוציה **חד-פעמית** - אם הרזולוציה החיה לא זהה בדיוק ל-`recordedResolution`, המאקרו מבוטל לחלוטין לריצה הזו מהצעד הראשון (קואורדינטות אבסולוטיות לא בטוחות על מסך/DPI שונה); (2) לכל צעד, השוואת-דמיון (`bitmapDiffScore`, הפרש ממוצע-מוחלט לפי בית, מנורמל 0-1) בין תמונונת-המסך החי לתמונונת השמורה בצעד המאקרו המתאים - התאמה (מתחת לסף) מדלגת לגמרי על קריאת ה-AI ומשתמשת בהחלטה השמורה; אי-התאמה גורמת **לנפילה קבועה וסופית** ל-AI לשאר הריצה (לא ניסיון "להתיישר מחדש" עם המאקרו).

**איך זה נשאר בטוח - קריטי:** המאקרו רק מחליף *מאיפה מגיעה ההחלטה לצעד* (קאש מול קריאת AI חיה) - כל שאר הלוגיקה ב-`task-runner.ts` (בדיקת `requiresApproval` + `waitForApproval`, שליפת פרטי התחברות אמיתיים עבור `type_credential`, ביצוע, checkpoint) זהה **לגמרי ורצה תמיד**, בלי קשר למקור ההחלטה - אין נתיב-קוד שני נפרד לביצוע. לכן `requiresApproval` לא יכול "לדלוג" בגלל מאקרו, וסיסמה לעולם לא נשמרת/משוחזרת מהמאקרו (נשלפת מקומית מחדש בכל ביצוע, בדיוק כמו בזרימה הרגילה - ר' סעיף 3).

**מתג-כיבוי:** `MACRO_REPLAY_ENABLED` ב-`macros.ts` - קבוע קוד (לא UI), לכיבוי מלא של התכונה אם תתגלה כלא אמינה בפועל.

**לא נבדק בפועל מול תוכנה אמיתית** - ר' `09-COMPUTER-USE-AGENT.md` "מגבלות ידועות". הפער שלא ניתן לבדוק מהסביבה הזו: האם סף הדמיון (`MACRO_MATCH_THRESHOLD=0.05` ב-`task-runner.ts`) מבחין נכון בין "אותו מסך" ל"מסך שונה" מול רינדור אמיתי (אנטי-aliasing, טעינת פונטים, ערך משתנה על מסך שנשאר "אותו דבר" מבחינה מבנית), והאם משתמשים בפועל חוזרים על ניסוח משימה קרוב מספיק כדי שההתאמה המדויקת-בכוונה תפעיל בכלל לעיתים קרובות.

## 5. `connector-paths.json` - נתיבי קבצי הפעלה

מנוהל ב-`apps/desktop/src/main.ts` (`readConnectorPaths`/`writeConnectorPaths`). מיפוי פשוט `Record<connectorId, absolutePath>` - הנתיב לקובץ ה-`.exe` (או מה שנבחר/נגרר) של כל תוכנה. לא מוצפן (לא נתון רגיש) - רק מקומי.

## 6. אין שכבות זיכרון היררכיות (office/client/tax_year)

בניגוד לתכנון המקורי - אין היום שום זיכרון בסקופ של "משרד"/"לקוח"/"שנת מס"/"Workflow". הזיכרון היחיד הוא `screens.json` לפי connector (סעיף 4). אם בעתיד יידרש הקשר ברמת לקוח/שנה, זו תוספת חדשה, לא הרחבה של מנגנון קיים.

## 7. אין Decision Log / Approval Package נפרדים

אין טבלת `decision` נפרדת עם `alternatives`/`rationale`/`confidence` לכל החלטה - ה-`reasoning` וה-`confidence` שכבר קיימים בכל `RunStepRecord` (סעיף 3) הם כל מה שנשמר. אין `approval_package`/`approval_item`/`exception` נפרדים - אישור/דחייה הם רק שדה `decision` על הצעד עצמו.

## 8. מה עדיין פתוח

- אין עדיין מנגנון ניקוי/pruning ליומן הביקורת - הוא גדל לצמיתות (ר' `docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md` לשאלת מדיניות שימור נתונים).
- ~~אין עדיין "מאקרו" שממפה רצף פעולות שכבר בוצע לביצוע חוזר בלי קריאת AI~~ **קיים כעת** (ר' סעיף 4א למעלה) - טרם אומת בפועל מול תוכנה אמיתית.
</content>

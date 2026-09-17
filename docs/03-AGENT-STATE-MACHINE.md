# Agent State Machine - Accountant AI Operator

## 1. עקרונות מחייבים (מהמפרט המקורי)

כל Workflow חייב להיות: Resumable, Idempotent, ניתן לעצירה, ניתן לביטול ככל האפשר, עם Checkpoint אחרי כל שלב, עמיד לשינויי ממשק, ועם Validation אחרי כל פעולה.

## 2. מצבי-על (Run-level States)

```
Draft ──► Planning ──► AwaitingClarification ──► Planning
             │                                       │
             ▼                                       │
          Executing ◄────────────────────────────────┘
             │  │
             │  ├──► AwaitingHumanAuth (MFA/CAPTCHA) ──► Executing
             │  │
             │  ├──► Paused (משתמש/Take Control) ──► Executing / Cancelled
             │  │
             │  ├──► Blocked (ביטחון נמוך/שגיאה לא ניתנת להתאוששות) ──► AwaitingClarification
             │  │
             ▼  ▼
      ReadyForApproval ──► AwaitingApproval ──► (Approved) ──► FinalizingExecution ──► Completed
                                 │
                                 ├──► (Rejected/Partial) ──► Executing (תיקון) / Cancelled
                                 │
                                 └──► (RequestMoreCheck) ──► Executing (בדיקה נוספת בלבד, ללא פעולה סופית)

כל מצב ──► Cancelled (בכל שלב, אם ניתן לביטול בטוח)
כל מצב ──► Failed (שגיאה בלתי ניתנת להתאוששות, נשמר Checkpoint אחרון + Evidence)
```

הבחנה קריטית: **Executing** מבצע רק פעולות שאינן דורשות אישור (קריאה, ניתוח, חישוב, הכנת טיוטה - ר' רשימה במפרט המקור). שום מעבר לא מוביל מ-Executing ישירות ל-Completed בלי לעבור דרך AwaitingApproval אם קיימת ולו פעולה אחת בלתי הפיכה בתוכנית.

## 3. תת-State Machine לכל צעד (Step-level, בתוך Executing)

```
StepPending ──► Locating (מאתר מסך/שדה - ר' סעיף 5) ──► Acting ──► Verifying
                                                                       │
                                          ┌────────────────────────────┤
                                          ▼                            ▼
                                   StepSucceeded              StepFailed ──► Recovery (סעיף 5)
```

כל מעבר ל-`StepSucceeded` יוצר **Checkpoint** (ר' סעיף 4) לפני שהצעד הבא מתחיל.

## 4. Checkpoint - מה נשמר

בכל Checkpoint (ב-Supabase, ר' `05-DATA-MODEL.md` טבלת `workflow_step`):
- מזהה Run + מספר סידורי של הצעד.
- State המלא הנדרש להמשך (תוצאות הצעדים הקודמים הרלוונטיות להחלטה הבאה).
- Evidence שנאסף (הפניה, לא את הקובץ עצמו בטבלה).
- Confidence שדווח על ידי הצעד.
- Hash של ה-Tool Call המדויק שבוצע (לאימות Idempotency בהרצה חוזרת).

**Resume**: הרצה מחדש מתחילה מה-Checkpoint האחרון, בודקת (`compareBalances`/`inspectApplicationState`) שהמצב בפועל עדיין תואם למה שה-Checkpoint מניח, ורק אז ממשיכה. אם לא תואם - Blocked, לא ניחוש.

**Idempotency**: לפני כל פעולת כתיבה (אפילו טיוטה) הסוכן בודק אם התוצאה המבוקשת כבר קיימת (למשל פקודת יומן זהה כבר הוכנה) לפי Hash של הפעולה+קלט, כדי שהרצה כפולה לא תיצור כפילויות.

## 5. Recovery Strategy (מהמפרט המקורי, מחייב)

כאשר כפתור/שדה לא נמצא:

1. נסה Accessibility Tree (UIA).
2. נסה מזהה סמנטי (Selector יציב שהוגדר ב-Connector).
3. נסה OCR/Vision (Fallback בלבד).
4. בדוק אם המסך השתנה (השווה ל-`knownScreens` - אולי דיאלוג/עדכון גרסה).
5. **לעולם אל תלחץ לפי קואורדינטות בלבד ללא אימות.**
6. אם רמת הביטחון עדיין נמוכה מסף מוגדר - עצור (`Blocked`).
7. הצג למשתמש את הבעיה + צילום המסך הרלוונטי (Evidence), עבור ל-`AwaitingClarification`.

## 6. סף ביטחון (Confidence Threshold) - מדיניות

- כל `ToolResult` נושא `confidence` (0-1).
- מתחת לסף לכל סוג פעולה (לקריאה - סף נמוך יותר מספיק; לפעולת כתיבה/חישוב - סף גבוה) הסוכן לא ממשיך אוטומטית.
- הסף המדויק לכל סוג Tool ייקבע אמפירית מול תוכנת ה-Demo ב-MVP ולא מנוחש כאן (ר' שאלה פתוחה ב-07).

## 7. מצב `AwaitingHumanAuth` (MFA/CAPTCHA)

Local Agent מזהה שהתוכנה מבקשת MFA/CAPTCHA (לא Tool רגיל שנכשל - סוג ידוע), עוצר את ה-Run במלואו (לא רק את הצעד), שולח התראה למשתמש, וממתין ל-Signal "השלמתי ידנית" לפני שהוא ממשיך בדיוק מאותה נקודה (לא מהתחלה).

## 8. עצירה/ביטול (Pause/Stop/Take Control)

- **Pause**: עוצר לפני הצעד הבא (לא באמצע פעולה פעילה), שומר Checkpoint, ניתן ל-Resume.
- **Take Control**: המשתמש משתלט על ה-Local Agent (Desktop/דפדפן) לביצוע ידני; הסוכן עובר ל-`Paused` ומחכה ל"החזר שליטה", ואז מריץ `inspectApplicationState` לפני שהוא ממשיך (לא מניח שהמצב לא השתנה).
- **Cancel**: מבוטל רק אם עדיין לא בוצעה פעולה בלתי הפיכה; אם כן - מוצג למשתמש מה כבר בוצע ולא ניתן לביטול, ומוצעת פעולת תיקון ידנית/Rollback אם קיימת.

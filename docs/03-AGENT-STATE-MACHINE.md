# Agent State Machine - Accountant AI Operator

> **עדכון (2026-09-23):** מסמך זה שוכתב במלואו. הלולאה בפועל (`apps/desktop/src/task-runner.ts`) הרבה יותר פשוטה מה-State Machine המפורט שתוכנן במקור (Draft/Planning/AwaitingClarification/ReadyForApproval/וכו') - זו לולאת-צעדים שטוחה אחת, לא מכונת-מצבים מרובדת. עקרונות ה-Resumability/Idempotency/Recovery מהתכנון המקורי נשמרו כמטרה, וחלקם **ממומשים בפועל בצורה פשוטה יותר** מהמתואר במקור - מפורט למטה. הגרסה הקודמת נשמרת בהיסטוריית ה-git לרפרנס.

## 1. העיקרון בפועל: לולאת-צעדים שטוחה, לא מכונת-מצבים מרובדת

אין `Draft`/`Planning`/`ReadyForApproval`/`FinalizingExecution` וכו' כמצבי-על נפרדים. יש **ריצה אחת** (`Run`) שעוברת בלולאה `for (step = 1; step <= MAX_STEPS=40; step++)`, כשבכל צעד מתבצע תמיד אותו רצף: צילום מסך → קריאה ל-AI → (אם צריך) עצירה לאישור/שאלה → ביצוע → checkpoint. אין הבחנה בין "שלב תכנון" ל"שלב ביצוע" - כל צעד הוא גם וגם, מוחלט מחדש ע"י ה-AI על סמך מה שהוא רואה באותו רגע.

## 2. מצבי ריצה בפועל (`RunRecord.status`)

```ts
type RunStatus = "in-progress" | "done" | "stopped" | "rejected" | "error" | "max-steps-reached";
```

```
in-progress ──(action:"done")──────────────► done
in-progress ──(עצירה ידנית מה-UI)──────────► stopped
in-progress ──(המשתמש דוחה פעולה שדרשה אישור)─► rejected
in-progress ──(executeAction זורק/כשל ברשת שלא ניתן ל-retry)─► error
in-progress ──(step > MAX_STEPS)───────────► max-steps-reached
```

זהו כל מרחב המצבים בפועל - אין `AwaitingHumanAuth` (MFA/CAPTCHA) כמצב ייעודי, אין `Blocked` נפרד, אין `Paused`/`Take Control` כמצבים פורמליים. תרחישים כאלה מטופלים היום דרך `action:"ask"` הכללי (ר' סעיף 4) או עצירה ידנית (`stopped`) - לא מצב ייעודי לכל אחד.

## 3. תת-לולאה לכל צעד (בתוך `in-progress`)

```
captureScreenshot() ──► requestNextActionWithRetry() ──► [ask? / requiresApproval? עוצר וממתין] ──► executeAction() ──► checkpoint()
```

- `requestNextActionWithRetry` (ר' `01-ARCHITECTURE.md` §3) מנסה שוב עד `MAX_AI_RETRIES=2` פעמים, `AI_RETRY_DELAY_MS=1500`, **רק** על שגיאות חולפות (רשת/429/5xx) - שגיאת מפתח API (400/401) נכשלת מיד בלי retry.
- אין תת-State Machine נפרדת ל-`Locating`/`Acting`/`Verifying` - `executeAction` פשוט מבצע את הפעולה (קליק/הקלדה/מקש/גלילה) בלי שלב "אימות" נפרד אחריה; ה"אימות" היחיד שקיים הוא שהצעד **הבא** בלולאה מתחיל בצילום מסך חדש, שה-AI עצמו קורא ומחליט על סמכו אם הפעולה הקודמת הצליחה.

## 4. Checkpoint - מה נשמר בפועל, ומתי

בכל צעד שמסתיים בהצלחה (`outcome:"executed"`), נקראת `checkpoint()` שקוראת ל-`run-history.saveRun(...)` - כותבת את כל ה-`RunRecord` (כולל כל ה-`steps` עד כה) לקובץ JSON יחיד באופן **upsert** (לא append) - ר' `05-DATA-MODEL.md` §3 למבנה המדויק. אין Hash של ה-Tool Call לצורך Idempotency check - הקובץ כולו נכתב מחדש בכל checkpoint, אין מנגנון ייעודי לזהות "פעולה כפולה" מעבר לכך שכל `RunStepRecord` כבר מתועד עם מספר סידורי.

## 5. Resume - מה ממומש בפועל, ומה לא

**מה שכן קיים בפועל:** `findIncompleteRun(connectorId)` (`run-history.ts`) מוצא ריצה שנשארה `in-progress` - סימן שהאפליקציה נסגרה/קרסה באמצע. `main.ts` מציע למשתמש להמשיך אותה (`resumeFrom`), ו-`task-runner.ts` ממשיך מהצעד הבא בלי לחזור על צעדים שכבר תועדו כ-`executed`.

**מה שאין:** אין בדיקה אוטומטית שהמצב בפועל בתוכנה עדיין תואם למה שה-Checkpoint האחרון מניח (`compareBalances`/`inspectApplicationState` מהתכנון המקורי לא קיימים) - ה-Resume פשוט ממשיך לצלם ולשאול את ה-AI מחדש מהמסך הנוכחי, וה-AI עצמו (על סמך ההיסטוריה שמוזנת לו, עד 20 צעדים אחרונים - ר' `04-TOOL-REGISTRY.md` §5) מחליט מה לעשות אם משהו לא תואם. זו הגנה חלשה יותר מהמתוכנן במקור, אבל קיימת בפועל.

## 6. סף ביטחון (Confidence Threshold)

`CONFIDENCE_THRESHOLD = 0.95` ב-`ai/grok.ts` - סף יחיד, לא מדורג לפי סוג פעולה כמו שתוכנן במקור. זו הנחיה ב-system prompt למודל עצמו ("אם הביטחון שלך נמוך מ-0.95, בחר `ask` במקום לנחש") - **לא בדיקה דטרמיניסטית בקוד** שחוסמת פעולה אם `confidence` המוחזר נמוך. פירוט מלא ב-`04-TOOL-REGISTRY.md` §2 ו-§4.

## 7. `ask` - התחליף בפועל ל-`AwaitingHumanAuth`/`AwaitingClarification`

אין מצב ייעודי ל-MFA/CAPTCHA או לחוסר-ודאות כללי. כשה-AI נתקל בכל אחד מהמצבים האלה, הוא בוחר `action:"ask"` עם שאלה חופשית בטקסט. הלולאה עוצרת (`onUpdate("awaiting-answer")`), ממתינה לתשובת המשתמש (`aiop:answer-question` IPC), ומוסיפה את התשובה להיסטוריה לפני שהיא ממשיכה מהצעד הבא - **מאותו מקום בדיוק**, לא מהתחלה. זה מכסה בפועל גם MFA/CAPTCHA וגם חוסר-ודאות כללי, בלי הבחנה בין הסוגים.

## 8. עצירה/ביטול בפועל

- **עצירה ידנית**: `shouldStop()` נבדק בתחילת כל צעד - עוצר **לפני** הצעד הבא, לא באמצע פעולה בודדת שכבר החלה (קליק/הקלדה). סטטוס הופך ל-`stopped`.
- **דחיית אישור**: אם המשתמש דוחה פעולה שדרשה אישור, הריצה מסתיימת מיד עם `status:"rejected"` - **אין** המשך אוטומטי לתיקון/ניסיון חלופי; זה סוף הריצה, לא מעבר למצב ביניים.
- **אין "Take Control"** (השתלטות ידנית על העכבר/מקלדת תוך כדי ריצה) כמצב פורמלי - המשתמש יכול לעצור את הריצה ואז לפעול ידנית בתוכנה, אבל אין מנגנון ייעודי ב-state machine לכך.

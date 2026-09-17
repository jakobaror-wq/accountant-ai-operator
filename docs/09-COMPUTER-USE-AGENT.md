# AI Computer Use Agent (v1)

## מה זה

מסך `/agent` (רק בתוך `apps/desktop`) - נותנים משימה בשפה חופשית, וה-AI (Grok, xAI) מפעיל את המחשב בעצמו: מצלם מסך, מחליט מה הפעולה הבאה (קליק/הקלדה/מקש/גלילה), מבצע אותה בפועל, וחוזר על זה עד שהוא מדווח שהמשימה הושלמה (או עד למגבלת 40 צעדים).

זו **לא** עדיין המימוש המלא של ה-Tool Registry/State Machine מ-`01-ARCHITECTURE.md`/`03-AGENT-STATE-MACHINE.md` - אין עדיין Approval Package, אין הבחנה בין פעולות "בטוחות" לפעולות שדורשות אישור, אין Checkpoint/Resume. זו שכבת ה-Computer Use הגולמית (צילום → החלטה → ביצוע) שהשכבות האלה יבנו עליה בהמשך.

## איך זה עובד

```
apps/web/app/agent/page.tsx (UI - טופס משימה, לוג חי, צילום מסך אחרון)
        │  window.electronAPI.runTask(task)
        ▼
apps/desktop/src/main.ts  (IPC handler aiop:run-task)
        │
        ▼
apps/desktop/src/task-runner.ts  (הלולאה: עד 40 צעדים)
        │
        ├─ captureScreenshot()      ─┐
        │   (desktopCapturer, Electron)│  apps/desktop/src/computer-use.ts
        ├─ executeAction(action)    ─┘
        │
        └─ requestNextAction(...)  →  apps/desktop/src/ai/grok.ts
                                        POST https://api.x.ai/v1/chat/completions
                                        (מודל עם תמיכת Vision, ר' DEFAULT_GROK_MODEL)
```

כל עדכון בלולאה (צילום, פעולה+נימוק, שגיאה, סיום) נשלח ל-Renderer דרך `webContents.send("aiop:task-update", ...)` ומוצג חי במסך.

## אבטחה

- **מפתח ה-API נשמר רק מקומית**, מוצפן דרך `safeStorage` של Electron (על Windows - DPAPI) - לא בענן, לא בקוד, לא ב-Supabase. אם ההצפנה לא זמינה במערכת (מצב נדיר, כמעט לא קורה על Windows אמיתי) - השמירה נכשלת בבירור במקום להיכשל בשקט (`isSecureStorageAvailable()` ב-`settings.ts`).
- **צילום המסך חייב להישלח לספק ה-AI** (xAI) כדי שהמודל "יראה" אותו - זו לא בחירה טכנית, זו הדרך היחידה שמודל Vision מבוסס-ענן עובד. שקוף למשתמש (מוסבר גם ב-UI).
- החלון טוען רק את האתר שלנו (`will-navigate`/`setWindowOpenHandler` מגבילים ל-origin אחד, ר' `main.ts`) - כך שרק קוד מהאתר שלנו יכול לקרוא ל-IPC הזה, לא כל דף חיצוני.
- **מגבלת 40 צעדים** לכל משימה - מונע לולאה אינסופית/עלות API בלתי מבוקרת.
- אין עדיין הבחנה בין "פעולת קריאה" ל"פעולה בלתי הפיכה" - ה-AI יכול ללחוץ על כל דבר, כולל כפתורי שמירה/מחיקה/שליחה. **זו מגבלת v1 מודעת, לא פספוס** - הבחנה כזו היא בדיוק מה ש-approval-engine (מהארכיטקטורה המקורית) אמור לספק, וטרם נבנה. עד אז - להשתמש בזהירות, ולהעדיף משימות שאינן הרסניות.

## מגבלות ידועות ב-v1

- **לא נבדק Windows אמיתי מקצה לקצה** - נבדק בסביבת פיתוח Linux (Xvfb): צילום מסך עובד (`desktopCapturer` מחזיר PNG תקין בגודל המסך הנכון), IPC ואחסון מפתח מוצפן עובדים; קריאת הרשת בפועל ל-xAI לא נבדקה (חסומה ברמת ה-Sandbox של הפיתוח) - הבדיקה האמיתית תהיה אצל המשתמש, על מחשב Windows רגיל.
- **ספריית `@nut-tree-fork/nut-js`** (קליק/הקלדה/גלילה) מכילה קוד Native - `electron-builder` אמור לבנות אותה מחדש אוטומטית לכל פלטפורמה (`@electron/rebuild`), אבל זה שלב ראשון שמשתמש בה בפועל על Windows - ייתכן שיידרש תיקון אם ה-build ב-CI ייכשל.
- **שם המודל** (`DEFAULT_GROK_MODEL` ב-`apps/desktop/src/ai/grok.ts`) נקבע לפי המידע העדכני ביותר שהיה זמין; אם xAI משנים שמות מודלים, זה המקום היחיד לעדכן.
- אין עדיין "עצור בבטחה" באמצע פעולה בודדת - `עצור` עוצר לפני הצעד הבא, לא באמצע קליק/הקלדה שכבר החלו.

# MVP Plan - Accountant AI Operator

## 1. רשימת רכיבי MVP (מהמפרט המקורי - מלא, ללא צמצום)

1. אפליקציה מרכזית (`apps/web`).
2. צ'אט AI.
3. סוכן Windows מקומי (`apps/local-agent`).
4. כספת Credentials מקומית (DPAPI/Credential Manager).
5. Computer Use Framework (`packages/computer-use`).
6. Training Mode.
7. Workflow Engine.
8. מערכת אישורים (approval-engine + Approval Inbox).
9. Audit Trail.
10. **תוכנת Demo מקומית** שמדמה מערכת חשבונאית (ר' סעיף 2).
11. Connector אמיתי אחד - **רק לאחר** קבלת גישה מורשית ותיעוד למערכת הרלוונטית (לא בהתחלת MVP).
12. חבילת אישור מלאה (Approval Package).

**במפורש לא ב-MVP:** יותר מ-Connector אמיתי אחד, ריבוי-משרדים בסקייל, מובייל native, כל אינטגרציה שנייה/שלישית לתוכנת חשבונאות.

## 2. תוכנת Demo - מפרט

תוכנה מקומית (Web app קטן, כדי ש-Playwright/UIA שניהם ניתנים לבדיקה מולה) המדמה בכוונה תוכנת חשבונאות אמיתית, כולל **גרסה שנייה עם שינוי ממשק קטן** (למשל שינוי מיקום כפתור/שינוי label) כדי לבדוק Recovery בפועל.

מסכים נדרשים:
- Login (כולל אפשרות לדמות MFA מדומה, לבדיקת `AwaitingHumanAuth`).
- בחירת חברה/לקוח.
- מאזן בוחן (טבלת חשבונות, חובה/זכות, כולל אפשרות להזריק חוסר איזון מכוון לבדיקת בדיקות סבירות).
- רכוש קבוע (רשימת נכסים לצורך `calculateDepreciation`).
- שכר (נתוני שכר בסיסיים).
- פקודות יומן (טיוטה + מסך "רישום סופי" נפרד - נקודת ה-Approval).
- הפקת דוח (ייצוא PDF/קובץ - יעד ל-`exportReport`).

## 3. מה חייבים להוכיח מול ה-Demo (קריטריוני קבלה ל-MVP)

| # | יכולת | איך נבדק |
|---|---|---|
| 1 | ללמוד תהליך | משתמש מדגים "חשב פחת" ב-Demo ב-Training Mode; המערכת מציעה Workflow, המשתמש מתקן ומאשר |
| 2 | להריץ אותו מחדש | אותו Workflow רץ עבור "לקוח" אחר ב-Demo בלי הדרכה נוספת |
| 3 | להתמודד עם שינוי קטן בממשק | Workflow רץ מול גרסה 2 של ה-Demo (כפתור הוזז) ומצליח דרך Recovery Strategy (לא נכשל שקט, לא לוחץ עיוור) |
| 4 | לזהות חריגה | הזרקת חוסר איזון במאזן הבוחן מזוהה ומדווחת כ-`exception`, לא מוסתרת |
| 5 | להכין פעולות | פקודות יומן מוכנות כטיוטה בלבד, לא נרשמות |
| 6 | להסביר החלטות | Decision Log מלא לכל שלב, כולל רמת ביטחון |
| 7 | להמתין לאישור | Run עוצר לפני `executeApprovedActions` ומציג Approval Package |
| 8 | לבצע רק פעולות מאושרות | אם המשתמש מאשר חלקית, רק הפריטים המאושרים מבוצעים; היתר נשארים כטיוטה |

MVP נחשב **תקין** רק אם כל 8 השורות עוברות ב-Demo. שום Connector אמיתי לא ייחשב הצלחה תחליפית לבדיקה מול ה-Demo.

## 4. שלבי הפיתוח (מהמפרט המקורי, לרפרנס)

- **שלב 0** (הנוכחי): PRD, Architecture, Threat Model, State Machine, Tool Registry, Data Model, תוכנית MVP, הנחות/חסמים/שאלות. **הושלם עם מסמך זה.**
- **שלב 1**: הקמת Monorepo, `apps/web` בסיסי, Supabase Schema+RLS, תוכנת Demo.
- **שלב 2**: `apps/local-agent`, Device Pairing, Credential Vault, Computer Use Tools.
- **שלב 3**: Training Mode, Skill Format, Workflow Replay, Validation+Recovery.
- **שלב 4**: AI Orchestrator, Decision Log, Approval Package, Selective Approval.
- **שלב 5**: הרצת end-to-end מול ה-Demo, בדיקות, תוצאות, ואז - ורק אז - קבלת גישה/תיעוד ל-Connector אמיתי ראשון.

**החלטת המשך:** בהתאם להנחיה - עוצרים כאן בשלב 0. שלב 1 (הקמת קוד בפועל) מתחיל רק באישור מפורש נפרד.

# Tool Registry - Accountant AI Operator

## 1. עיקרון

ה-AI Orchestrator **אינו** מבצע לחיצות ישירות. הוא קורא אך ורק ל-Tools מוגדרים, כל אחד עם סכימת Zod לקלט ולפלט. השכבה הדטרמיניסטית (approval-engine) קובעת אילו Tools דורשים Approval Token תקף לפני ביצוע - זו לא החלטה של ה-AI.

## 2. מעטפת תוצאה אחידה (ToolResult) - חובה לכל Tool

```ts
interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  evidence: EvidenceRef[];        // הפניות ל-screenshot/לוג, לא תוכן גולמי
  screenshotReference?: string;   // מזהה קובץ מקומי/Storage, לא base64 בתוך ה-payload
  warnings: string[];
  errors: ToolError[];
  confidence: number;             // 0-1
  nextPossibleActions: string[];  // שמות Tools הגיוניים להצעה הבאה
}

interface ToolError { code: string; message: string; recoverable: boolean }
interface EvidenceRef { kind: "screenshot" | "log" | "file"; ref: string; capturedAt: string }
```

## 3. רשימת Tools (מהמפרט המקורי) - סטטוס: **הגדרת ממשק בלבד, ללא מימוש בשלב 0**

| Tool | קלט (תמצית) | פלט (תמצית) | דורש Approval? |
|---|---|---|---|
| `inspectApplicationState` | connectorId, windowHandle? | screenName, fields[], confidence | לא |
| `openApplication` | connectorId, credentialsRef (לא הסיסמה עצמה) | processHandle, success | לא (אך תלוי ב-authenticateApplication) |
| `authenticateApplication` | connectorId, credentialsRef | `authenticationSuccessful: boolean` בלבד - **לעולם לא הסיסמה** | לא |
| `selectClient` | connectorId, clientExternalId | selectedClientName, confirmed | לא |
| `readTrialBalance` | connectorId, clientId, taxYear | accounts[], totals, balanced: boolean | לא |
| `exportReport` | connectorId, reportType, params | fileRef | לא |
| `importFile` | connectorId, fileRef, targetScreen | importSummary, rowsProcessed | לא (ייבוא לטיוטה) |
| `calculateDepreciation` | assetsData, method, taxYear | depreciationEntries[], totalByAsset | לא (חישוב בלבד) |
| `prepareJournalEntries` | sourceData, mappingRules | draftEntries[] (טיוטה בלבד) | לא (טיוטה, לא רישום) |
| `compareBalances` | sourceA, sourceB, tolerance | diffs[], withinTolerance: boolean | לא |
| `populateFinancialReport` | draftEntries, reportTemplate | populatedReportRef (טיוטה) | לא |
| `createApprovalPackage` | runId | approvalPackageRef (ר' `05-DATA-MODEL.md`) | לא (יצירת המסמך עצמו) |
| `executeApprovedActions` | approvalPackageId, approvalTokenSignature | executionResults[], auditEntryRefs[] | **כן - חובה** |

## 4. הרחבות נדרשות מעבר לרשימת המקור (זוהו תוך תכנון, מוצעות לדיון)

| Tool מוצע | למה נדרש |
|---|---|
| `detectSoftwareVersion` | לזהות שינוי גרסה לפני שמפעילים Recovery מיותר |
| `requestClarification` | ערוץ מפורש לעצירה עם שאלה למשתמש (State Machine, `AwaitingClarification`) - לא רק "כישלון" |
| `recordDecision` | כתיבה מפורשת ל-Decision Log (שאלה/נתונים/חלופות/בחירה/נימוק/ביטחון) - נפרד מ-Tool עסקי, כדי שכל החלטה תתועד גם אם ה-Tool עצמו הצליח |
| `rollbackDraft` | ביטול טיוטה שהוכנה (לפני רישום סופי) בלי לגעת בנתונים אמיתיים בתוכנה |
| `pairDevice` / `revokeDevice` | ניהול Device Pairing מפורש כ-Tool (לא רק תשתית) |

## 5. אכיפת אישור (Approval Enforcement) - איפה זה חי בפועל

`approvalEngine.canExecute(toolName, context): boolean` נבדק **בתוך** ה-Tool Runner עצמו לפני קריאה בפועל ל-Local Agent - שכבה נפרדת מה-Orchestrator, כך שגם פרומפט/הזיה שגויה של ה-AI לא יכולה לעקוף את הדרישה לאישור על `executeApprovedActions` ופעולות בלתי הפיכות עתידיות דומות.

## 6. סטטוס מימוש

זהו Registry של **חוזה (contract)** בלבד לשלב 0. אין עדיין מימוש Zod בפועל, ואין Connector אמיתי מאחורי אף Tool. המימוש הראשון (שלב 2-3 בתוכנית) ירוץ מול תוכנת ה-Demo (ר' `06-MVP-PLAN.md`), לא מול תוכנה אמיתית.

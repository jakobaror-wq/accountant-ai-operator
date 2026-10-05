/**
 * "קרנל בטיחות" דטרמיניסטי - Gate 1 (עדכון 2026-10-05, לפי תוכנית-עבודה
 * חיצונית). עד עכשיו `requiresApproval` נקבע **ישירות ע"י המודל** - שיפוט
 * AI בלבד, בלי שכבת-קוד שבודקת. זה היה פער בטיחות אמיתי: אם המודל "טועה"
 * ומחזיר `requiresApproval:false` על פעולה שבאמת מסוכנת, שום דבר בקוד לא
 * היה תופס את זה (ר' docs/02-THREAT-MODEL.md §4 "Elevation of Privilege" -
 * ההיסטוריה המלאה של הפער).
 *
 * התיקון: המודל כבר **לא** קובע ישירות "האם צריך אישור" - הוא מסווג
 * **לאיזו קטגוריה** הפעולה שייכת (`riskClass`, אוצר-מילים סגור ב-type
 * system), וה-**קוד כאן**, לא המודל, קובע באופן דטרמיניסטי אילו קטגוריות
 * דורשות אישור אנושי - דרך טבלה קבועה שהמודל לא יכול להשפיע עליה בשום דרך,
 * גם אם ינסה (ר' ai/grok.ts - אין עוד שדה `requiresApproval` שהמודל יכול
 * להחזיר בכלל).
 *
 * **מגבלה שנשארת ביודעין**: כל עוד המערכת Vision-בלבד (לא UIA - ר' "Gate 2"
 * בתוכנית-העבודה), הסיווג עדיין תלוי בכך שהמודל יזהה נכון מה הוא **רואה**
 * ויתאר אותו נכון כ-riskClass. זו עדיין לא הגנה סמנטית אמיתית (לדעת בוודאות
 * מה נמצא בקואורדינטה X,Y). אבל זה כבר לא "המודל קובע את הגבול הבטיחותי של
 * עצמו" - זה "המודל מתאר מה הוא רואה, הקוד קובע את המדיניות" - שלב ביניים
 * אמיתי, לא תחליף מלא ל-Gate 2.
 */

export type RiskClass =
  | "read-only"
  | "navigation"
  | "reversible-edit"
  | "external-side-effect"
  | "final-commit"
  | "unknown";

export const ALL_RISK_CLASSES: readonly RiskClass[] = [
  "read-only",
  "navigation",
  "reversible-edit",
  "external-side-effect",
  "final-commit",
  "unknown",
];

/**
 * טבלת-המדיניות עצמה - **קוד, לא פרומפט**. רק הקטגוריות ברשימה הזו מותרות
 * ללא אישור אנושי; כל קטגוריה אחרת (כולל `unknown`) דורשת אישור כברירת
 * מחדל (fail-closed) - אין צורך ברשימה נפרדת ל"מה כן דורש אישור".
 *
 * **שינוי מדיניות לעומת הגרסה הקודמת של המערכת**: ייצוא/הדפסת קובץ (היה
 * "חופשי" עד עכשיו ב-system prompt הישן) מסווג כעת כ-external-side-effect
 * ולכן דורש אישור. ייצוא יוצר קובץ אמיתי על הדיסק שעלול להכיל נתוני לקוח -
 * זו פעולה עם השפעה אמיתית מחוץ ל"צפייה הפנימית בתוכנה", ושווה את חיכוך-
 * האישור הנוסף למען הביטחון. זו החלטת-עיצוב מכוונת, לא תקלה.
 */
const AUTO_APPROVE_RISK_CLASSES: ReadonlySet<RiskClass> = new Set<RiskClass>([
  "read-only",
  "navigation",
  "reversible-edit",
]);

export function requiresHumanApproval(riskClass: RiskClass): boolean {
  return !AUTO_APPROVE_RISK_CLASSES.has(riskClass);
}

export function isValidRiskClass(value: unknown): value is RiskClass {
  return typeof value === "string" && (ALL_RISK_CLASSES as readonly string[]).includes(value);
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
}

/**
 * ארבע התוכנות מתוך ה-PRD. כולן תוכנות שולחן-עבודה מקומיות - החיבור אליהן
 * הוא תמיד לוקאלי (בחירת קובץ ה-exe פעם אחת בתוך אפליקציית שולחן העבודה),
 * אין עוד אופציה לחיבור דרך דפדפן/קישור אינטרנט.
 */
export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "hashavshevet",
    name: "חשבשבת",
    description: "הנהלת חשבונות, פקודות יומן, מאזנים ודוחות",
  },
  {
    id: "hisulit",
    name: "חיסולית",
    description: "רכוש קבוע, פחת ורווחי הון",
  },
  {
    id: "shikulit",
    name: "שיקלולית",
    description: "שכר והפרשות סוציאליות",
  },
  {
    id: "konto",
    name: "קונטו",
    description: "עריכת דוחות כספיים",
  },
  {
    id: "dokka",
    name: "Dokka",
    description: "עיבוד מסמכים וחשבוניות",
  },
];

export function getConnectorById(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

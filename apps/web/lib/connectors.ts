export type ConnectionType = "browser" | "desktop";

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
}

/**
 * ארבע התוכנות מתוך ה-PRD. לא ידוע עדיין אם כל אחת היא Web או Desktop -
 * זו החלטה שהמשרד קובע בעצמו במסך ההגדרות של כל חיבור (ר' docs/07-ASSUMPTIONS-OPEN-QUESTIONS.md).
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
];

export function getConnectorById(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

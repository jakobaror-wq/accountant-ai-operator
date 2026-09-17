/**
 * ה-URI Scheme שה-Local Launcher (apps/web/public/local-launcher) נרשם עליו ב-Windows.
 * חשוב: ה-URI מכיל רק connectorId, לעולם לא נתיב קובץ - הנתיב האמיתי חי אך ורק
 * בקובץ config.json המקומי אצל הלקוח (Whitelist), כדי שאף אתר לא יוכל לגרום
 * להפעלת תוכנה שרירותית דרך הקישור. ר' docs/02-THREAT-MODEL.md.
 */
export const LOCAL_LAUNCHER_PROTOCOL = "accountant-ai-operator";

export function buildLaunchUri(connectorId: string): string {
  return `${LOCAL_LAUNCHER_PROTOCOL}://launch/${connectorId}`;
}

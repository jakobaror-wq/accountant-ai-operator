/**
 * לוגיקת ה-retry לטעינה מחדש של חלון האפליקציה כשהטעינה הראשונית מ-Vercel
 * נכשלת (בדרך כלל כי הרשת עדיין לא מוכנה מיד אחרי הפעלת/יקיצת המחשב) -
 * מופרדת מ-main.ts כדי שאפשר לבדוק אותה ישירות, בלי להריץ את כל תהליך
 * ה-bootstrap של האפליקציה (חלון אמיתי, IPC handlers וכו').
 */
export const RELOAD_BASE_DELAY_MS = 2000;
export const RELOAD_MAX_DELAY_MS = 30000;

/** ERR_ABORTED (-3) קורה גם בניווטים תקינים (כמו יציאה ל-shell.openExternal) - לא כשל אמיתי. */
export function isRetryableLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== -3;
}

/** גדילה מעריכית עד תקרה, כדי לא להציף ניסיונות כשהרשת באמת מושבתת לזמן ארוך. */
export function nextReloadDelay(attempt: number): number {
  return Math.min(RELOAD_BASE_DELAY_MS * 2 ** attempt, RELOAD_MAX_DELAY_MS);
}

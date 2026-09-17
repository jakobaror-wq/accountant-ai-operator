/**
 * קישור הורדה לאפליקציית שולחן העבודה - נשאר תמיד באותה כתובת בדומיין שלנו.
 * מאחוריו מתבצע redirect (ר' app/api/download/desktop/route.ts) שמשיג בזמן
 * אמת את ה-Release העדכני מ-GitHub (ר' .github/workflows/build-desktop.yml)
 * ומצביע על קובץ ה-.exe שבו - כך שהקישור הזה לעולם לא שובר, גם אם שם קובץ
 * ה-build או מספר הגרסה משתנים.
 */
export const DESKTOP_APP_DOWNLOAD_URL = "/api/download/desktop";

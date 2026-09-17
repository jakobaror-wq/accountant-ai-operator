/**
 * קישור הורדה לאפליקציית שולחן העבודה - נשאר תמיד באותה כתובת בדומיין שלנו.
 * מאחוריו מתבצע redirect (ר' app/api/download/desktop/route.ts) לקובץ ה-.exe
 * העדכני ביותר ב-Supabase Storage, שם ה-CI מעלה build חדש בכל push (ר'
 * .github/workflows/build-desktop.yml) לנתיב קבוע - כך שהקישור הזה לעולם לא
 * שובר, גם אם שם קובץ ה-build משתנה.
 */
export const DESKTOP_APP_DOWNLOAD_URL = "/api/download/desktop";

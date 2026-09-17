/**
 * ערכי ברירת מחדל לפרויקט ה-Supabase של accountant-ai-operator.
 *
 * אלו אינם סודות: ה-anon/publishable key מיועד במפורש להיחשף בצד הלקוח
 * (ההגנה האמיתית היא ה-RLS שהוגדר על כל טבלה, לא הסתרת המפתח), וה-URL
 * הוא כתובת ה-API הציבורית של הפרויקט. משמשים כ-fallback כשמשתני הסביבה
 * לא הוגדרו (למשל אם עדיין לא נוספו ל-Environment Variables ב-Vercel) -
 * עדיין אפשר לדרוס אותם עם NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (לדוגמה כדי להצביע על פרויקט Supabase אחר בפיתוח מקומי).
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sngjrtuhpuclkbalduzs.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_FlEiYeqQCvU7QIu2FSXuPQ_cJ1vfD4k";

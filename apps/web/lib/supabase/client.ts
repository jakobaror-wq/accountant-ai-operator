import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

/**
 * flowType: "implicit" - במכוון, לא PKCE (ברירת המחדל).
 *
 * PKCE דורש שה-code_verifier (שנשמר בעת קריאה ל-signInWithOtp) יהיה זמין
 * שוב באותו דפדפן כשלוחצים על קישור ההתחברות במייל. בפועל קישורי מייל
 * נפתחים המון פעמים בדפדפן/מכשיר/אפליקציית מייל אחרת מזו שבה מולא הטופס -
 * ואז ה-exchange נכשל בשקט (אומת ב-DB: auth_code הונפק, email אושר,
 * אבל אף session לא נוצר - auth.flow_state נשאר לא מנוצל).
 * ב-implicit flow, ה-Access/Refresh Token מגיעים ישירות ב-URL fragment
 * בעת ה-redirect מ-Supabase, בלי תלות בדפדפן/מכשיר שהתחיל את ההתחברות.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
    },
  });
}

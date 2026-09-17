import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

/**
 * v1.2: אין יותר התחברות/session - כל בקשה משתמשת ב-anon key ישירות
 * (client או server, אין הבדל, אין cookies לסנכרן). ה-RLS על
 * connector_configs פתוח בכוונה (ר' migration remove_auth_gate_use_shared_office
 * ו-docs/08-V1-CONNECTION-MODEL.md) - אין שם נתון רגיש, רק type/url.
 */
export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

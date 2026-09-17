import { createClient } from "./supabase/server";

/**
 * v1: כל משתמש שייך למשרד יחיד שנוצר לו אוטומטית בהרשמה (ר' migration
 * init_offices_and_connector_configs). לוקח את הראשון - Multi-office אמיתי
 * הוא שיפור עתידי, לא ב-v1.
 */
export async function getCurrentOfficeId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("office_members")
    .select("office_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return data?.office_id ?? null;
}

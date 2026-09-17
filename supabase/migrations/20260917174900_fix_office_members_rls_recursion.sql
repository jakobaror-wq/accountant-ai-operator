-- תיקון באג אמיתי: הפוליסה המקורית על office_members שאלה את עצמה
-- (office_members בתוך policy של office_members) וגרמה ל-infinite recursion -
-- כל query שנגע ב-office_members, כולל דרך policies של טבלאות אחרות, היה נכשל.
-- אומת ותוקן ב-2026-09-17 דרך סימולציית RLS עם שני משתמשי בדיקה (ר' commit).
--
-- הפתרון הסטנדרטי: פונקציית SECURITY DEFINER שבודקת חברות; בעלות הטבלה (postgres)
-- עוקפת RLS כברירת מחדל, כך שאין רקורסיה כשהפונקציה שואלת את office_members בעצמה.

create or replace function public.is_office_member(target_office_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.office_members m
    where m.office_id = target_office_id and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_office_member(uuid) from public, anon;
grant execute on function public.is_office_member(uuid) to authenticated;

drop policy if exists "office_members_select_own_rows" on public.office_members;
create policy "office_members_select_own_rows" on public.office_members
  for select using (public.is_office_member(office_members.office_id));

drop policy if exists "office_members_select_own_offices" on public.offices;
create policy "offices_select_own" on public.offices
  for select using (public.is_office_member(offices.id));

drop policy if exists "connector_configs_select_own_office" on public.connector_configs;
create policy "connector_configs_select_own_office" on public.connector_configs
  for select using (public.is_office_member(connector_configs.office_id));

drop policy if exists "connector_configs_insert_own_office" on public.connector_configs;
create policy "connector_configs_insert_own_office" on public.connector_configs
  for insert with check (public.is_office_member(connector_configs.office_id));

drop policy if exists "connector_configs_update_own_office" on public.connector_configs;
create policy "connector_configs_update_own_office" on public.connector_configs
  for update using (public.is_office_member(connector_configs.office_id))
  with check (public.is_office_member(connector_configs.office_id));

drop policy if exists "connector_configs_delete_own_office" on public.connector_configs;
create policy "connector_configs_delete_own_office" on public.connector_configs
  for delete using (public.is_office_member(connector_configs.office_id));

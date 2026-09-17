-- הסרת דרישת ההתחברות (לבקשת המשתמש - חיכוך גבוה מדי בשלב הזה, אין עדיין נתונים
-- רגישים בטבלה הזו - רק type/url של חיבורים, ללא credentials). משרד יחיד קבוע,
-- נגיש בלי אימות. ר' docs/08-V1-CONNECTION-MODEL.md לתיעוד ההחלטה.

insert into public.offices (id, name)
values ('00000000-0000-0000-0000-000000000001', 'המשרד שלי')
on conflict (id) do nothing;

drop policy if exists "connector_configs_select_own_office" on public.connector_configs;
drop policy if exists "connector_configs_insert_own_office" on public.connector_configs;
drop policy if exists "connector_configs_update_own_office" on public.connector_configs;
drop policy if exists "connector_configs_delete_own_office" on public.connector_configs;

create policy "connector_configs_public_select" on public.connector_configs
  for select to anon, authenticated using (true);

create policy "connector_configs_public_insert" on public.connector_configs
  for insert to anon, authenticated with check (true);

create policy "connector_configs_public_update" on public.connector_configs
  for update to anon, authenticated using (true) with check (true);

create policy "connector_configs_public_delete" on public.connector_configs
  for delete to anon, authenticated using (true);

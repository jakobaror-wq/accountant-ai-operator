-- Accountant AI Operator - v1 schema
-- ר' docs/05-DATA-MODEL.md: office הוא גבול ה-RLS הראשי.

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.office_members (
  office_id uuid not null references public.offices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'accountant', 'bookkeeper', 'admin')),
  created_at timestamptz not null default now(),
  primary key (office_id, user_id)
);

create table if not exists public.connector_configs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  connector_id text not null,
  connection_type text check (connection_type in ('browser', 'desktop')),
  url text,
  updated_at timestamptz not null default now(),
  unique (office_id, connector_id)
);

alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.connector_configs enable row level security;

-- offices: חבר יכול לקרוא רק משרדים שהוא שייך אליהם
create policy "office_members_select_own_offices" on public.offices
  for select using (
    exists (select 1 from public.office_members m where m.office_id = offices.id and m.user_id = auth.uid())
  );

-- office_members: חבר יכול לראות את רשימת החברים של המשרדים שלו
-- הערה: הפוליסה הזו נמצאה כמכילה רקורסיה אינסופית (שואלת office_members מתוך policy
-- של office_members) - תוקנה במלואה ב-migration הבא (20260917174900).
create policy "office_members_select_own_rows" on public.office_members
  for select using (
    exists (
      select 1 from public.office_members m2
      where m2.office_id = office_members.office_id and m2.user_id = auth.uid()
    )
  );

-- connector_configs: קריאה/כתיבה רק לחברי המשרד הרלוונטי
create policy "connector_configs_select_own_office" on public.connector_configs
  for select using (
    exists (select 1 from public.office_members m where m.office_id = connector_configs.office_id and m.user_id = auth.uid())
  );

create policy "connector_configs_insert_own_office" on public.connector_configs
  for insert with check (
    exists (select 1 from public.office_members m where m.office_id = connector_configs.office_id and m.user_id = auth.uid())
  );

create policy "connector_configs_update_own_office" on public.connector_configs
  for update using (
    exists (select 1 from public.office_members m where m.office_id = connector_configs.office_id and m.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.office_members m where m.office_id = connector_configs.office_id and m.user_id = auth.uid())
  );

create policy "connector_configs_delete_own_office" on public.connector_configs
  for delete using (
    exists (select 1 from public.office_members m where m.office_id = connector_configs.office_id and m.user_id = auth.uid())
  );

-- בהרשמת משתמש חדש: יוצרים לו אוטומטית משרד יחיד (v1 - חבר בודד למשרד).
create or replace function public.handle_new_user_office()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_office_id uuid;
begin
  insert into public.offices (name) values ('המשרד שלי') returning id into new_office_id;
  insert into public.office_members (office_id, user_id, role) values (new_office_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_office();

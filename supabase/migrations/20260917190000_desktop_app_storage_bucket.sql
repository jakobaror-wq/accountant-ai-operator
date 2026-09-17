insert into storage.buckets (id, name, public, file_size_limit)
values ('desktop-app', 'desktop-app', true, 157286400)
on conflict (id) do update set public = true, file_size_limit = 157286400;

drop policy if exists "desktop_app_public_read" on storage.objects;
create policy "desktop_app_public_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'desktop-app');

drop policy if exists "desktop_app_public_upload" on storage.objects;
create policy "desktop_app_public_upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'desktop-app');

drop policy if exists "desktop_app_public_overwrite" on storage.objects;
create policy "desktop_app_public_overwrite" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'desktop-app') with check (bucket_id = 'desktop-app');

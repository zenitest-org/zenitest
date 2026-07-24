-- Create screenshots bucket in storage if it doesn't exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Create public read policy for screenshots bucket objects
create policy "Public Read Access for Screenshots"
  on storage.objects for select
  using (bucket_id = 'screenshots');

-- Create service role insert policy for screenshots bucket objects
create policy "Service Role Insert for Screenshots"
  on storage.objects for insert
  with check (bucket_id = 'screenshots');

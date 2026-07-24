-- 1. Helper function to generate API key with format zt-[AlphanumericString]
create or replace function public.generate_api_key()
returns text
language plpgsql
as $$
declare
  chars text := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := 'zt-';
  i integer;
begin
  for i in 1..32 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  end loop;
  return result;
end;
$$;

-- 2. Create public.users table linked to auth.users with ON DELETE CASCADE
create table public.users (
  id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  api_key text not null default public.generate_api_key(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint users_pkey primary key (id),
  constraint users_email_key unique (email),
  constraint users_api_key_key unique (api_key),
  constraint users_email_check check (
    (
      length(
        TRIM(
          both
          from
            email
        )
      ) > 0
    )
  ),
  constraint users_name_check check (
    (
      length(
        TRIM(
          both
          from
            name
        )
      ) > 0
    )
  )
) TABLESPACE pg_default;

-- Enable Row Level Security (no public/client policies; only service_role key has access)
alter table public.users enable row level security;

-- 3. Function & Trigger to automatically populate public.users when a user is created in auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  user_name text;
begin
  user_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(split_part(new.email, '@', 1)), ''),
    'User'
  );

  insert into public.users (id, email, name, api_key)
  values (
    new.id,
    new.email,
    user_name,
    public.generate_api_key()
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();

  return new;
end;
$$;

-- Trigger on auth.users insertion
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Function & Trigger to automatically delete from public.users when deleted from auth.users
create or replace function public.handle_user_delete()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.users where id = old.id;
  return old;
end;
$$;

-- Trigger on auth.users deletion
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_user_delete();

-- 5. Automatic updated_at trigger
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_users_updated_at
  before update on public.users
  for each row execute function public.handle_updated_at();

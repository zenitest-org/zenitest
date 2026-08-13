-- Migration: Add minutes_used_web and minutes_used_mobile columns to users table
alter table public.users
  add column if not exists minutes_used_web integer not null default 0,
  add column if not exists minutes_used_mobile integer not null default 0;

-- Function to atomically increment user usage minutes
create or replace function public.increment_user_usage(
  p_user_id uuid,
  p_minutes_web integer default 0,
  p_minutes_mobile integer default 0
)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.users
  set
    minutes_used_web = minutes_used_web + coalesce(p_minutes_web, 0),
    minutes_used_mobile = minutes_used_mobile + coalesce(p_minutes_mobile, 0),
    updated_at = now()
  where id = p_user_id;
end;
$$;

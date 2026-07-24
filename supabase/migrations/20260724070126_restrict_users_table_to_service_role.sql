-- Remove user-level RLS policies so only the service_role key can access public.users
drop policy if exists "Users can view own user record" on public.users;
drop policy if exists "Users can update own user record" on public.users;

-- Ensure Row Level Security is enabled. With no policies defined,
-- anon and authenticated client roles are completely restricted,
-- while the service_role key bypasses RLS for full backend access.
alter table public.users enable row level security;

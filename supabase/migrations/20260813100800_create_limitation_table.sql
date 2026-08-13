-- Migration: Create limitation table to manage plan limits
create table if not exists public.limitation (
  plan text not null primary key,
  max_minutes_web integer not null default 0,
  max_minutes_mobile integer not null default 0,
  max_parallel_web integer not null default 0,
  max_parallel_mobile integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Enable Row Level Security
alter table public.limitation enable row level security;

-- Seed default plans (free & pro)
insert into public.limitation (plan, max_minutes_web, max_minutes_mobile, max_parallel_web, max_parallel_mobile)
values
  ('free', 100, 0, 2, 0),
  ('pro', -1, 100, -1, 1)
on conflict (plan) do nothing;

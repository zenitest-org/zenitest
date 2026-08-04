-- Add network_reports, log_reports, and info columns to execution_details table
alter table public.execution_details
  add column if not exists network_reports jsonb not null default '[]'::jsonb,
  add column if not exists log_reports jsonb not null default '[]'::jsonb,
  add column if not exists info jsonb not null default '{}'::jsonb;

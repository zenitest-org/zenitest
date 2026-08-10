-- Add platforms column to executions table and platform column to execution_details table
alter table public.executions
  add column if not exists platforms text[] not null default '{web}';

alter table public.execution_details
  add column if not exists platform text not null default 'web';

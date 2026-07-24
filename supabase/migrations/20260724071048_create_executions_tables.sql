-- 1. Create executions table
create table public.executions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  status text not null default 'pending',
  environment text default 'production',
  total_test_cases integer not null default 0,
  passed_test_cases integer not null default 0,
  failed_test_cases integer not null default 0,
  skipped_test_cases integer not null default 0,
  total_duration_ms bigint not null default 0,
  total_tokens_used integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint executions_pkey primary key (id),
  constraint executions_title_check check (length(trim(title)) > 0),
  constraint executions_status_check check (status in ('pending', 'running', 'completed', 'failed', 'cancelled'))
) TABLESPACE pg_default;

-- 2. Create execution_details table (1 execution has multiple execution_details)
create table public.execution_details (
  id uuid not null default gen_random_uuid(),
  execution_id uuid not null references public.executions(id) on delete cascade,
  test_case_id text not null,
  title text not null,
  status text not null default 'pending',
  target_url text,
  duration_ms integer not null default 0,
  tokens_used integer not null default 0,
  step_reports jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint execution_details_pkey primary key (id),
  constraint execution_details_title_check check (length(trim(title)) > 0),
  constraint execution_details_status_check check (status in ('pending', 'running', 'passed', 'failed', 'skipped'))
) TABLESPACE pg_default;

-- 3. Indexes for fast lookup
create index idx_executions_user_id on public.executions(user_id);
create index idx_executions_status on public.executions(status);
create index idx_execution_details_execution_id on public.execution_details(execution_id);
create index idx_execution_details_test_case_id on public.execution_details(test_case_id);

-- 4. Enable Row Level Security (Restricted to service_role)
alter table public.executions enable row level security;
alter table public.execution_details enable row level security;

-- 5. Updated_at triggers
create trigger set_executions_updated_at
  before update on public.executions
  for each row execute function public.handle_updated_at();

create trigger set_execution_details_updated_at
  before update on public.execution_details
  for each row execute function public.handle_updated_at();

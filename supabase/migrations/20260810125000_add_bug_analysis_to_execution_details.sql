-- Add analyzed and bug_analysis columns to public.execution_details
alter table public.execution_details
add column if not exists analyzed boolean not null default false,
add column if not exists bug_analysis jsonb default null;

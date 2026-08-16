-- Migration: Add performance indexes to users, executions, and execution_details tables

-- 1. Users table indexes
-- Fast lookup by API Key (used on every API request and CLI runner authentication)
create index if not exists idx_users_api_key on public.users(api_key);

-- Fast lookup by Email (used for Creem webhooks and Clerk user sync)
create index if not exists idx_users_email on public.users(email);

-- Composite index for plan and subscription status lookups
create index if not exists idx_users_plan_status on public.users(plan, subscription_status);


-- 2. Executions table indexes
-- Composite index for paginated run listing by user ordered by creation date (primary runs list view)
create index if not exists idx_executions_user_id_created_at on public.executions(user_id, created_at desc);

-- Composite index for status-filtered runs listing (e.g. status = 'passed' / 'failed' / 'running')
create index if not exists idx_executions_user_id_status_created_at on public.executions(user_id, status, created_at desc);

-- Index for per-user execution number lookups and sequencing
create index if not exists idx_executions_user_id_number on public.executions(user_id, number desc);

-- GIN index for JSONB metadata if present
create index if not exists idx_executions_metadata_gin on public.executions using gin (metadata);


-- 3. Execution Details table indexes
-- Composite index for retrieving test cases for a run ordered by created_at
create index if not exists idx_execution_details_exec_id_created_at on public.execution_details(execution_id, created_at asc);

-- Composite index for run details status aggregation (passed/failed counts)
create index if not exists idx_execution_details_exec_id_status on public.execution_details(execution_id, status);

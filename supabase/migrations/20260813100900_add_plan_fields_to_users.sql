-- Migration: Add plan, subscription_status, subscribe_at, and expire_at columns to users table
alter table public.users
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text not null default 'active' check (subscription_status in ('active', 'canceled')),
  add column if not exists subscribe_at timestamp with time zone,
  add column if not exists expire_at timestamp with time zone;


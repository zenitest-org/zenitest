-- Migration: Decouple public.users from auth.users and set auto-generated UUID for id

-- 1. Drop triggers and functions on auth.users if they exist
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_deleted on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.handle_user_delete();

-- 2. Drop foreign key constraint referencing auth.users(id)
alter table public.users
  drop constraint if exists users_id_fkey;

-- 3. Set id column default to gen_random_uuid() so user id is auto-generated
alter table public.users
  alter column id set default gen_random_uuid();

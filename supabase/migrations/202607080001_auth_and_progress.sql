create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_login timestamptz not null default now(),
  login_provider text not null default 'email'
);

create table if not exists public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "progress_select_own" on public.user_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert_own" on public.user_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update_own" on public.user_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.profiles from anon;
revoke all on public.user_progress from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_progress to authenticated;

-- Logowanie: konta Supabase Auth (login + hasło), profil gracza, wyniki i przerwana
-- gra przypięte do konta (RLS po auth.uid()). Tabele są puste — przebudowujemy je
-- bez przenoszenia danych; mechanizm UUID urządzenia i funkcje RPC znikają.

drop function if exists public.save_game(uuid, text, text, jsonb);
drop function if exists public.load_game(uuid);
drop function if exists public.delete_game(uuid);
drop function if exists public.my_history(uuid, integer);
drop table if exists public.saved_games;
drop table if exists public.scores;

-- Profil gracza -----------------------------------------------------------------
create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  login       text        not null check (char_length(login) between 1 and 12),
  created_at  timestamptz not null default now()
);

create unique index profiles_login_lower_idx on public.profiles (lower(login));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

create policy "profiles_select_all" on public.profiles
  for select to anon, authenticated using (true);

-- Profil zakładany przy rejestracji z loginu w danych rejestracji (data.login)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, login) values (new.id, new.raw_user_meta_data ->> 'login');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Wyniki zakończonych gier -------------------------------------------------------
create table public.scores (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  score       integer     not null check (score between 0 and 10000000),
  wave        integer     not null check (wave >= 1),
  created_at  timestamptz not null default now()
);

create index scores_ranking_idx on public.scores (difficulty, score desc);
create index scores_history_idx on public.scores (user_id, created_at desc);

-- Pseudonim w rankingu = login autora (wartość z klienta nie ma znaczenia)
create function public.scores_set_nick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.login into new.nick from public.profiles p where p.id = new.user_id;
  return new;
end;
$$;

create trigger scores_set_nick
  before insert on public.scores
  for each row execute function public.scores_set_nick();

revoke execute on function public.scores_set_nick() from public, anon, authenticated;

alter table public.scores enable row level security;

-- Ranking jest publiczny; dopisuje tylko zalogowany i tylko jako on sam
-- (klient może podać wyłącznie poziom, wynik i falę)
revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant insert (difficulty, score, wave) on public.scores to authenticated;

create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

create policy "scores_insert_own" on public.scores
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Przerwana gra (jedna na konto) ---------------------------------------------------
create table public.saved_games (
  user_id     uuid        primary key default auth.uid() references public.profiles (id) on delete cascade,
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  snapshot    jsonb       not null check (octet_length(snapshot::text) < 262144),
  updated_at  timestamptz not null default now()
);

alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon, authenticated;
grant select, insert, update, delete on public.saved_games to authenticated;

create policy "saved_games_select_own" on public.saved_games
  for select to authenticated using (user_id = (select auth.uid()));

create policy "saved_games_insert_own" on public.saved_games
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "saved_games_update_own" on public.saved_games
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "saved_games_delete_own" on public.saved_games
  for delete to authenticated using (user_id = (select auth.uid()));

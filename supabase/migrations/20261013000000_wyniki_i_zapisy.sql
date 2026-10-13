-- Bandyci z Nieba: wyniki gier (ranking + historia) i przerwane gry do wznowienia.
-- Gracz bez logowania: identyfikuje go losowy UUID urządzenia (device_id).

-- Wyniki zakończonych gier ---------------------------------------------------
create table public.scores (
  id          bigint generated always as identity primary key,
  device_id   uuid        not null,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  score       integer     not null check (score between 0 and 10000000),
  wave        integer     not null check (wave >= 1),
  created_at  timestamptz not null default now()
);

create index scores_ranking_idx on public.scores (difficulty, score desc);
create index scores_history_idx on public.scores (device_id, created_at desc);

alter table public.scores enable row level security;

-- Ranking jest publiczny; dopisywać wolno, zmieniać i usuwać — nie
revoke all on public.scores from anon, authenticated;
grant select, insert on public.scores to anon, authenticated;

create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

create policy "scores_insert_all" on public.scores
  for insert to anon, authenticated with check (true);

-- Przerwane gry (jedna na urządzenie) ----------------------------------------
create table public.saved_games (
  device_id   uuid        primary key,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  snapshot    jsonb       not null check (octet_length(snapshot::text) < 262144),
  updated_at  timestamptz not null default now()
);

-- Brak polityk = brak bezpośredniego dostępu; tylko przez funkcje poniżej
alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon, authenticated;

create function public.save_game(p_device_id uuid, p_nick text, p_difficulty text, p_snapshot jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.saved_games (device_id, nick, difficulty, snapshot, updated_at)
  values (p_device_id, p_nick, p_difficulty, p_snapshot, now())
  on conflict (device_id) do update
    set nick = excluded.nick,
        difficulty = excluded.difficulty,
        snapshot = excluded.snapshot,
        updated_at = now();
$$;

create function public.load_game(p_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nick', nick, 'difficulty', difficulty, 'snapshot', snapshot, 'updated_at', updated_at)
  from public.saved_games
  where device_id = p_device_id;
$$;

create function public.delete_game(p_device_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.saved_games where device_id = p_device_id;
$$;

revoke execute on function public.save_game(uuid, text, text, jsonb) from public;
revoke execute on function public.load_game(uuid) from public;
revoke execute on function public.delete_game(uuid) from public;
grant execute on function public.save_game(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.load_game(uuid) to anon, authenticated;
grant execute on function public.delete_game(uuid) to anon, authenticated;

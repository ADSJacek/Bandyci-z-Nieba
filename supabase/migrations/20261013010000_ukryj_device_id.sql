-- device_id otwiera dostęp do zapisu gry (save/load/delete_game), więc nie może
-- być publicznie czytelny. Ranking widzi tylko kolumny bez identyfikatora,
-- a historię gracza zwraca funkcja my_history.

revoke select on public.scores from anon, authenticated;
grant select (id, nick, difficulty, score, wave, created_at) on public.scores to anon, authenticated;

create function public.my_history(p_device_id uuid, p_limit integer default 10)
returns table (nick text, difficulty text, score integer, wave integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.nick, s.difficulty, s.score, s.wave, s.created_at
  from public.scores s
  where s.device_id = p_device_id
  order by s.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke execute on function public.my_history(uuid, integer) from public;
grant execute on function public.my_history(uuid, integer) to anon, authenticated;

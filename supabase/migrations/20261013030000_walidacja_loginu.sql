-- Login sprawdzany także w bazie: rejestracja z pominięciem gry (bezpośrednio przez
-- /auth/v1/signup) nie może założyć loginu z niewidocznymi znakami, ze spacjami na
-- brzegach ani zarezerwować cudzego loginu innym adresem e-mail.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login text := new.raw_user_meta_data ->> 'login';
begin
  -- Jak w grze: 1–12 znaków (litery, cyfry, spacja, _ i -), pojedyncze spacje,
  -- a e-mail konta to techniczny adres wyliczony z tego loginu
  if v_login is null
     or v_login !~ '^[[:alpha:][:digit:] _-]{1,12}$'
     or v_login <> btrim(regexp_replace(v_login, '\s+', ' ', 'g'))
     or new.email is distinct from 'u' || encode(convert_to(lower(v_login), 'UTF8'), 'hex') || '@bandyci.local' then
    raise exception 'Niepoprawny login konta' using errcode = '22023';
  end if;
  insert into public.profiles (id, login) values (new.id, v_login);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

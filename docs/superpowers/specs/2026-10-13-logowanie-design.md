# Bandyci z Nieba — logowanie użytkownika (Supabase Auth)

Data: 2026-10-13
Status: do przeglądu
Bazuje na: `2026-10-13-supabase-wyniki-wznawianie-design.md` (gałąź `feat/supabase-wyniki`, PR #1)

## 1. Cel

Gracz może założyć konto (**login + hasło**) i się zalogować. Konto ma **profil w bazie**, do którego przypięte są wyniki (ranking, historia) i przerwana gra. Dzięki temu:

1. **Gra na wielu urządzeniach** — ta sama historia i przerwana gra po zalogowaniu na dowolnym komputerze.
2. **Wiarygodny ranking** — wynik przypisany do konta, pseudonim w rankingu = login konta; nikt nie podszyje się pod cudzy login ani nie odczyta / nadpisze cudzej gry.
3. **Pokaz Supabase Auth na szkoleniu** — rejestracja, logowanie, token JWT, odświeżanie sesji, RLS po `auth.uid()`.

**Gość** (gra bez logowania) zostaje: gra jak dziś offline, ale **bez zapisu wyników w bazie**.

### Ustalenia z użytkownikiem

| Temat | Decyzja |
|---|---|
| Po co logowanie | wiele urządzeń + wiarygodny ranking + pokaz Supabase Auth |
| Sposób logowania | login + hasło (bez e-maila dla gracza) |
| Profil | tabela `profiles` w bazie; wyniki i przerwana gra przypięte do konta |
| Gość | gra dostępna; wznawianie i rekord tylko lokalnie; bez rankingu i historii; widzi TOP 10 |
| Technika | Supabase Auth przez REST (`/auth/v1`), czysty `fetch`, bez bibliotek; RLS po `auth.uid()` |

### Założenia

- Login = pseudonim w rankingu; unikalny bez względu na wielkość liter; 1–12 znaków: litery (także polskie), cyfry, spacja, `_`, `-`.
- Hasło: min. 6 znaków (domyślny wymóg Supabase).
- Supabase Auth wymaga adresu e-mail — login jest zamieniany na **techniczny adres** (niewidoczny dla gracza); potwierdzanie e-maili **wyłączone** w panelu.
- Sesja zapamiętana w przeglądarce; wylogowanie w menu.
- Baza jest pusta — migracja przebudowuje tabele bez przenoszenia danych; mechanizm UUID urządzenia znika.
- Zalogowany gracz nadal może wysłać zawyżony wynik ręcznym zapytaniem — walidacja wyników po stronie serwera poza zakresem.

### Kryteria sukcesu

1. Rejestracja i logowanie z poziomu gry (klawiatura, canvas); po odświeżeniu strony gracz jest dalej zalogowany.
2. Wynik zalogowanego trafia do rankingu z jego loginem; historia pokazuje tylko jego gry.
3. Przerwana gra zalogowanego wznawia się po zalogowaniu w innej przeglądarce.
4. Gość gra, wznawia lokalnie, widzi TOP 10, ale jego wynik nie trafia do bazy.
5. Przez API (curl): gość nie dopisze wyniku; gracz A nie odczyta, nie nadpisze i nie usunie gry gracza B; `nick` w `scores` zawsze = login autora, bez względu na wysłaną wartość.
6. Bez sieci: komunikat przy logowaniu, gra jako gość działa; zalogowany zachowuje zachowanie offline z poprzedniej wersji (kopia lokalna, kolejka).
7. `npm test` przechodzi; konsola bez czerwonych błędów.

## 2. Baza — migracja `supabase/migrations/20261013020000_logowanie.sql`

### Tabela `profiles`

| kolumna | typ | ograniczenia |
|---|---|---|
| `id` | `uuid` | PK, `references auth.users(id) on delete cascade` |
| `login` | `text` | not null, `char_length between 1 and 12`; unikalny indeks na `lower(login)` |
| `created_at` | `timestamptz` | not null, default `now()` |

- Profil zakłada **trigger** `after insert on auth.users` (`security definer`, `set search_path = ''`) z `raw_user_meta_data->>'login'`; brak / niepoprawny login → wyjątek → rejestracja odrzucona.
- RLS: `select` publiczny (login jest i tak widoczny w rankingu); brak `insert/update/delete` dla `anon` / `authenticated` (login stały).

### Tabela `scores` (przebudowa)

| kolumna | zmiana |
|---|---|
| `device_id` | usunięta |
| `user_id` | nowa: `uuid not null references public.profiles(id) on delete cascade`, default `auth.uid()` |
| `nick` | wypełniana triggerem `before insert` z `profiles.login` (wartość z klienta ignorowana) |
| pozostałe | bez zmian (`difficulty`, `score`, `wave`, `created_at`, ograniczenia `check`) |

- Indeksy: `(difficulty, score desc)`, `(user_id, created_at desc)`.
- RLS: `select` publiczny (`anon`, `authenticated`) na wszystkich kolumnach (`user_id` nie jest sekretem); `insert` tylko `authenticated` z `with check (user_id = auth.uid())`; brak `update` / `delete`.
- Usunięcie funkcji `my_history` i grantów kolumnowych z migracji `ukryj_device_id`.

### Tabela `saved_games` (przebudowa)

| kolumna | zmiana |
|---|---|
| `device_id` | zastąpiona przez `user_id uuid primary key references public.profiles(id) on delete cascade` |
| `nick` | usunięta (login jest w profilu) |
| pozostałe | bez zmian (`difficulty`, `snapshot jsonb` < 256 kB, `updated_at`) |

- RLS tylko dla `authenticated`: `select`, `insert`, `update`, `delete` z warunkiem `user_id = auth.uid()`; `anon` bez dostępu.
- Usunięcie funkcji `save_game`, `load_game`, `delete_game`.

### Ustawienie w panelu (ręcznie, przez użytkownika)

Authentication → Sign In / Providers → Email → **wyłączyć „Confirm email”** (konto aktywne od razu po rejestracji).

## 3. Moduły

### Nowy `js/auth.js`

- `loginToEmail(login)` — czysta funkcja: `normalizeNick(login).toLowerCase()` → bajty UTF-8 → hex → `u<hex>@<AUTH_EMAIL_DOMAIN>` (stała w `config.js`; konkretną domenę potwierdza test na żywej bazie przed implementacją — Supabase może odrzucać niektóre domeny).
- `createAuth({ url, key, fetchFn = fetch, backend = localStorage, now = Date.now })` → obiekt:
  - `user` — `{ id, login }` lub `null` (gość);
  - `signUp(login, password)` → `POST /auth/v1/signup` z `{ email, password, data: { login } }`; przy sukcesie zapis sesji;
  - `signIn(login, password)` → `POST /auth/v1/token?grant_type=password`;
  - `signOut()` → `POST /auth/v1/logout` (błąd sieci ignorowany) + usunięcie sesji lokalnie;
  - `getToken()` → ważny `access_token` lub `null`; gdy do wygaśnięcia < 60 s — `POST /auth/v1/token?grant_type=refresh_token`; nieudane odświeżenie (4xx) → wylogowanie lokalne i `onSessionLost()`;
  - wszystkie metody `async`, nie rzucają; wynik `{ ok, error }` z kodami: `login-zajety`, `zle-dane`, `slabe-haslo`, `zly-login`, `offline`, `network`, `timeout`.
- Sesja w `localStorage` pod `arcaneInvaders.session`: `{ access_token, refresh_token, expires_at, user: { id, login } }`. Hasło nigdy nie jest zapisywane. Uszkodzona sesja → gość.
- Login w `user` pochodzi z `user_metadata.login` odpowiedzi Auth.

### Zmiany w `js/db.js`

- `createDb({ url, key, getToken, fetchFn, timeoutMs })` — przy każdym zapytaniu `Authorization: Bearer <token>` gdy `getToken()` zwraca token; w przeciwnym razie tylko `apikey` (jak dziś).
- `submitScore({ difficulty, score, wave })` → `POST /rest/v1/scores` (bez `device_id` / `nick`).
- `topScores`, `rankOf` — bez zmian.
- `myHistory(userId)` → `GET /rest/v1/scores?user_id=eq.<id>&order=created_at.desc&limit=10`.
- `saveGame(userId, difficulty, snapshot, { keepalive })` → `POST /rest/v1/saved_games?on_conflict=user_id` z `Prefer: resolution=merge-duplicates,return=minimal`.
- `loadGame(userId)` → `GET /rest/v1/saved_games?user_id=eq.<id>&select=difficulty,snapshot,updated_at` → `data` = pierwszy wiersz lub `null`.
- `deleteGame(userId)` → `DELETE /rest/v1/saved_games?user_id=eq.<id>`.

### Zmiany w `js/profile.js`

- Usunięte: UUID urządzenia (`deviceId`, `randomUuid`, `DEVICE_ID_KEY`), zapamiętany pseudonim (`NICK_KEY`, `createProfile`).
- Zostaje walidacja loginu: `normalizeNick`, `isValidNick`, `NICK_CHAR` (używane przez ekran logowania i `loginToEmail`).

### Zmiany w `js/persistence.js`

- Konstruktor przyjmuje `auth` zamiast `profile`; tryb wynika z `auth.user`.
- **Zalogowany:** zachowanie jak dziś, z `userId` zamiast `deviceId`.
- **Gość:** `saveNow` / `discard` / `checkSaved` tylko na kopii lokalnej; `submitResult` nic nie wysyła → `lastResult = { status: 'gosc', rank: null }`; `refreshHistory` → `history.status = 'gosc'`; `flushQueue` nic nie robi.
- Kopie lokalne osobno: `arcaneInvaders.savedGame:gosc` i `arcaneInvaders.savedGame:<userId>` (`storage.loadLocalSave(owner)` / `saveLocalSave(owner, data)`).
- Kolejka offline: wiersze z `userId`; `flushQueue` wysyła tylko wiersze bieżącego użytkownika, resztę zostawia.
- `onUserChanged()` — po zalogowaniu / wylogowaniu czyści stan w pamięci (`saved`, `history`, `lastResult`, `pendingSave`), podbija `generation`.

### Zmiany w `js/game.js`, `js/render.js`, `js/main.js`

- Stan `NICK` zastąpiony przez `LOGIN` (ekran „KTO JEDZIE?” + formularz); `profile` zastąpiony przez `auth`.
- `main.js`: `createAuth` → `createDb({ getToken: auth.getToken })` → `Persistence({ db, auth, storage })`; `auth.onSessionLost` → gra pokazuje komunikat i przechodzi w tryb gościa.

## 4. Ekrany i przepływ

```
start ─(jest sesja)→ MENU
start ─(brak sesji)→ LOGIN: [ZALOGUJ] [ZAREJESTRUJ] [GRAJ JAKO GOŚĆ]
LOGIN ─ZALOGUJ/ZAREJESTRUJ→ formularz (login, hasło) ─Enter→ „Łączenie…” → MENU | błąd
LOGIN ─GOŚĆ→ MENU (gość)
MENU ─L (zalogowany)→ wyloguj → LOGIN       (gdy jest przerwana gra: „L ponownie — wyloguj”)
MENU ─L (gość)→ LOGIN
MENU ─H (zalogowany)→ HISTORY
```

- **LOGIN:** ↑/↓ wybór opcji, Enter zatwierdza. Formularz: dwa pola, Tab lub ↑/↓ przełącza pole, Backspace usuwa, Enter wysyła, Esc wraca do wyboru. Hasło wyświetlane jako `•`. Znaki w loginie jak dziś (`NICK_CHAR`, AltGr działa); w haśle dowolny znak drukowalny, maks. 72 znaki. Błędy po polsku pod formularzem:
  - `login-zajety` → „Ten login jest już zajęty”
  - `zle-dane` → „Zły login lub hasło”
  - `slabe-haslo` → „Hasło musi mieć co najmniej 6 znaków”
  - `zly-login` → „Login: 1–12 znaków, litery, cyfry, spacja, _ -”
  - `offline` / `network` / `timeout` → „Brak połączenia z serwerem — możesz grać jako gość”
- **MENU:** „szeryf: <login>” albo „gość”; linie sterowania: „L — wyloguj” / „L — zaloguj się”, „H — historia gier” (tylko zalogowany); klawisz N usunięty; TOP 10 i „C — wznów” dla obu trybów.
- **HISTORY** dla gościa niedostępne (H nic nie robi; w menu podpowiedź „Zaloguj się, aby zapisywać wyniki”).
- **GAME OVER:** zalogowany — jak dziś; gość — „Gość — wynik nie trafia do rankingu”.
- Rekord „NAGRODA” w menu: jak dziś `max(lokalny rekord, TOP 1 z bazy)`.

## 5. Sesja, błędy i offline

- Token dostępowy ~1 h, odświeżany automatycznie przed zapytaniem (`getToken`). Nieudane odświeżenie z błędem 4xx (np. konto usunięte) → sesja usunięta, gracz staje się gościem, w menu jednorazowo „Sesja wygasła — zaloguj się ponownie”. Błąd sieci przy odświeżaniu → sesja zostaje, zapytanie traktowane jak offline.
- Bez sieci przy logowaniu → komunikat; „graj jako gość” działa.
- Zalogowany offline → jak dziś: kopia lokalna konta, kolejka wyników (wysyłana po powrocie sieci, gdy token da się odświeżyć).
- Wylogowanie → kopia lokalna konta zostaje, ale jest niewidoczna dla gościa i innych kont.
- Konsola: tylko `console.warn` raz na rodzaj błędu.

## 6. Testy i weryfikacja

- **Przed implementacją (spike na żywej bazie):** rejestracja przez `/auth/v1/signup` z technicznym adresem — potwierdzenie, że Supabase przyjmuje wybraną domenę i że po wyłączeniu „Confirm email” sesja wraca od razu; konto testowe usunięte po teście.
- `js/tests/auth.test.js` (atrapa `fetch` i `localStorage`): `loginToEmail` (polskie litery, wielkość liter, spacje); rejestracja / logowanie / wylogowanie; mapowanie błędów Supabase na kody; odświeżanie tokenu < 60 s przed wygaśnięciem; nieudane odświeżenie → gość; uszkodzona sesja → gość.
- `js/tests/db.test.js`: nagłówek `Authorization` z tokenem / bez tokenu; nowe ścieżki `saved_games` (upsert, select, delete), `myHistory(userId)`.
- `js/tests/persistence.test.js`: tryb gościa (brak wysyłki, lokalne wznawianie); osobne kopie lokalne na konto; kolejka wysyła tylko wiersze bieżącego konta; `onUserChanged`.
- `js/tests/game.test.js`: ekran LOGIN i przejścia; L wyloguj / zaloguj; gość bez historii; komunikat po utracie sesji.
- `js/tests/render.test.js`: nowe ekrany rysują się we wszystkich stanach.
- **Po wdrożeniu:** curl — gość nie dopisze wyniku; A nie czyta / nie nadpisuje / nie usuwa gry B; `nick` = login mimo innej wartości w zapytaniu; security advisors. Przejście w niewidocznym Chrome: rejestracja konta A, gra, pauza, wylogowanie, logowanie w „innej przeglądarce” (nowy profil) → wznowienie; gość → wynik nie w bazie. Dane testowe usunięte.
- `wymagania.md` — aktualizacja rozdz. 2, 3, 4.1, 5, 7, 8, 9.

## 7. Poza zakresem

- Logowanie przez e-mail / magic link / Google / GitHub; reset hasła (brak e-maila — zapomniane hasło = nowe konto; reset ręcznie w panelu Supabase).
- Zmiana loginu i usuwanie konta z poziomu gry.
- Przenoszenie wyników i zapisu gościa na nowe konto.
- Walidacja wyników po stronie serwera (anty-cheat).

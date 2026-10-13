# Bandyci z Nieba — zapis wyników i wznawianie gry (Supabase)

Data: 2026-10-13
Status: do przeglądu

## 1. Cel

1. **Zapis wyników** każdej zakończonej gry w bazie Supabase: globalny ranking TOP 10 na poziom trudności oraz osobista historia gier gracza.
2. **Wznawianie przerwanej gry** dokładnie od momentu przerwania (pełny snapshot stanu), także po zamknięciu i ponownym otwarciu strony.

### Ustalenia z użytkownikiem

| Temat | Decyzja |
|---|---|
| Baza | Supabase (Postgres), nowy projekt zakładany przez MCP |
| Identyfikacja gracza | nick wpisywany w grze + anonimowy UUID urządzenia w `localStorage`, bez logowania |
| Wznawianie | pełny snapshot stanu z chwili przerwania |
| Wyniki | globalny TOP 10 na poziom + osobista historia (ostatnie 10 gier) |
| Komunikacja z bazą | czysty `fetch` do REST API Supabase (PostgREST) + funkcje RPC, **bez bibliotek** |

### Założenia

- Jedna przerwana gra na urządzenie — nowy start nadpisuje/kasuje zapis.
- Klucz `anon` jest publiczny; bez logowania nie da się całkowicie wykluczyć sfałszowanych wyników. Ograniczamy to przez RLS, `check` i RPC — świadomie akceptowane w projekcie szkoleniowym.

### Kryteria sukcesu

1. Po game over wynik pojawia się w tabeli `scores` i w rankingu TOP 10 w menu.
2. Ekran historii pokazuje ostatnie 10 gier z tego urządzenia.
3. Pauza → odświeżenie strony → „C — wznów grę” przywraca grę z tym samym wynikiem, falą, życiami, położeniem wrogów, pocisków, bossa, sępa, bonusów i stanem beczek.
4. Bez sieci / bez konfiguracji gra działa jak dotąd (rekordy lokalne, wznowienie z kopii lokalnej), bez wyjątków w konsoli.
5. Pętla gry nigdy nie czeka na sieć — stabilne 60 FPS.
6. Testy `node --test` przechodzą (stare i nowe).

## 2. Schemat bazy

Migracja w repo: `supabase/migrations/20261013000000_wyniki_i_zapisy.sql`.

### Tabela `scores`

| kolumna | typ | ograniczenia |
|---|---|---|
| `id` | `bigint generated always as identity` | PK |
| `device_id` | `uuid` | not null |
| `nick` | `text` | not null, `char_length between 1 and 12` |
| `difficulty` | `text` | not null, `in ('latwy','normalny','trudny')` |
| `score` | `int` | not null, `between 0 and 10000000` |
| `wave` | `int` | not null, `>= 1` |
| `created_at` | `timestamptz` | not null, default `now()` |

Indeksy: `(difficulty, score desc)`, `(device_id, created_at desc)`.

### Tabela `saved_games`

| kolumna | typ | ograniczenia |
|---|---|---|
| `device_id` | `uuid` | PK |
| `nick` | `text` | not null |
| `difficulty` | `text` | not null, jak wyżej |
| `snapshot` | `jsonb` | not null, rozmiar < 256 kB |
| `updated_at` | `timestamptz` | not null, default `now()` |

### Dostęp (RLS włączone na obu tabelach)

- `scores` — rola `anon`: polityka `select` (wszystkie wiersze), polityka `insert` (z `check` jak wyżej). Brak `update` / `delete`.
- `saved_games` — brak polityk dla `anon` (bezpośredni dostęp zablokowany). Dostęp wyłącznie przez funkcje `security definer` z `set search_path = ''`, `grant execute` dla `anon`:
  - `save_game(p_device_id uuid, p_nick text, p_difficulty text, p_snapshot jsonb) returns void` — upsert po `device_id`, ustawia `updated_at`.
  - `load_game(p_device_id uuid) returns jsonb` — zwraca `{ nick, difficulty, snapshot, updated_at }` lub `null`.
  - `delete_game(p_device_id uuid) returns void`.
- Historia gracza: `select` z `scores` filtrowany po `device_id` (dane i tak publiczne w rankingu).
- Po migracji: sprawdzenie Supabase security advisors — brak ostrzeżeń dotyczących RLS.

## 3. Moduły

### Nowe

- **`js/db-config.js`** — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (commitowane; klucz anon jest publiczny). Puste wartości = tryb offline.
- **`js/db.js`** — `createDb({ url, key, fetchFn = globalThis.fetch, timeoutMs = 5000 })`. Brak `url`/`key` → obiekt, którego metody od razu zwracają `{ ok: false, error: 'offline' }`. Metody (wszystkie `async`, **nigdy nie rzucają**, zwracają `{ ok, data, error }`):
  - `submitScore({ deviceId, nick, difficulty, score, wave })` → `POST /rest/v1/scores`
  - `topScores(difficulty, limit = 10)` → `GET /rest/v1/scores?difficulty=eq.X&order=score.desc,created_at.asc&limit=N&select=nick,score,wave,created_at`
  - `rankOf(difficulty, score)` → liczba wyników `> score` (nagłówek `Prefer: count=exact`, `Range: 0-0`) + 1
  - `myHistory(deviceId, limit = 10)` → `GET /rest/v1/scores?device_id=eq.X&order=created_at.desc&limit=N`
  - `saveGame(deviceId, nick, difficulty, snapshot, { keepalive = false })` → `POST /rest/v1/rpc/save_game`
  - `loadGame(deviceId)` → `POST /rest/v1/rpc/load_game`
  - `deleteGame(deviceId)` → `POST /rest/v1/rpc/delete_game`
  - Nagłówki: `apikey`, `Authorization: Bearer <anon>`, `Content-Type: application/json`. Timeout przez `AbortController`.
- **`js/snapshot.js`** — `SNAPSHOT_VERSION = 1`, `serializeGame(game)` → obiekt JSON, `restoreGame(game, data)` → `true`/`false` (fałsz przy złej wersji lub uszkodzonych danych; gra nie zostaje w stanie połowicznym — przywracamy do obiektów tymczasowych, a dopiero po sukcesie podmieniamy w `game`).
- **`js/profile.js`** — `createProfile(backend)`: `deviceId` (`crypto.randomUUID()`, klucz `arcaneInvaders.deviceId`), `nick` (klucz `arcaneInvaders.nick`), `isValidNick(s)` (1–12 znaków, litery w tym polskie, cyfry, spacja, `_`, `-`; przycinane spacje). Każdy dostęp do `localStorage` w `try/catch`, jak w `storage.js`.
- **`js/persistence.js`** — klasa `Persistence({ db, profile, storage })` spinająca zapis z grą:
  - `autosave(game)` / `saveNow(game, { keepalive })` — serializacja + `db.saveGame` + kopia lokalna; nie startuje nowego zapisu, gdy poprzedni trwa.
  - `checkSaved()` → informacja do menu (`{ wave, score, difficulty }` lub `null`); źródło: baza, a przy błędzie kopia lokalna.
  - `discard()` — kasuje zapis w bazie i lokalnie.
  - `submitResult(result)` — wysyła wynik; przy błędzie dokłada do kolejki offline; zwraca miejsce w rankingu lub `null`.
  - `flushQueue()` — ponowna wysyłka kolejki (wywoływana przy wejściu do menu).
  - `refreshLeaderboard(difficulty)`, `refreshHistory()` — wyniki trzymane w polach odczytywanych przez render (`leaderboard`, `history`, ze statusem `loading`/`ok`/`error`).
- Rozszerzenie **`js/storage.js`**: `loadLocalSnapshot` / `saveLocalSnapshot` / `clearLocalSnapshot` (klucz `arcaneInvaders.savedGame`), `loadScoreQueue` / `saveScoreQueue` (klucz `arcaneInvaders.scoreQueue`, maks. 20 pozycji — najstarsze odrzucane).

### Zmiany w istniejących

- **Encje** (`player`, `enemies` / `Formation`, `boss`, `vulture`, `bullets` — `Bullet`, `Dynamite`, `shields`, `powerups` — `PowerUp`): metoda `toJSON()` i statyczna `fromJSON(data, ...zależności)` (np. `difficulty`). Serializujemy wyłącznie stan logiczny: pozycje, prędkości, HP, timery, flagi, aktywne bonusy gracza i ich czasy. Pomijamy: `Effects`, `Ambient`, `Explosion` (kosmetyka), wstrząs i błysk ekranu.
- **`js/game.js`** — konstruktor przyjmuje `persistence` i `profile`; nowe stany i przejścia (rozdz. 5); wywołania `persistence` w punktach z rozdz. 4.
- **`js/render.js`** — `drawNickEntry`, `drawLeaderboard` (w menu), `drawHistory`, linia „C — wznów grę…” w menu, „Miejsce w rankingu: #N” na game over.
- **`js/input.js`** — bufor wpisanych znaków (`e.key` o długości 1) i `Backspace` na potrzeby ekranu nicka.
- **`js/main.js`** — składanie zależności, `beforeunload` → `persistence.saveNow(game, { keepalive: true })` gdy trwa gra lub pauza.
- **`wymagania.md`** — aktualizacja rozdz. 2 (Supabase przez `fetch`), 3 (nowe moduły), 7 (zapis danych).

## 4. Snapshot i momenty zapisu

Zawartość snapshotu:

```
{ version, difficulty, nick, score, wave, bossCount, time,
  bannerTimer, vultureTimer,
  player, formation, boss, vulture, shields,
  playerBullets, enemyBullets, dynamites, powerups }
```

Zapis (`saveNow`) przy:
- wejściu w pauzę (P / Esc oraz `visibilitychange`),
- wyjściu z pauzy do menu (Enter),
- `beforeunload` (`fetch` z `keepalive: true`; kopia lokalna zapisywana synchronicznie),
- co **10 s** w stanie GRA (`autosave`), o ile poprzedni zapis się zakończył.

Usunięcie zapisu (`discard`) przy:
- game over,
- starcie nowej gry (Enter w menu) — świadome porzucenie zapisu.

Każdy zapis do bazy jest też odkładany jako kopia lokalna w `localStorage`; przy niedostępnej bazie wznawiamy z kopii.

## 5. Ekrany i przepływ

Nowe stany: `NICK` (wpisywanie pseudonimu), `HISTORY` (osobista historia).

```
start ─(brak nicku)→ NICK ─Enter→ MENU
MENU ─Enter→ GRA (nowa; kasuje zapis)
MENU ─C (jest zapis)→ PAUZA (wznowiona gra)
MENU ─N→ NICK ─Enter/Esc→ MENU
MENU ─H→ HISTORY ─Esc/Enter→ MENU
GRA ─P/Esc→ PAUZA (zapis) ─Enter→ MENU (zapis)
GRA → GAME OVER (wysłanie wyniku, kasowanie zapisu)
```

- **NICK:** „PODAJ PSEUDONIM”, migający kursor, Enter zatwierdza tylko poprawny nick, Esc (gdy nick już istnieje) wraca bez zmian.
- **MENU:** dotychczasowa zawartość + aktualny nick, linia „C — wznów grę (poziom, fala X, wynik Y)” gdy jest zapis, „N — zmień pseudonim”, „H — historia”, ranking TOP 10 dla wybranego poziomu (odświeżany przy zmianie poziomu; „Wczytywanie…” / „Ranking niedostępny”).
- **HISTORY:** tabela ostatnich 10 gier: data, poziom, fala, wynik.
- **GAME OVER:** dotychczasowa zawartość + „Miejsce w rankingu: #N” lub „Wynik zapisany lokalnie”.
- Lokalne rekordy (`arcaneInvaders.highscores`) zostają; HUD pokazuje `max(lokalny rekord, najlepszy wynik z TOP 10 bazy, bieżący wynik)`.

## 6. Błędy i offline

- Wywołania bazy są asynchroniczne, wyniki wpisywane do pól `persistence` — render czyta je w kolejnych klatkach. Pętla gry nigdy nie czeka.
- Błąd sieci / HTTP / timeout → `console.warn` (jeden komunikat na rodzaj błędu na sesję), brak wyjątków.
- Niewysłany wynik → kolejka offline w `localStorage` (maks. 20), ponowna wysyłka przy wejściu do menu; udane pozycje usuwane z kolejki.
- Snapshot z inną wersją lub uszkodzony → odrzucony i skasowany (baza + lokalnie), w menu jednorazowy komunikat „Zapis niekompatybilny”.
- Brak konfiguracji Supabase → tryb offline: ranking „niedostępny”, wznawianie z kopii lokalnej, historia niedostępna.

## 7. Testy (`node --test`)

- `js/tests/db.test.js` — atrapa `fetch`: poprawne URL-e, metody, nagłówki i body dla każdej metody; timeout; błąd HTTP; wyjątek sieci; tryb offline bez konfiguracji.
- `js/tests/snapshot.test.js` — cykl `serializeGame` → `JSON.stringify/parse` → `restoreGame` daje ten sam stan logiczny (dla każdego typu encji); zła wersja i uszkodzone dane → `false` i stan gry nienaruszony.
- `js/tests/profile.test.js` — walidacja nicka; UUID generowany raz i pamiętany; brak `localStorage` nie rzuca.
- `js/tests/persistence.test.js` — kolejka offline (dodanie, limit 20, opróżnienie po sukcesie); `submitResult` przy błędzie trafia do kolejki; `checkSaved` spada na kopię lokalną; brak równoległych zapisów.
- `js/tests/storage.test.js` — rozszerzony o nowe klucze.
- Ręcznie w przeglądarce: gra → pauza → odświeżenie → wznowienie → game over → wynik w rankingu i historii; to samo z wyłączoną siecią (DevTools offline).

## 8. Poza zakresem

- Logowanie i synchronizacja między urządzeniami.
- Walidacja wyników po stronie serwera (anty-cheat), Edge Functions.
- Realtime / odświeżanie rankingu na żywo.
- Wiele zapisów gry na urządzenie.

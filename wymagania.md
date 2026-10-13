# Bandyci z Nieba — wymagania

Data: 2026-09-29
Status: do przeglądu

## 1. Cel i kontekst

- **Cel:** projekt szkoleniowy — działająca, czytelna gra przeglądarkowa do omawiania na szkoleniu.
- **Klimat:** western, Dziki Zachód.
- **Gatunek:** arcade w układzie Space Invaders („szeryf vs najazd”): rewolwerowiec na dole ekranu, z góry schodzą fale bandytów.
- **Platforma:** desktop, nowoczesna przeglądarka (Chrome, Edge, Firefox).
- **Język interfejsu:** polski.

### Kryteria sukcesu

1. Gra uruchamia się przez lokalny serwer (Live Server / `npx serve`) bez błędów w konsoli.
2. Pełny cykl działa: menu → gra → pauza → game over → restart.
3. Wszystkie elementy z rozdziału 4 działają zgodnie z opisem.
4. Stabilne 60 FPS.
5. Testy czystych funkcji przechodzą.
6. Kod jest czytelny, podzielony na moduły, z krótkimi komentarzami po polsku.

## 2. Technologia

- Czysty JavaScript (ES2020+), **bez bibliotek i frameworków**.
- **ES modules** (`import`/`export`), ładowane przez `<script type="module">`.
  - Wymaga lokalnego serwera — przez `file://` przeglądarka blokuje moduły.
- Grafika **rysowana kodem** na elemencie `<canvas>` (kształty / pixel-art), bez plików graficznych.
  - Wyjątek: opcjonalne tło `assets/background.png` (4:3, np. 800×600 lub 1600×1200). Gdy pliku brak, używane jest tło rysowane kodem.
- Dźwięk generowany przez **Web Audio API**, bez plików audio.
- Zapis rekordów i ustawień w **localStorage**.
- Stała rozdzielczość logiczna canvasu **800×600**, skalowana do okna z zachowaniem proporcji.

## 3. Architektura

```
index.html          – canvas + <script type="module" src="js/main.js">
css/style.css       – wyśrodkowanie, tło, czcionka
js/
  main.js           – inicjalizacja, pętla gry (requestAnimationFrame, delta time)
  config.js         – wszystkie stałe i ustawienia poziomów trudności
  input.js          – obsługa klawiatury (stan wciśniętych klawiszy)
  game.js           – maszyna stanów: MENU → GRA → PAUZA → GAME OVER
  entities/
    player.js       – szeryf: ruch, strzał, cooldown, życia, nietykalność
    enemies.js      – formacja bandytów: ruch, zejście w dół, strzały
    boss.js         – boss „El Diablo” co 5 fal
    vulture.js      – przelatujący sęp (bonus punktowy)
    bullets.js      – pociski gracza i wrogów, dynamit
    shields.js      – beczki/wozy zniszczalne blokami
    powerups.js     – bonusy wypadające z wrogów
  collision.js      – kolizje prostokątów (AABB)
  render.js         – tło (pustynia, kaktusy, zachód słońca), HUD, ekrany
  audio.js          – efekty dźwiękowe (Web Audio)
  storage.js        – rekordy i ustawienia w localStorage
  tests/            – testy czystych funkcji (node --test)
```

### Zasady projektowe

- Każdy moduł ma jedną odpowiedzialność; encje udostępniają `update(dt)` i `draw(ctx)`.
- **Wszystkie liczby do strojenia** (prędkości, punkty, czasy, szanse) znajdują się w `config.js`.
- Logika (kolizje, punktacja, konfiguracja trudności, ruch formacji) oddzielona od rysowania, aby dało się ją testować bez przeglądarki.
- `delta time` ograniczony do 50 ms (brak „przeskoków” po powrocie do karty).
- Gdy karta przeglądarki jest ukryta (`visibilitychange`), gra automatycznie się pauzuje.

## 4. Rozgrywka

### 4.1 Sterowanie (tylko klawiatura)

| Klawisz | Akcja |
|---|---|
| ← / → lub A / D | ruch szeryfa w poziomie |
| Spacja | strzał |
| P lub Esc | pauza / wznowienie |
| M | wycisz / włącz dźwięk |
| ↑ / ↓ | wybór poziomu trudności w menu |
| Enter | start gry / powrót do menu |
| R | restart na ekranie game over |

### 4.2 Szeryf (gracz)

- Ruch w poziomie w granicach ekranu.
- Domyślnie **1 pocisk gracza naraz** na ekranie (klasyka); bonusy to zmieniają.
- Życia na start zależne od poziomu trudności (Normalny: 3), maksymalnie 5 (6 dzięki super bonusowi, zob. 4.8).
- Po trafieniu: utrata życia i **2 s nietykalności** (sprite miga).
- Utrata ostatniego życia → game over.

### 4.3 Bandyci (formacja)

- Formacja **5 rzędów × 10 kolumn**.
- Typy (od góry):

| Typ | Rzędy | Punkty |
|---|---|---|
| Herszt | 1 | 30 |
| Rewolwerowiec | 2–3 | 20 |
| Opryszek | 4–5 | 10 |

- Formacja porusza się w bok; po dotknięciu krawędzi schodzi w dół i zmienia kierunek.
- Prędkość rośnie wraz ze spadkiem liczby żywych bandytów.
- Strzelają losowo w dół — strzela wyłącznie najniższy żywy bandyta w danej kolumnie.
- Gdy formacja dotrze do linii szeryfa → game over.

### 4.4 Fale

- Po wybiciu całej formacji startuje kolejna fala: formacja zaczyna niżej i porusza się szybciej.
- Między falami na 2 s wyświetla się napis „FALA N”.
- **Co 5. fala** (5, 10, 15…) to walka z bossem zamiast formacji.
- Gra trwa bez końca, do utraty wszystkich żyć.

### 4.5 Boss „El Diablo”

- Jeździ konno w poziomie u góry ekranu, odbijając się od krawędzi.
- Pasek życia: **20 trafień** (bazowo).
- Ataki: wachlarz 3 pocisków; co pewien czas rzut **dynamitu**, który wybucha z większym obszarem rażenia.
- Nagroda: **500 pkt × numer bossa** (pierwszy boss = 500, drugi = 1000…).

### 4.6 Sęp (bonus punktowy)

- Co pewien czas przelatuje przez górną część ekranu podczas zwykłej fali.
- Zestrzelenie: losowo **50–300 pkt**.

### 4.7 Osłony

- **4 osłony** (beczki / wozy) nad szeryfem, zbudowane z siatki bloków.
- Każde trafienie — także pociskiem gracza — niszczy blok.
- Dynamit niszczy kilka bloków naraz.
- Osłony są odnawiane po walce z bossem.

### 4.8 Bonusy (power-upy)

- Wypadają z pokonanego bandyty z szansą zależną od poziomu trudności (Normalny: 10%).
- Spadają w dół; szeryf zbiera je, najeżdżając na nie. Niezebrane znikają za dolną krawędzią.
- Aktywny bonus czasowy jest widoczny w HUD z paskiem pozostałego czasu.

| Bonus | Efekt | Czas |
|---|---|---|
| Podwójny rewolwer | 2 pociski gracza naraz | 10 s |
| Szybki spust | krótszy cooldown strzału | 10 s |
| Gwiazda szeryfa | tarcza pochłaniająca 1 trafienie | do trafienia |
| Dodatkowe życie | +1 życie (maks. 5), rzadki | — |

#### Super bonus „Złota podkowa”

- Wypada **zawsze z pokonanego bossa** oraz z szansą **2%** z zestrzelonego sępa.
- Spada wolniej niż zwykłe bonusy i świeci złotem, żeby łatwo go było zauważyć.
- Efekt po zebraniu:
  - **+1 życie**, które może przekroczyć zwykły limit — maksymalnie **6 żyć**,
  - **3 s nietykalności** (sprite świeci złotem).
- Gdy szeryf ma już 6 żyć, zamiast życia dostaje **1000 pkt** (z mnożnikiem trudności).
- Zebranie ma osobny, wyraźny efekt dźwiękowy i napis „SUPER BONUS!” na ekranie.

### 4.9 Poziomy trudności

Wybierane w menu; realizowane jako mnożniki w `config.js`.

| Parametr | Łatwy | Normalny | Trudny |
|---|---|---|---|
| Prędkość wrogów | ×0.7 | ×1.0 | ×1.4 |
| Częstość strzałów wrogów | ×0.5 | ×1.0 | ×1.6 |
| Życia na start | 5 | 3 | 2 |
| Szansa na bonus | 15% | 10% | 6% |
| Mnożnik punktów | ×0.5 | ×1.0 | ×1.5 |

Wartości są punktem startowym do strojenia.

## 5. Ekrany i interfejs

1. **Menu** — tytuł „BANDYCI Z NIEBA” w stylu listu gończego „WANTED”, wybór poziomu trudności, rekord dla wybranego poziomu, instrukcja sterowania. Enter = start.
2. **Gra** — HUD u góry: wynik, rekord, życia (ikony kapeluszy), numer fali, aktywny bonus z paskiem czasu.
3. **Pauza** — półprzezroczysta nakładka z napisem „PAUZA”.
4. **Game over** — „WANTED: DEAD”, wynik końcowy, komunikat „NOWY REKORD!” gdy pobity; Enter = menu, R = restart.

### Styl wizualny

- Tło: pustynia o zachodzie słońca, kaktusy, sylwetki gór.
- Paleta ciepła: piaskowe, rdzawe, pomarańczowe barwy nieba.
- Czcionka w stylu westernowym (Google Fonts, np. „Rye”) z bezpiecznym fallbackiem.

## 6. Dźwięk

- Efekty generowane w Web Audio: strzał, trafienie, wybuch, zebranie bonusu, zebranie super bonusu, utrata życia, pojawienie się bossa, game over.
- AudioContext tworzony przy pierwszej interakcji z klawiaturą (wymóg przeglądarek).
- Klawisz M wycisza dźwięk; ustawienie zapamiętywane w localStorage.

## 7. Zapis danych

- Klucz `arcaneInvaders.highscores` → obiekt `{ latwy, normalny, trudny }` z najlepszym wynikiem na każdy poziom.
- Klucz `arcaneInvaders.muted` → `true` / `false`.
- Każdy odczyt i zapis w `try/catch`; przy braku dostępu do localStorage gra działa dalej bez rekordów.

## 8. Testy

- Testy jednostkowe czystych funkcji w `js/tests/`, uruchamiane przez `node --test`:
  - kolizje AABB,
  - naliczanie punktów z mnożnikiem trudności,
  - konfiguracja poziomów trudności,
  - ruch formacji (odbicie od krawędzi, zejście w dół),
  - wybór strzelającego bandyty (najniższy w kolumnie),
  - odczyt/zapis rekordów (z atrapą localStorage).
- Test manualny: przejście pełnego cyklu z kryteriów sukcesu na każdym poziomie trudności.

## 9. Poza zakresem (pierwsza wersja)

- Sterowanie dotykiem i myszą, wersja mobilna.
- Muzyka w tle.
- Tryb wieloosobowy.
- Ranking online.
- Pliki graficzne i dźwiękowe.

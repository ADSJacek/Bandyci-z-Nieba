# Prompt — grafika tła do gry Bandyci z Nieba

Plik wynikowy zapisz jako `assets/jacek.png` (4:3, docelowo 800×600 — rozdzielczość gry).
Gra sama go użyje; gdy pliku brak, rysowane jest tło z kodu.

## Prompt (pixel-art)

```
Wild West desert background for a 2D arcade shooter game (Space Invaders style), 4:3, 1600x1200, stylized painted pixel-art look. Theme: a vast American frontier desert at sunset, classic western atmosphere, the calm before a showdown. Composition: the upper 65% of the frame is open sky – a smooth, low-detail gradient from deep dusk purple at the top, through rusty crimson, to warm orange near the horizon – kept calm and uncluttered, reserved for enemy formations and projectiles. The very top strip is especially plain and dark (reserved for the game HUD). Horizon line at about 70% of the image height. A large setting sun sits low on the horizon, slightly off-center, partly hidden behind distant red mesas and flat-topped buttes. Below the horizon: sandy desert ground with soft dune lines, a few small rocks, dark saguaro cactus silhouettes placed only near the left and right edges. All detail pushed to the horizon and the side edges; the center of the sky stays clean. Lighting: warm golden-hour backlight, long soft shadows, gentle glow around the sun, first faint stars in the upper sky. Palette: dusk purple, rust red, burnt orange, sandy ochre, warm brown – muted and slightly desaturated so bright game sprites stand out. No text, no letters, no logos, no people, no animals, no buildings in the center, no foreground objects in the middle of the frame. Clean shapes, readable silhouettes, high quality game art.
```

## Wariant malarski

Zamień `stylized painted pixel-art look` na:

```
cinematic matte painting, painterly digital art
```

Efektowniejszy, ale słabiej pasuje do prostych sprite'ów gry.

## Dlaczego tak

- **Puste niebo w górnych 65% kadru**: tam latają wrogowie i pociski, więc tło nie może z nimi konkurować.
- **Ciemny pasek na samej górze**: tam jest pasek HUD (wynik, życia, fala).
- **Horyzont na 70% wysokości**: tak jak w tle rysowanym kodem (`HORIZON_Y = 420` przy wysokości 600).
- **Stonowana paleta**: kolorowe postacie i pociski mają być dobrze widoczne.
- **Proporcje 4:3**: rozdzielczość gry to 800×600. Jeśli generator obsługuje tylko 16:9, przytnij boki.

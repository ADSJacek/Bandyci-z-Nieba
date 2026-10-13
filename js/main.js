// Inicjalizacja, składanie zależności i pętla gry (requestAnimationFrame + ograniczony delta time).
import { MAX_DT, FONT_TITLE } from './config.js';
import { Input } from './input.js';
import { SoundFx } from './audio.js';
import { createStorage } from './storage.js';
import { createProfile } from './profile.js';
import { createDb } from './db.js';
import { Persistence } from './persistence.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './db-config.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const storage = createStorage();
const profile = createProfile();
const db = createDb({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });
const persistence = new Persistence({ db, profile, storage });
const audio = new SoundFx();
const input = new Input(window, () => audio.init());
const game = new Game({ input, audio, storage, persistence, profile });

// Ukryta karta → automatyczna pauza
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

// Zamknięcie lub odświeżenie karty — ostatni zapis przerwanej gry (fetch z keepalive)
window.addEventListener('pagehide', () => game.saveProgress({ keepalive: true }));

// Czcionka „Rye” z Google Fonts — gra działa też bez niej (fallback Georgia)
document.fonts?.load(`32px ${FONT_TITLE}`).catch(() => {});

let last = performance.now();

function frame(now) {
  // Po powrocie do karty nie „przeskakujemy” — maks. 50 ms na klatkę
  const dt = Math.min(Math.max(0, (now - last) / 1000), MAX_DT);
  last = now;
  game.update(dt);
  game.draw(ctx);
  input.endFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

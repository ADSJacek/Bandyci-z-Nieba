// Rekordy, ustawienia, kopia przerwanej gry i kolejka wyników w localStorage.
// Każdy dostęp w try/catch — bez localStorage gra działa dalej, tylko nie pamięta danych.
import { DIFFICULTY_ORDER, PERSISTENCE } from './config.js';

export const HIGHSCORES_KEY = 'arcaneInvaders.highscores';
export const MUTED_KEY = 'arcaneInvaders.muted';
export const SAVED_GAME_KEY = 'arcaneInvaders.savedGame';
export const SCORE_QUEUE_KEY = 'arcaneInvaders.scoreQueue';

export function emptyHighscores() {
  return { latwy: 0, normalny: 0, trudny: 0 };
}

export function defaultBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Czysta funkcja: zwraca nowe rekordy i informację, czy wynik jest nowym rekordem
export function updateHighscore(highscores, difficultyKey, score) {
  const current = highscores[difficultyKey] ?? 0;
  if (score <= current) return { highscores, isNew: false };
  return { highscores: { ...highscores, [difficultyKey]: score }, isNew: true };
}

export function createStorage(backend = defaultBackend()) {
  function readJson(key) {
    try {
      const raw = backend?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // uszkodzone dane lub brak dostępu
    }
  }

  function writeJson(key, value) {
    try {
      if (!backend) return false;
      backend.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  return {
    loadHighscores() {
      const result = emptyHighscores();
      try {
        const raw = backend?.getItem(HIGHSCORES_KEY);
        if (!raw) return result;
        const parsed = JSON.parse(raw);
        for (const key of DIFFICULTY_ORDER) {
          const value = Number(parsed?.[key]);
          if (Number.isFinite(value) && value > 0) result[key] = Math.floor(value);
        }
      } catch {
        // uszkodzone dane lub brak dostępu — zaczynamy od zera
      }
      return result;
    },

    saveHighscores(highscores) {
      try {
        if (!backend) return false;
        backend.setItem(HIGHSCORES_KEY, JSON.stringify(highscores));
        return true;
      } catch {
        return false;
      }
    },

    loadMuted() {
      try {
        return backend?.getItem(MUTED_KEY) === 'true';
      } catch {
        return false;
      }
    },

    saveMuted(muted) {
      try {
        if (!backend) return false;
        backend.setItem(MUTED_KEY, String(Boolean(muted)));
        return true;
      } catch {
        return false;
      }
    },

    // Kopia przerwanej gry — zapasowe źródło wznowienia, gdy baza jest niedostępna
    loadLocalSave() {
      const data = readJson(SAVED_GAME_KEY);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    },

    saveLocalSave(data) {
      return writeJson(SAVED_GAME_KEY, data);
    },

    // Wyniki, których nie udało się wysłać do bazy
    loadScoreQueue() {
      const data = readJson(SCORE_QUEUE_KEY);
      return Array.isArray(data) ? data : [];
    },

    saveScoreQueue(queue) {
      return writeJson(SCORE_QUEUE_KEY, queue.slice(-PERSISTENCE.scoreQueueMax));
    },
  };
}

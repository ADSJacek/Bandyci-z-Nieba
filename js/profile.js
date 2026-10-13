// Profil gracza: anonimowy identyfikator urządzenia i pseudonim (localStorage).
// Bez logowania — identyfikator wiąże z urządzeniem przerwaną grę i historię wyników.
import { PERSISTENCE } from './config.js';
import { defaultBackend } from './storage.js';

export const DEVICE_ID_KEY = 'arcaneInvaders.deviceId';
export const NICK_KEY = 'arcaneInvaders.nick';

// Jeden dozwolony znak pseudonimu: litery (także polskie), cyfry, spacja, _ i -
export const NICK_CHAR = /^[\p{L}\d _-]$/u;
const NICK_PATTERN = /^[\p{L}\d _-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeNick(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function isValidNick(raw) {
  const nick = normalizeNick(raw);
  return nick.length >= 1 && nick.length <= PERSISTENCE.nickMaxLength && NICK_PATTERN.test(nick);
}

// crypto.randomUUID działa tylko w bezpiecznym kontekście (https / localhost) —
// przy otwarciu gry po adresie IP w sieci lokalnej składamy UUID v4 sami.
export function randomUuid(cryptoObj = globalThis.crypto) {
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === 'function') cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // wersja 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // wariant RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createProfile(backend = defaultBackend(), uuid = randomUuid) {
  const read = (key) => {
    try {
      return backend?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      backend?.setItem(key, value);
    } catch {
      // brak dostępu — wartość zostaje tylko w pamięci
    }
  };

  let deviceId = read(DEVICE_ID_KEY);
  if (!deviceId || !UUID_PATTERN.test(deviceId)) {
    deviceId = uuid();
    write(DEVICE_ID_KEY, deviceId);
  }
  const stored = read(NICK_KEY);
  let nick = isValidNick(stored) ? normalizeNick(stored) : null;

  return {
    get deviceId() {
      return deviceId;
    },

    get nick() {
      return nick;
    },

    // Zwraca false (i nic nie zmienia), gdy pseudonim jest niepoprawny
    setNick(raw) {
      if (!isValidNick(raw)) return false;
      nick = normalizeNick(raw);
      write(NICK_KEY, nick);
      return true;
    },
  };
}

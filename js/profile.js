// Zasady loginu gracza: ekran logowania i techniczny e-mail konta (js/auth.js).
import { PERSISTENCE } from './config.js';

// Jeden dozwolony znak loginu: litery (także polskie), cyfry, spacja, _ i -
export const NICK_CHAR = /^[\p{L}\d _-]$/u;
const NICK_PATTERN = /^[\p{L}\d _-]+$/u;

export function normalizeNick(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function isValidNick(raw) {
  const nick = normalizeNick(raw);
  return nick.length >= 1 && nick.length <= PERSISTENCE.nickMaxLength && NICK_PATTERN.test(nick);
}

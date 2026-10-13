// Obsługa klawiatury: stan wciśniętych klawiszy + pojedyncze naciśnięcia w danej klatce.

const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyP', 'KeyM', 'KeyR', 'Escape', 'Enter', 'NumpadEnter', 'Backspace', 'Tab',
]);

export class Input {
  constructor(target, onFirstKey) {
    this.down = new Set();
    this.pressed = new Set();
    this.typed = [];   // znaki wpisane w tej klatce (pole loginu i hasła)
    this.captureText = false; // ekran logowania: znaki nie trafiają do przeglądarki
    this.onFirstKey = onFirstKey;

    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      // AudioContext wolno utworzyć dopiero po interakcji użytkownika
      if (this.onFirstKey) this.onFirstKey();
      const code = e.code === 'NumpadEnter' ? 'Enter' : e.code;
      if (!e.repeat) this.pressed.add(code);
      this.down.add(code);
      // Polskie litery piszemy z AltGr (Windows: Ctrl+Alt) albo Option (macOS: Alt) —
      // odrzucamy tylko skróty z Cmd lub z samym Ctrl
      const shortcut = e.metaKey || (e.ctrlKey && !e.altKey);
      if (e.key.length === 1 && !shortcut) {
        this.typed.push(e.key);
        // np. Firefox otwiera szukanie po „/” i apostrofie — hasło trafiłoby tam jawnym tekstem
        if (this.captureText) e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => {
      const code = e.code === 'NumpadEnter' ? 'Enter' : e.code;
      this.down.delete(code);
    });
    // Po utracie fokusu nie zostawiamy „zawieszonych” klawiszy
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  // Czy w tej klatce naciśnięto jakikolwiek klawisz
  anyPressed() {
    return this.pressed.size > 0;
  }

  // Wywoływane na końcu każdej klatki
  endFrame() {
    this.pressed.clear();
    this.typed = [];
  }
}

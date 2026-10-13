import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../input.js';

// Atrapa okna: zbiera nasłuchy i pozwala „nacisnąć” klawisz
function fakeTarget() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    keydown: (init) => handlers.keydown({ repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, ...init }),
  };
}

test('wpisane znaki: polskie litery także z AltGr (Ctrl+Alt) i Option (Alt)', () => {
  const target = fakeTarget();
  const input = new Input(target);
  target.keydown({ code: 'KeyL', key: 'ł', ctrlKey: true, altKey: true }); // Windows, AltGr
  target.keydown({ code: 'KeyA', key: 'ą', altKey: true });                // macOS, Option
  target.keydown({ code: 'KeyJ', key: 'J' });
  assert.deepEqual(input.typed, ['ł', 'ą', 'J']);
});

test('skróty z Ctrl lub Cmd nie trafiają do pola tekstowego', () => {
  const target = fakeTarget();
  const input = new Input(target);
  target.keydown({ code: 'KeyV', key: 'v', ctrlKey: true });
  target.keydown({ code: 'KeyC', key: 'c', metaKey: true });
  target.keydown({ code: 'Enter', key: 'Enter' });
  assert.deepEqual(input.typed, []);
  input.endFrame();
  assert.deepEqual(input.typed, []);
});

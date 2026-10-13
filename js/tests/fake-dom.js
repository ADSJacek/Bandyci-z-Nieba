// Minimalna atrapa DOM i canvasu, żeby moduły rysujące dało się zaimportować
// i wywołać w Node. Każda właściwość kontekstu to „pusta” funkcja zwracająca
// tę samą atrapę (np. gradient z addColorStop); w działaniach liczbowych daje 0.
export const fakeContext = new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === 'then') return undefined; // nie udajemy obietnicy
    return fakeContext;
  },
  set: () => true,
  apply: () => fakeContext,
});

export function installFakeDom() {
  globalThis.document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
  };
  globalThis.Image ??= class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = '';
    }
  };
}

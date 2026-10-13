// Odtwarzanie encji z zapisu (JSON). Rzuca wyjątek przy brakującym lub
// nieliczbowym polu — restoreGame łapie go i odrzuca cały zapis.
export function revive(Class, data, numberKeys) {
  if (!data || typeof data !== 'object') throw new Error(`${Class.name}: brak danych`);
  for (const key of numberKeys) {
    if (!Number.isFinite(data[key])) throw new Error(`${Class.name}: niepoprawne pole ${key}`);
  }
  return Object.assign(Object.create(Class.prototype), structuredClone(data));
}

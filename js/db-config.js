// Połączenie z Supabase. Klucz „publishable” / „anon” jest z założenia publiczny —
// dostęp do danych ograniczają RLS i funkcje w bazie (supabase/migrations/).
// Puste wartości = gra działa offline (rekordy i zapis gry tylko lokalnie).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Połączenie z Supabase. Klucz „publishable” / „anon” jest z założenia publiczny —
// dostęp do danych ograniczają RLS i funkcje w bazie (supabase/migrations/).
// Puste wartości = gra działa offline (rekordy i zapis gry tylko lokalnie).
export const SUPABASE_URL = 'https://upjsigdipbbjizvtnckl.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ee8vqrP3CLEEw_7I1xgvIA_kZ5_SBso';

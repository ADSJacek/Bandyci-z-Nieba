// Testy E2E w przeglądarce (Playwright). Uruchomienie: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // Gra rysuje canvas co klatkę (w headless na CPU) — więcej przeglądarek naraz
  // przeciąża procesor i testy przekraczają limit czasu
  workers: 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 750 } } }],
  webServer: {
    command: `npx serve -l ${PORT} .`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
});

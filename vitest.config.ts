import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Startup wiring: its failure paths are checked by hand and in CI, see README.
      exclude: ['src/main.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      // Floor just under the measured baseline (99.6 / 94.1 / 100 / 100): a regression guard.
      thresholds: { statements: 90, branches: 85, functions: 95, lines: 90 },
    },
  },
});

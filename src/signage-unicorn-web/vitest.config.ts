import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for the framework-free helpers under lib/ (api-fetch, device-token, player-sync).
// jsdom provides localStorage/sessionStorage/window; fetch is stubbed per test.
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['lib/**/*.test.ts', 'features/**/*.test.ts'],
        testTimeout: 5000,
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('.', import.meta.url)),
        },
    },
});

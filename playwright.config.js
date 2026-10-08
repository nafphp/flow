import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:18743', headless: true },
    webServer: {
        command: 'php -S 127.0.0.1:18743 -t tests/Fixtures/public tests/Fixtures/public/index.php',
        url: 'http://127.0.0.1:18743/',
        reuseExistingServer: false,
        timeout: 15000,
        env: { APP_ENV: 'test' },
    },
});

// Shared test environment: local providers only, a fixed encryption key, no network.
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.EMAIL_PROVIDER = 'outbox';
process.env.STORAGE_PROVIDER = 'local';
process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? '.data/test-files';
process.env.APP_URL = 'http://localhost:3000';
// 32 bytes of zeros, base64. Test-only.
process.env.APP_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.CRON_SECRET = 'test-cron-secret';

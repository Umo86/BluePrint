import { afterEach, describe, expect, it } from 'vitest';
import { env, localProductionAllowed, resetEnvCache } from '@/server/env';

const saved = { ...process.env };

afterEach(() => {
  for (const k of ['BLUEPRINT_ALLOW_LOCAL_PRODUCTION', 'VERCEL', 'NODE_ENV', 'APP_URL', 'EMAIL_PROVIDER', 'STORAGE_PROVIDER', 'DATABASE_URL']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

describe('trying a production build locally', () => {
  it('relaxes the rules only on this computer, and never on Vercel', () => {
    process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION = 'true';
    expect(localProductionAllowed('http://localhost:3200')).toBe(true);
    expect(localProductionAllowed('http://127.0.0.1:3000')).toBe(true);
    expect(localProductionAllowed('https://blueprint.media10.co.uk')).toBe(false);
    expect(localProductionAllowed('https://localhost.evil.example')).toBe(false);
    process.env.VERCEL = '1';
    expect(localProductionAllowed('http://localhost:3200')).toBe(false);
    delete process.env.VERCEL;
    delete process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION;
    expect(localProductionAllowed('http://localhost:3200')).toBe(false);
  });

  it('refuses to start a live site with missing settings, whatever the switch says', () => {
    Object.assign(process.env, { NODE_ENV: 'production', BLUEPRINT_ALLOW_LOCAL_PRODUCTION: 'true', APP_URL: 'https://blueprint.media10.co.uk', EMAIL_PROVIDER: 'outbox', STORAGE_PROVIDER: 'local' });
    delete process.env.DATABASE_URL;
    resetEnvCache();
    expect(() => env()).toThrow(/Missing required production settings/);
  });
});

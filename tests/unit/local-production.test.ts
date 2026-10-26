import { afterEach, describe, expect, it } from 'vitest';
import { emailMode, env, localProductionAllowed, resetEnvCache, storageMode } from '@/server/env';

const saved = { ...process.env };

afterEach(() => {
  for (const k of [
    'BLUEPRINT_ALLOW_LOCAL_PRODUCTION',
    'VERCEL',
    'NODE_ENV',
    'APP_URL',
    'EMAIL_PROVIDER',
    'STORAGE_PROVIDER',
    'DATABASE_URL',
    'APP_ENCRYPTION_KEY',
    'CRON_SECRET',
    'RESEND_API_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

function withAddress(url: string | undefined) {
  if (url === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = url;
  return localProductionAllowed();
}

describe('trying a production build locally', () => {
  it('relaxes the rules only on this computer, and never on Vercel', () => {
    process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION = 'true';
    expect(withAddress('http://localhost:3200')).toBe(true);
    expect(withAddress('http://127.0.0.1:3000')).toBe(true);
    expect(withAddress('https://blueprint.media10.co.uk')).toBe(false);
    expect(withAddress('https://localhost.evil.example')).toBe(false);
    // A missing address is not "this computer", even though the app would default to localhost.
    expect(withAddress(undefined)).toBe(false);
    process.env.VERCEL = '1';
    expect(withAddress('http://localhost:3200')).toBe(false);
    delete process.env.VERCEL;
    delete process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION;
    expect(withAddress('http://localhost:3200')).toBe(false);
  });

  it('refuses to start a live site with missing settings, whatever the switch says', () => {
    Object.assign(process.env, { NODE_ENV: 'production', BLUEPRINT_ALLOW_LOCAL_PRODUCTION: 'true', APP_URL: 'https://blueprint.media10.co.uk', EMAIL_PROVIDER: 'outbox', STORAGE_PROVIDER: 'local' });
    delete process.env.DATABASE_URL;
    resetEnvCache();
    expect(() => env()).toThrow(/Missing required production settings/);
  });

  it('needs the site address to be set on a live site', () => {
    Object.assign(process.env, { NODE_ENV: 'production', EMAIL_PROVIDER: 'outbox', STORAGE_PROVIDER: 'local' });
    delete process.env.APP_URL;
    delete process.env.BLUEPRINT_ALLOW_LOCAL_PRODUCTION;
    resetEnvCache();
    expect(() => env()).toThrow(/APP_URL/);
  });
});

describe('a live site before email and file storage are set up', () => {
  const live = {
    NODE_ENV: 'production',
    APP_URL: 'https://blueprint.media10.co.uk',
    DATABASE_URL: 'postgres://user:pass@db.example/blueprint',
    APP_ENCRYPTION_KEY: 'k'.repeat(44),
    CRON_SECRET: 'c'.repeat(64),
    EMAIL_PROVIDER: 'resend',
    STORAGE_PROVIDER: 'r2',
    R2_BUCKET: 'blueprint-files',
  };
  const clear = () => {
    for (const k of ['RESEND_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BLUEPRINT_ALLOW_LOCAL_PRODUCTION', 'VERCEL']) delete process.env[k];
  };

  it('starts, with email and uploads switched off rather than kept on the server', () => {
    clear();
    Object.assign(process.env, live);
    resetEnvCache();
    expect(() => env()).not.toThrow();
    expect(emailMode()).toBe('off');
    expect(storageMode()).toBe('off');
    // Asking for the local outbox or local disk on a live site does not change that.
    Object.assign(process.env, { EMAIL_PROVIDER: 'outbox', STORAGE_PROVIDER: 'local' });
    resetEnvCache();
    expect(emailMode()).toBe('off');
    expect(storageMode()).toBe('off');
  });

  it('switches each on once its settings are in', () => {
    clear();
    Object.assign(process.env, live, { RESEND_API_KEY: 're_test', R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret' });
    resetEnvCache();
    expect(emailMode()).toBe('resend');
    expect(storageMode()).toBe('r2');
  });

  it('still needs the database, the keys and the address', () => {
    for (const k of ['DATABASE_URL', 'APP_ENCRYPTION_KEY', 'CRON_SECRET'] as const) {
      clear();
      Object.assign(process.env, live);
      delete process.env[k];
      resetEnvCache();
      expect(() => env()).toThrow(new RegExp(k));
    }
  });

  it('keeps the outbox and local disk for development and for a production build tried locally', () => {
    clear();
    Object.assign(process.env, { NODE_ENV: 'production', BLUEPRINT_ALLOW_LOCAL_PRODUCTION: 'true', APP_URL: 'http://localhost:3200', EMAIL_PROVIDER: 'outbox', STORAGE_PROVIDER: 'local' });
    resetEnvCache();
    expect(emailMode()).toBe('outbox');
    expect(storageMode()).toBe('local');
  });
});

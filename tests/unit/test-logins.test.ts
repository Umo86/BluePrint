import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { testLogins } from '@/server/test-logins';

const keys = ['TEST_LOGINS', 'TEST_LOGIN_EMAIL', 'TEST_LOGIN_PASSWORD'] as const;

function withEnv(values: Partial<Record<(typeof keys)[number], string>>) {
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, values);
  resetEnvCache();
}

afterEach(() => withEnv({}));

describe('test logins for the sign-in page', () => {
  it('lists none unless they are set', () => {
    withEnv({});
    expect(testLogins()).toEqual([]);
  });

  it('shows the single test login as the super admin, then the others, once each', () => {
    withEnv({
      TEST_LOGIN_EMAIL: 'admin@example.test',
      TEST_LOGIN_PASSWORD: 'first password',
      TEST_LOGINS: JSON.stringify([
        { role: 'Show admin', email: 'Show.Admin@Example.test', password: 'second password' },
        { role: 'Duplicate', email: 'admin@example.test', password: 'ignored' },
        { role: 'Broken', email: 'not an email', password: 'x' },
      ]),
    });
    expect(testLogins()).toEqual([
      { role: 'Super admin', email: 'admin@example.test', password: 'first password' },
      { role: 'Show admin', email: 'show.admin@example.test', password: 'second password' },
    ]);
  });

  it('ignores a value that is not JSON instead of breaking the page', () => {
    withEnv({ TEST_LOGINS: '[{"role": "Show admin",' });
    expect(testLogins()).toEqual([]);
  });
});

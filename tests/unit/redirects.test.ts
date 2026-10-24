import { describe, expect, it } from 'vitest';
import { isAllowedPaymentRedirect, localPath } from '@/lib/safe-redirect';

describe('sending people back to where they were', () => {
  it('keeps paths on this site', () => {
    expect(localPath('/portal/ukcw-london-2027')).toBe('/portal/ukcw-london-2027');
    expect(localPath('/manage/abc/orders?status=paid#top')).toBe('/manage/abc/orders?status=paid#top');
    expect(localPath('/')).toBe('/');
  });

  it('refuses anything a browser would read as another website', () => {
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '\t//evil.example',
      '/.//evil.example',
      '/..//evil.example',
      '/%2e//evil.example',
      '/a/..//evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'evil.example',
      ' /portal',
      '/\u0000x',
      `/${'a'.repeat(600)}`,
      '',
      null,
      undefined,
    ]) {
      expect(localPath(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('normalises the path it returns', () => {
    expect(localPath('/a/../b')).toBe('/b');
    expect(localPath('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });
});

describe('after starting a payment', () => {
  it('allows this site and Stripe’s own pages only', () => {
    expect(isAllowedPaymentRedirect('/portal/x/orders/1')).toBe(true);
    expect(isAllowedPaymentRedirect('https://checkout.stripe.com/c/pay/cs_test_123')).toBe(true);
    expect(isAllowedPaymentRedirect('https://connect.stripe.com/setup/e/acct_1/abc')).toBe(true);
    for (const bad of [
      'https://checkout.stripe.com.evil.example/x',
      'http://checkout.stripe.com/x',
      'https://user:pass@checkout.stripe.com/x',
      'https://checkout.stripe.com:8443/x',
      '/\t/evil.example',
      '//evil.example',
      'https://evil.example',
    ]) {
      expect(isAllowedPaymentRedirect(bad), bad).toBe(false);
    }
  });
});

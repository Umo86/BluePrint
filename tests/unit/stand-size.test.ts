import { describe, expect, it } from 'vitest';
import { standSize } from '@/lib/format';
import { emptyStandForm, formArea, standFormValues } from '@/lib/stand-form';

describe('stand sizes', () => {
  it('says the size the way people do', () => {
    expect(standSize({ widthM: '6.00', depthM: '3.00', sizeSqm: '18.00' })).toBe('6 m × 3 m (18 sqm)');
    expect(standSize({ widthM: 12.5, depthM: 8, sizeSqm: 100 })).toBe('12.5 m × 8 m (100 sqm)');
    expect(standSize({ sizeSqm: '1250.00' })).toBe('1,250 sqm');
    expect(standSize({ widthM: null, depthM: null, sizeSqm: null })).toBe('');
    expect(standSize({ widthM: '6.00', depthM: null, sizeSqm: '18.00' })).toBe('18 sqm');
  });

  it('works out the area in the stand form', () => {
    expect(formArea({ widthM: 6, depthM: 3, sizeSqm: 20 })).toBe(18);
    expect(formArea({ widthM: 2.35, depthM: 3.1, sizeSqm: null })).toBe(7.29);
    expect(formArea({ widthM: 6, depthM: null, sizeSqm: 20 })).toBe(20);
    expect(formArea(emptyStandForm(null))).toBeNull();
    expect(
      standFormValues({ number: 'A1', exhibitorTypeId: 't', hallId: null, sizeSqm: '18.00', widthM: '6.00', depthM: '3.00', openSides: 2, notes: null }),
    ).toEqual({ number: 'A1', exhibitorTypeId: 't', hallId: null, sizeSqm: 18, widthM: 6, depthM: 3, openSides: 2, notes: '' });
  });
});

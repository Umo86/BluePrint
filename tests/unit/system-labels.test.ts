import { describe, expect, it } from 'vitest';
import { jobResultText } from '@/lib/system-labels';
import { spreadsheetDateTime } from '@/lib/format';

describe('scheduled job results', () => {
  it('says what a job did, leaving out counts of nothing', () => {
    expect(jobResultText('ok', { attempted: 4, sent: 3, failed: 1, campaignsQueued: 0, campaignProblems: [] })).toBe('3 emails sent, 1 email failed');
    expect(jobResultText('ok', { editions: 2, stands: 1, emails: 2, staffDigests: 0 })).toBe('2 reminder emails, 1 stand reminded');
    expect(jobResultText('ok', { checkoutsReleased: 0, payoutsSent: 1, sessionsRemoved: 12 })).toBe('1 supplier payout sent, 12 expired sign-ins removed');
    expect(jobResultText('ok', { attempted: 0, sent: 0 })).toBe('Nothing to do');
    expect(jobResultText('ok', { campaignProblems: ['Spring update: no one to send to'] })).toBe('problems: Spring update: no one to send to');
  });

  it('shows the error of a job that failed', () => {
    expect(jobResultText('error', { error: 'Database unavailable' })).toBe('Database unavailable');
    expect(jobResultText('error', {})).toBe('It stopped with an error.');
    expect(jobResultText('running', {})).toBe('Still running');
  });
});

describe('spreadsheet times', () => {
  it('writes London time in a form spreadsheets read as a date', () => {
    expect(spreadsheetDateTime(new Date('2027-07-01T12:34:00Z'))).toBe('2027-07-01 13:34');
    expect(spreadsheetDateTime(new Date('2027-01-15T09:05:00Z'))).toBe('2027-01-15 09:05');
    expect(spreadsheetDateTime(null)).toBe('');
  });
});

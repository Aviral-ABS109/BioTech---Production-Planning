import { describe, it, expect } from 'vitest';
import { unwrapError, isNoRecords, errorBody, parseAddResult } from '../src/api/creator.js';

describe('Creator error shapes', () => {
  it('plain object with code 3100 = no records', () => {
    expect(isNoRecords(unwrapError({ code: 3100, message: 'No records found' }))).toBe(true);
  });
  it('JSON string body', () => {
    const u = unwrapError('{"code":3100,"message":"No Data Available"}');
    expect(u.code).toBe(3100);
    expect(isNoRecords(u)).toBe(true);
  });
  it('XHR-like object with responseText', () => {
    const u = unwrapError({ status: 400, responseText: '{"code":3330,"message":"Invalid criteria"}' });
    expect(u).toMatchObject({ code: 3330, message: 'Invalid criteria' });
    expect(isNoRecords(u)).toBe(false);
  });
  it('unknown object keeps raw text for debugging', () => {
    const u = unwrapError({ foo: 'bar' });
    expect(u.raw).toContain('foo');
  });
  it('rejected addRecords body still yields per-row errors', () => {
    const body = errorBody({ responseText: '{"code":3001,"result":[{"code":3002,"error":{"Market":"Invalid value"}}]}' });
    expect(parseAddResult(body, 1)[0]).toEqual({ ok: false, error: 'Market: Invalid value' });
  });
});

describe('workflow alerts', () => {
  it('reads alert_message from a rejected record', () => {
    const [r] = parseAddResult({ code: 3000, result: [{ code: 3002, error: { alert_message: ['Country entered twice in Country Demand'] } }] }, 1);
    expect(r).toEqual({ ok: false, error: 'Country entered twice in Country Demand' });
  });
});

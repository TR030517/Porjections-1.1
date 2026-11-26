import { isRetryableTransactionError } from './transaction-retry';

describe('structured transaction conflict boundary', () => {
  test.each([{ code: 'P2034' }, { code: 'P2010', meta: { code: '1213' } }, { code: 'P2010', meta: { code: 1213 } },
    { code: 'P2010', meta: { code: '1205' } }, { code: 'P2010', meta: { code: 1205 } }])('accepts the known ORM/MySQL lock conflict %p', error => {
    expect(isRetryableTransactionError(error)).toBe(true);
  });
  test.each([null, undefined, 'deadlock 1213', { message: 'P2034 deadlock 1213' }, { code: '1213' }, { code: 'P2002', meta: { code: '1213' } },
    { code: 'P2010', meta: { code: '1062' } }, { code: 'P2010', meta: { code: ' 1213' } }, { code: 'P2010', meta: '1213' },
    { code: 'P2010', meta: { code: { toString: (): string => '1213' } } }])('keeps every other failure non-retryable %p', error => {
    expect(isRetryableTransactionError(error)).toBe(false);
  });
});

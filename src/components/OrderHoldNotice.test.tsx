import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import OrderHoldNotice from './OrderHoldNotice';

const deadline = '2035-11-07T15:00:00Z', now = Date.parse(deadline) - 1000;
const settlement = { status: 'PENDING', paymentStatus: 'UNPAID', paidCents: 0, paymentMode: 'PAY_AT_STORE' };
const format = (value: string) => { assert.equal(value, deadline); return '2035-11-07 10:00 · America/New_York'; };

test('the shared notice uses shop-time formatting with distinct active acceptance/payment titles', () => {
  const acceptance = renderToStaticMarkup(<OrderHoldNotice holdExpiresAt={deadline} settlements={settlement} formatDeadline={format} nowMs={now} />);
  const payment = renderToStaticMarkup(<OrderHoldNotice holdExpiresAt={deadline} settlements={{ ...settlement, paymentMode: 'ONLINE' }} formatDeadline={format} nowMs={now} />);
  assert.match(acceptance, /待接受截止/); assert.match(payment, /付款临时保留截止/);
  assert.match(acceptance, /America\/New_York/); assert.match(acceptance, /datetime="2035-11-07T15:00:00Z"/i); assert.match(acceptance, /aria-live="polite"/);
  assert.doesNotMatch(acceptance, /（历史）|已取消|已释放/);
});

test('terminal and confirmed order SSR never labels the old deadline as a current hold', () => {
  for (const status of ['CANCELLED', 'CONFIRMED', 'COMPLETED', 'REFUNDING', 'REFUNDED']) {
    const html = renderToStaticMarkup(<OrderHoldNotice holdExpiresAt={deadline} settlements={{ ...settlement, status }} formatDeadline={format} nowMs={now} />);
    assert.match(html, /原待接受截止（历史）/); assert.match(html, /历史记录，不表示当前资源占用/);
    assert.doesNotMatch(html, /ACTIVE_|当前预占|已释放|没有占用/);
  }
});

test('expired pending notice requests a server refresh without claiming cancellation or release; invalid and absent dates stay safe', () => {
  const expired = renderToStaticMarkup(<OrderHoldNotice holdExpiresAt={deadline} settlements={settlement} formatDeadline={format} nowMs={now + 1000} />);
  assert.match(expired, /临时预留期限已到，请刷新核对预约结果/); assert.doesNotMatch(expired, /已取消|已释放|ACTIVE_/);
  const invalid = renderToStaticMarkup(<OrderHoldNotice holdExpiresAt="unverified-date" settlements={settlement} formatDeadline={() => { throw new Error('Invalid date must not reach formatter'); }} nowMs={now} />);
  assert.match(invalid, /无法核对/); assert.doesNotMatch(invalid, /unverified-date|<time/);
  for (const value of [undefined, null]) assert.equal(renderToStaticMarkup(<OrderHoldNotice holdExpiresAt={value} settlements={settlement} formatDeadline={format} nowMs={now} />), '');
});

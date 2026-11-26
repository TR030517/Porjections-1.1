import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storeAccountSummary } from './storeAccountStatus';
import type { StoreItem } from '../components/store/types';
type AccountRow = Parameters<typeof storeAccountSummary>[0];
const bound: AccountRow = { id: '9007199254740993', accountBindingStatus: 'BOUND', loginBinding: { shopId: '9007199254740993', userId: '9007199254740995' }, loginAccount: { id: '9007199254740995', loginName: 'synthetic-shop', email: null, name: 'Synthetic shop account', status: 'ACTIVE' } };

test('a returned store binding is shown without consulting another global account snapshot', () => {
  assert.deepEqual(storeAccountSummary(bound), { state: 'BOUND', label: '已绑定 · synthetic-shop' });
  const next = { ...bound, id: '9007199254740997', loginBinding: { ...bound.loginBinding!, shopId: '9007199254740997' } };
  assert.equal(storeAccountSummary(next).label, '已绑定 · synthetic-shop');
  const historical = { ...bound, ownerId: '42', sysAccount: 'stale-historical-account' };
  assert.equal(storeAccountSummary(historical).label, '已绑定 · synthetic-shop', 'historical ownership never becomes a login binding');
});
test('only explicit consistent absence is unbound; missing or contradictory fields remain unknown', () => {
  assert.deepEqual(storeAccountSummary({ id: '1', accountBindingStatus: 'UNBOUND', loginBinding: null, loginAccount: null }), { state: 'UNBOUND', label: '独立账号待绑定' });
  for (const row of [{ id: '1' }, { id: '1', accountBindingStatus: 'UNBOUND' }, { ...bound, accountBindingStatus: 'UNBOUND' }, { ...bound, loginBinding: null }, { ...bound, accountBindingStatus: undefined }, { ...bound, loginAccount: null }]) {
    const result = storeAccountSummary(row as AccountRow);
    assert.equal(result.state, 'UNKNOWN'); assert.match(result.label, /待核对/); assert.doesNotMatch(result.label, /待绑定/);
  }
});
test('binding identities preserve exact large integers and reject foreign shop or account metadata', () => {
  for (const row of [
    { ...bound, id: 9007199254740992 },
    { ...bound, loginBinding: { ...bound.loginBinding!, shopId: '9007199254740994' } },
    { ...bound, loginAccount: { ...bound.loginAccount!, id: '9007199254740996' } },
    { ...bound, loginBinding: { ...bound.loginBinding!, userId: '9223372036854775808' } },
  ]) assert.deepEqual(storeAccountSummary(row), { state: 'UNKNOWN', label: '登录绑定待核对' });
});
test('suspended and deleted accounts retain the binding while describing their actual account status', () => {
  for (const [status, expected] of [['SUSPENDED', '账号已停用'], ['DELETED', '账号已删除']]) {
    const result = storeAccountSummary({ ...bound, loginAccount: { ...bound.loginAccount!, status } });
    assert.equal(result.state, 'BOUND'); assert.match(result.label, new RegExp(expected)); assert.doesNotMatch(result.label, /待绑定/);
  }
  const unknownStatus = storeAccountSummary({ ...bound, loginAccount: { ...bound.loginAccount!, status: undefined } });
  assert.match(unknownStatus.label, /账号状态待核对/); assert.doesNotMatch(unknownStatus.label, /已停用|已删除/);
});
test('email aliases and incomplete identifiers remain separate from login readiness', () => {
  assert.match(storeAccountSummary({ ...bound, loginAccount: { ...bound.loginAccount!, loginName: null, email: 'synthetic@example.test' } }).label, /synthetic@example.test/);
  const missingAlias = storeAccountSummary({ ...bound, loginAccount: { ...bound.loginAccount!, loginName: null, email: null, name: null } });
  assert.match(missingAlias.label, /账号 #9007199254740995/); assert.match(missingAlias.label, /登录标识待完善/);
  for (const row of [bound, { ...bound, publicVisible: true, publicationReady: true } as StoreItem]) assert.doesNotMatch(storeAccountSummary(row).label, /可登录|登录就绪|登录条件已/);
});

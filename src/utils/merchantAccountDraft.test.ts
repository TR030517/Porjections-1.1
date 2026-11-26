import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMerchantAccountDraft, merchantAccountCreatePayload } from './merchantAccountDraft';
import { buildOperationPayload } from './operationForm';
import { operations } from '../config/operations';

test('ordinary merchant creation requires email and automatically creates its internal identifier and mixed eight-character password', () => {
  const config = operations['merchant-list'];
  assert.ok(config.fields?.find(f => f.key === 'email')?.required);
  assert.ok(!config.fields?.some(f => f.key === 'loginName'));
  for (let i = 0; i < 50; i++) {
    const draft = newMerchantAccountDraft();
    assert.match(draft.loginName, /^shop-[a-z0-9]{24}$/);
    assert.match(draft.password, /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/);
    const payload = buildOperationPayload(config.fields!, { ...draft, name: 'Synthetic', email: ' Name@example.invalid ', phone: '' }, false);
    assert.equal(merchantAccountCreatePayload(payload, draft.loginName).email, 'name@example.invalid');
    assert.equal(merchantAccountCreatePayload(payload, draft.loginName).loginName, draft.loginName);
  }
});
test('six-character manual merchant passwords are accepted, five are rejected, and other account policies remain unchanged', () => {
  const fields = operations['merchant-list'].fields!;
  const form = { name: 'Synthetic', email: 'one@example.invalid', phone: '', password: '123456' };
  assert.equal(buildOperationPayload(fields, form, false).password, '123456');
  assert.throws(() => buildOperationPayload(fields, { ...form, password: '12345' }, false));
  assert.throws(() => merchantAccountCreatePayload({ ...form, email: '' }, newMerchantAccountDraft().loginName));
  assert.throws(() => merchantAccountCreatePayload(form, 'user-supplied-account'));
  assert.throws(() => buildOperationPayload([{ key: 'password', type: 'password', label: 'Password', required: true }], form, false));
});

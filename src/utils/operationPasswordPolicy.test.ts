import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operations } from '../config/operations';
import { buildOperationPayload, operationFieldMinLength } from './operationForm';
import { ownPasswordError } from './accountSecurity';

const form = (password: string) => ({ name: 'Synthetic policy account', email: 'policy@example.invalid', phone: '+12025550123', password });
const adminFields = operations['admin-list'].fields!;

test('administrator creation UI uses UTF-8 bytes for 6–11, 12, 72 and oversized input', () => {
  for (let bytes = 6; bytes < 12; bytes++) assert.throws(() => buildOperationPayload(adminFields, form('a'.repeat(bytes)), false), /12–72/);
  for (const password of ['a'.repeat(12), 'a'.repeat(72), '密'.repeat(4), '密'.repeat(24), '😀'.repeat(3)]) {
    assert.equal(buildOperationPayload(adminFields, form(password), false).password, password);
    assert.equal(ownPasswordError('ADMIN', 'ExistingPolicyPassword', password, password), '');
  }
  for (const password of ['a'.repeat(73), '密'.repeat(25), '😀'.repeat(19), 'abcdefghijk\n', 'abcdefghijk\0']) {
    assert.throws(() => buildOperationPayload(adminFields, form(password), false), /12–72/);
    assert.notEqual(ownPasswordError('ADMIN', 'ExistingPolicyPassword', password, password), '');
  }
});

test('password inputs do not apply the incompatible browser UTF-16 minlength', () => {
  const password = adminFields.find(field => field.type === 'password')!;
  assert.equal(password.passwordRole, 'ADMIN');
  assert.match(password.hint!, /12–72.*UTF-8/);
  assert.equal(operationFieldMinLength(password), undefined);
  assert.equal(operationFieldMinLength({ key: 'name', label: 'Name', minLength: 3 }), 3);
  assert.equal(operationFieldMinLength(operations['merchant-list'].fields!.find(field => field.type === 'password')!), undefined);
});

test('merchant six-byte rules and customer creation identity remain distinct from administrator rules', () => {
  for (const module of ['merchant-list', 'user-list']) {
    const fields = operations[module].fields!;
    assert.equal(buildOperationPayload(fields, form('123456'), false).password, '123456');
    assert.equal(buildOperationPayload(fields, form('密密'), false).password, '密密');
    assert.throws(() => buildOperationPayload(fields, form('12345'), false), /6–72/);
  }
  assert.equal(ownPasswordError('MERCHANT', 'ExistingPassword', '123456', '123456'), '');
  assert.match(ownPasswordError('STAFF', 'ExistingPassword', '123456', '123456'), /12–72/);
});

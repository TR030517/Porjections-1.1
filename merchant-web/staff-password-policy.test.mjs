import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import axios from 'axios';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const matrix = require('../backend/test/staff-password-policy.matrix.cjs');
const file = readFileSync(new URL('./src/pages/staff/index.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('staff.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let passwordField, validator;
function visit(node) {
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'Form.Item' && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'name' && attribute.initializer?.text === 'password')) passwordField = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(passwordField, 'The staff create form must retain its real password field');
function findValidator(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'validator') validator = node.initializer;
  ts.forEachChild(node, findValidator);
}
findValidator(passwordField);
assert.ok(validator && ts.isArrowFunction(validator), 'Use the actual Ant Design field validator, not a test-only policy copy');
const validatorJs = ts.transpileModule('const validate = ' + validator.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

test('the actual STAFF form validator accepts UTF-8 boundaries and rejects NUL/CR/LF without changing raw input', async t => {
  const server = await createServer({ configFile: false, cacheDir: process.env.MJ2_STAFF_VITE_CACHE_DIR || 'node_modules/.vite-staff-policy', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { passwordPolicyError } = await server.ssrLoadModule(fileURLToPath(new URL('../backend/src/common/password-policy.ts', import.meta.url)));
    const validate = new Function('passwordPolicyError', validatorJs + '\nreturn validate;')(passwordPolicyError);
    for (const row of matrix) await t.test(row.name, async () => {
      assert.equal(Buffer.byteLength(row.value, 'utf8'), row.bytes);
      if (row.accepted) await validate(undefined, row.value);
      else await assert.rejects(validate(undefined, row.value), /12–72个UTF-8字节且不可包含空字符或换行/);
    });
    assert.doesNotMatch(passwordField.getText(ast), /value\.length|至少12个字符|minLength|maxLength/, 'HTML or character-count gates must not override the byte contract');
    assert.match(file, /password:\s*values\.password\s*,/, 'The submit path must pass the original password unchanged');
  } finally { await server.close(); }
});

test('the real staff transport serializes every accepted raw password unchanged', async () => {
  const submitted = [];
  axios.defaults.adapter = async config => {
    const body = JSON.parse(config.data); submitted.push(body.password);
    return { config, headers: {}, status: 201, statusText: 'Created', data: { shopId: '71', userId: '5', name: body.name, email: body.email, phone: body.phone,
      accountStatus: 'ACTIVE', status: 'ACTIVE', permissions: body.permissions, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', revokedAt: null } };
  };
  const server = await createServer({ configFile: false, cacheDir: process.env.MJ2_STAFF_VITE_CACHE_DIR || 'node_modules/.vite-staff-policy', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { createStaff } = await server.ssrLoadModule('/src/api/staff.ts');
    for (const row of matrix.filter(row => row.accepted)) await createStaff('71', { name: 'Synthetic staff', email: 'staff@example.invalid', phone: '+12025550123', password: row.value, permissions: ['BOOKINGS_READ'] });
    assert.deepEqual(submitted, matrix.filter(row => row.accepted).map(row => row.value));
  } finally { await server.close(); }
});

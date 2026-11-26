import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProjectMetadataPatch, buildProjectMetadataPayload, projectMetadataDraft, projectMetadataFingerprint, projectMetadataPriceCents, projectMetadataSourceKey, verifyProjectMetadataReceipt, type ProjectMetadataSource } from './projectMetadata';

const source: ProjectMetadataSource = { id: '9007199254740993', shopId: '9007199254740995', name: 'Body Massage', category: 'MASSAGE', description: 'Saved details', isActive: true, durationKind: 'TIMED', durationMin: 60, priceCents: 8000, hasVariants: false, variantCount: 0 };
const withVariants: ProjectMetadataSource = { ...source, hasVariants: true, variantCount: 2, durationMin: 15, priceCents: 0 };

test('editing a description preserves a concurrent price change and pause, and adopts their returned values', () => {
  const patch = buildProjectMetadataPatch(source, { ...projectMetadataDraft(source), description: 'New details' });
  const server = { ...source, priceCents: 9500, durationMin: 90, isActive: false };
  const saved = { ...server, ...patch };
  assert.deepEqual(saved, { ...server, description: 'New details' });
  assert.deepEqual(verifyProjectMetadataReceipt(saved, source, patch), saved);
  assert.deepEqual(buildProjectMetadataPatch(source, { ...projectMetadataDraft(source), price: '80', durationMin: '060', name: ' Body Massage ' }), {});
  assert.throws(() => verifyProjectMetadataReceipt({ ...saved, description: source.description }, source, patch), /回执/);
});

test('metadata PATCH contains only the explicitly editable existing-project fields', () => {
  const draft = { ...projectMetadataDraft(source), name: '  Revised project  ', description: 'New note\r\nSecond line', durationMin: '90', price: '81.03', isActive: false,
    shopId: '999', ownerId: '999', participantCount: 2, requiredStaffCount: 2, priceBasis: 'PER_PERSON', staffBufferMin: 120, sortOrder: 999 };
  const before = structuredClone(source), payload = buildProjectMetadataPayload(source, draft);
  assert.deepEqual(payload, { name: 'Revised project', category: 'MASSAGE', description: 'New note\nSecond line', isActive: false, durationKind: 'TIMED', durationMin: 90, priceCents: 8103 });
  assert.deepEqual(source, before);
  for (const key of ['id', 'shopId', 'ownerId', 'participantCount', 'requiredStaffCount', 'priceBasis', 'staffBufferMin', 'sortOrder', 'variants', 'addOns']) assert.equal(Object.hasOwn(payload, key), false);
});

test('an existing variant family never repairs or sends an invalid unused base amount, minutes or kind', () => {
  const legacy = { ...withVariants, durationKind: null, durationMin: null, priceCents: null } as ProjectMetadataSource;
  const draft = { ...projectMetadataDraft(legacy), name: 'Family title', price: '1e6', durationMin: '15', durationKind: 'not-a-kind' };
  assert.deepEqual(buildProjectMetadataPayload(legacy, draft), { name: 'Family title', category: 'MASSAGE', description: 'Saved details', isActive: true });
  assert.equal(projectMetadataSourceKey(withVariants), projectMetadataSourceKey({ ...withVariants, durationMin: 0, priceCents: 999999 }), 'unused base changes are not editable metadata changes');
  assert.equal(projectMetadataFingerprint(draft, true), projectMetadataFingerprint({ ...draft, price: '999', durationMin: '240' }, true));
});

test('strict USD values never round, coerce invalid fractions, or turn a missing legacy amount into free booking', () => {
  assert.equal(projectMetadataPriceCents('0.01'), 1); assert.equal(projectMetadataPriceCents('80.5'), 8050); assert.equal(projectMetadataPriceCents('999999.99'), 99999999);
  for (const value of ['', ' ', '0', '-1', '+1', '1e2', '$80', '80,50', '01.00', '0.001', '80.999', '1000000.00', '1000000.01', 'Infinity', 80, null]) assert.throws(() => projectMetadataPriceCents(value));
  const legacy = { ...source, category: null, durationKind: null, durationMin: null, priceCents: null } as ProjectMetadataSource;
  const draft = projectMetadataDraft(legacy);
  assert.equal(draft.category, ''); assert.equal(draft.durationKind, ''); assert.equal(draft.durationMin, ''); assert.equal(draft.price, '');
  assert.throws(() => buildProjectMetadataPayload(legacy, draft), /类别/);
  assert.throws(() => buildProjectMetadataPayload(legacy, { ...draft, category: 'MASSAGE' }), /类型/);
});

test('non-variant timed, per-session and variable projects require an explicit valid reservation block', () => {
  for (const durationKind of ['TIMED', 'PER_SESSION', 'VARIABLE']) {
    const draft = { ...projectMetadataDraft(source), durationKind, durationMin: '30', price: '50' };
    assert.equal(buildProjectMetadataPayload(source, draft).durationKind, durationKind);
    for (const durationMin of ['5', '15', '29', '30', '240']) assert.equal(buildProjectMetadataPayload(source, { ...draft, durationMin }).durationMin, Number(durationMin));
    for (const durationMin of ['', '0', '4', '241', '30.5', '1e2']) assert.throws(() => buildProjectMetadataPayload(source, { ...draft, durationMin }), /5–240/);
  }
  for (const patch of [{ name: '' }, { name: '<b>not text</b>' }, { category: 'BODY' }, { isActive: undefined }, { description: 'x'.repeat(10001) }]) assert.throws(() => buildProjectMetadataPayload(source, { ...projectMetadataDraft(source), ...patch } as never));
});

test('same-store exact receipt acknowledges all submitted fields and rejects mismatched identities or ignored edits', () => {
  const payload = buildProjectMetadataPayload(source, { ...projectMetadataDraft(source), price: '80.01' });
  const saved = { ...source, ...payload };
  assert.doesNotThrow(() => verifyProjectMetadataReceipt(saved, source, payload));
  for (const value of [{ ...saved, id: '9007199254740994' }, { ...saved, shopId: '9007199254740996' }, { ...saved, id: 9007199254740992 }, { ...saved, priceCents: 8000 }, { ...saved, isActive: false }, { ...saved, durationKind: 'VARIABLE' }]) assert.throws(() => verifyProjectMetadataReceipt(value, source, payload), /回执/);
  const metadata = buildProjectMetadataPayload(withVariants, { ...projectMetadataDraft(withVariants), name: 'Updated parent' });
  assert.doesNotThrow(() => verifyProjectMetadataReceipt({ ...withVariants, ...metadata, durationMin: 60, priceCents: 10000, reservedDurationMin: 60 }, withVariants, metadata), 'display-normalized unused base metadata does not invalidate a valid family receipt');
  assert.throws(() => verifyProjectMetadataReceipt({ ...withVariants, ...metadata, hasVariants: false }, withVariants, metadata), /规格状态/);
});

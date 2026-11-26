import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankDraft, buildStorePayload, buildStoreSavePayload, copyStoreHours, draftFingerprint, draftFromStore, emptyHours, WEEKDAYS } from './storeModel';
import type { StoreDraft, StoreItem } from './types';

function existingStore(): StoreItem {
  return {
    id: '9007199254740993', ownerId: '9007199254740995', name: 'Sample Studio', shortName: 'sample-studio', subtitle: 'Studio subtitle',
    status: 'APPROVED', timezone: 'America/New_York', phones: ['+1-555-0100'], emails: ['studio@example.test'],
    businessHours: { ...emptyHours(), '周一': { open: true, start: '09:00', end: '18:00' } },
    address: 'Test Street', city: 'Sample City', state: 'NY', zipCode: '10001', latitude: 40.7, longitude: -74,
    logo: 'S', logoUrl: 'https://example.test/logo.png', bannerUrl: 'https://example.test/banner.jpg',
    gallery: ['https://example.test/room-1.jpg', 'https://example.test/room-2.jpg'], videoUrl: 'https://example.test/studio.mp4',
    about: 'An existing studio description.', tags: ['Massage', 'Wellness'], mapShareUrl: 'https://example.test/map',
    priceMenuRevision: 'a'.repeat(64),
    features: { onlineBooking: true, reviews: true, onlinePayment: false, membershipCard: false },
    sysAccount: 'owner@example.test', reviewComment: 'Recorded review', publicationReady: true,
  };
}
const admin = (editing: StoreItem | null = existingStore()) => ({ isStoreManager: false, editing });

test('explicit day copy preserves split periods and untouched days without shared mutable values', () => {
  const original = emptyHours();
  original['周一'] = { open: true, start: '09:00', end: '12:00', periods: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] };
  original['周日'] = { open: true, start: '10:00', end: '16:00' };
  const before = structuredClone(original);
  const copied = copyStoreHours(original, '周一', ['周二', '周三', '周二']);
  assert.deepEqual(original, before);
  assert.deepEqual(copied['周日'], original['周日']);
  assert.deepEqual(copied['周二'].periods, original['周一'].periods);
  copied['周二'].periods![1].start = '15:00';
  assert.equal(copied['周三'].periods![1].start, '14:00');
  assert.equal(copied['周一'].periods![1].start, '14:00');
  assert.equal(original['周一'].periods![1].start, '14:00');
});

test('copying a rest day clears obsolete intervals only on selected days', () => {
  const hours = emptyHours();
  hours['周一'] = { open: false, start: '09:00', end: '18:00', periods: [{ start: '09:00', end: '12:00' }] };
  hours['周二'] = { open: true, start: '10:00', end: '17:00' };
  const copied = copyStoreHours(hours, '周一', ['周二']);
  assert.deepEqual(copied['周二'], { open: false, start: '', end: '' });
  assert.equal(hours['周二'].open, true);
  assert.deepEqual(copied['周一'], hours['周一']);
});

test('day copy rejects incomplete or overlapping source hours before replacing any target', () => {
  const hours = emptyHours();
  hours['周一'] = { open: true, start: '09:00', end: '' };
  const before = structuredClone(hours);
  assert.throws(() => copyStoreHours(hours, '周一', ['周二']), /完整/);
  assert.deepEqual(hours, before);
  hours['周一'] = { open: true, start: '09:00', end: '15:00', periods: [{ start: '09:00', end: '15:00' }, { start: '14:00', end: '18:00' }] };
  assert.throws(() => copyStoreHours(hours, '周一', ['周二']), /重叠/);
  for (const targets of [[], ['周一'], ['Unknown']]) assert.throws(() => copyStoreHours(hours, '周一', targets), /目标日/);
});
test('split opening periods survive unrelated edits without mutating the saved record', () => {
  const store = existingStore();
  store.businessHours['周一'] = { open: true, start: '09:00', end: '12:00', periods: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] };
  const draft = draftFromStore(store); draft.subtitle = 'Updated introduction';
  const payload = buildStorePayload(draft, admin(store));
  assert.deepEqual((payload.businessHours as StoreDraft['businessHours'])['周一'].periods, store.businessHours['周一'].periods);
  draft.businessHours['周一'].periods![1].start = '15:00';
  assert.equal(store.businessHours['周一'].periods![1].start, '14:00');
});
test('overlapping split opening periods cannot be saved', () => {
  const draft = draftFromStore(existingStore());
  draft.businessHours['周一'].periods = [{ start: '09:00', end: '14:00' }, { start: '13:00', end: '18:00' }];
  assert.throws(() => buildStorePayload(draft, admin()), /不能重叠/);
});
function pendingDraft(): StoreDraft { return { ...blankDraft(), ownerId: '9007199254740995', name: 'Pending studio', shortName: 'pending-studio' }; }

test('new drafts leave unknown details empty and independently default every day to 9 AM–10 PM', () => {
  const first = blankDraft(); const second = draftFromStore(null);
  assert.deepEqual(first, second);
  assert.deepEqual([first.timezone, first.latitude, first.longitude, first.gallery, first.bannerUrl], ['', '', '', '', '']);
  assert.equal(first.onlineBooking, false);
  for (const day of WEEKDAYS) assert.deepEqual(first.businessHours[day], { open: true, start: '09:00', end: '22:00' });
  first.businessHours['周一'].open = false;
  first.businessHours['周一'].start = '10:00';
  assert.deepEqual(second.businessHours['周一'], { open: true, start: '09:00', end: '22:00' });
  assert.equal(WEEKDAYS.length, 7);
});

test('location patches explicitly preserve the confirmed timezone through server inference, but unrelated patches omit it', () => {
  const store = existingStore();
  const draft = { ...draftFromStore(store), city: 'Seattle', state: 'Washington', zipCode: '98144' };
  const payload = buildStoreSavePayload(draft, admin(store));
  assert.deepEqual(payload, { city: 'Seattle', state: 'Washington', zipCode: '98144', timezone: 'America/New_York' });
  const reloaded = { ...store, ...payload } as StoreItem;
  const afterReload = { ...draftFromStore(reloaded), city: 'Tacoma', zipCode: '98402' };
  assert.equal(buildStoreSavePayload(afterReload, admin(reloaded)).timezone, 'America/New_York');
  const rematched = { ...afterReload, timezone: 'America/Los_Angeles' };
  assert.equal(buildStoreSavePayload(rematched, admin(reloaded)).timezone, 'America/Los_Angeles');
  const unrelated = buildStoreSavePayload({ ...draftFromStore(reloaded), subtitle: 'Updated' }, admin(reloaded));
  assert.deepEqual(unrelated, { subtitle: 'Updated' });
});

test('loading an existing record preserves unknown coordinates and deep-copies its saved hours', () => {
  const store = existingStore(); store.latitude = null; store.longitude = null;
  const draft = draftFromStore(store);
  assert.equal(draft.ownerId, '9007199254740995');
  assert.equal(draft.latitude, ''); assert.equal(draft.longitude, '');
  assert.equal(draft.reviewReason, 'Recorded review');
  draft.businessHours['周一'].start = '10:00';
  assert.equal(store.businessHours['周一'].start, '09:00');
});

test('publication and normal edits do not require or overwrite hidden coordinates or text logos', () => {
  const store = existingStore();
  const draft = draftFromStore(store);
  draft.status = 'APPROVED'; draft.latitude = ''; draft.longitude = ''; draft.logo = 'Historical text logo retained outside the editable form';
  const payload = buildStorePayload(draft, admin(store));
  assert.equal(payload.status, 'APPROVED');
  for (const field of ['latitude', 'longitude', 'logo']) assert.equal(Object.hasOwn(payload, field), false);
  assert.equal(payload.logoUrl, store.logoUrl);
  assert.equal(payload.address, store.address);
  assert.equal(store.latitude, 40.7);
  assert.equal(store.logo, 'S');
});

test('dirty detection ignores object insertion order but detects a real nested or text edit', () => {
  const draft = draftFromStore(existingStore());
  const reordered = Object.fromEntries(Object.entries(draft).reverse()) as unknown as StoreDraft;
  reordered.businessHours = Object.fromEntries(Object.entries(draft.businessHours).reverse());
  assert.equal(draftFingerprint(draft), draftFingerprint(reordered));
  assert.notEqual(draftFingerprint(draft), draftFingerprint({ ...draft, about: draft.about + ' ' }));
  const changed = draftFromStore(existingStore()); changed.businessHours['周一'].end = '19:00';
  assert.notEqual(draftFingerprint(draft), draftFingerprint(changed));
});

test('independent display menus survive unrelated edits and are never appended to the introduction', () => {
  const store = existingStore();
  store.priceMenu = [{ category: 'Massage', items: [{ name: 'Deep tissue', priceText: '$80 / 60 min' }] }];
  const draft = draftFromStore(store); draft.subtitle = 'New subtitle';
  const payload = buildStorePayload(draft, admin(store));
  assert.equal(payload.about, store.about);
  assert.equal(Object.hasOwn(payload, 'priceMenu'), false);
  assert.equal(Object.hasOwn(payload, 'expectedPriceMenuRevision'), false);
  const before = draftFingerprint(draft); draft.priceMenu[0].items[0].priceText = 'Call for price';
  assert.notEqual(draftFingerprint(draft), before);
  assert.equal(store.priceMenu[0].items[0].priceText, '$80 / 60 min');
  assert.equal(draftFromStore(store).priceMenu[0].items[0].priceText, '$80 / 60 min');
  assert.deepEqual(buildStorePayload({ ...draft, priceMenu: [] }, admin(store)).priceMenu, []);
});

test('a display menu cannot bypass actual publication requirements or mutate telephone/address fields', () => {
  const draft = pendingDraft();
  draft.status = 'APPROVED'; draft.priceMenu = [{ category: '', items: [{ name: 'Massage', priceText: '$80' }] }];
  assert.throws(() => buildStorePayload(draft, admin(null)), /发布前/);
  const store = existingStore(), existing = draftFromStore(store);
  existing.priceMenu = draft.priceMenu;
  const payload = buildStorePayload(existing, admin(store));
  assert.equal(payload.address, store.address); assert.deepEqual(payload.phones, store.phones);
});

test('menu-only edits on existing published legacy shops save only the menu without requiring unrelated missing details', () => {
  const store = existingStore(); store.timezone = ''; store.latitude = null; store.longitude = null;
  const draft = draftFromStore(store);
  draft.priceMenu = [{ category: 'Massage', items: [{ name: 'Deep tissue', priceText: '$80 / 60 min' }] }];
  const before = structuredClone(store);
  assert.deepEqual(buildStoreSavePayload(draft, admin(store)), { priceMenu: draft.priceMenu, expectedPriceMenuRevision: store.priceMenuRevision });
  assert.throws(() => buildStoreSavePayload({ ...draft, priceMenu: [] }, admin(store)), /没有需要保存/);
  assert.deepEqual(store, before);
  assert.equal(store.status, 'APPROVED');
});

test('mixing any other shop edit with a menu change still runs full publication validation', () => {
  const store = existingStore(); store.timezone = '';
  const draft = draftFromStore(store); draft.priceMenu = [{ category: '', items: [{ name: 'Massage', priceText: '$80' }] }];
  assert.throws(() => buildStoreSavePayload({ ...draft, address: 'Different store address' }, admin(store)), /发布前/);
  assert.throws(() => buildStoreSavePayload({ ...draft, subtitle: 'New introduction' }, admin(store)), /发布前/);
  assert.throws(() => buildStoreSavePayload({ ...draft, priceMenu: [{ category: '', items: [{ name: '', priceText: '$80' }] }] }, admin(store)), /展示价目表/);
  const valid = existingStore(), full = draftFromStore(valid); full.address = 'Updated address';
  const payload = buildStoreSavePayload(full, admin(valid));
  assert.deepEqual(payload, { address: 'Updated address' });
});

test('a contact edit cannot reopen a concurrently paused store or restore its old hours and booking settings', () => {
  const original = existingStore(), draft = draftFromStore(original);
  const latest = { ...original, status: 'SUSPENDED', timezone: 'America/Chicago', businessHours: emptyHours(), features: { ...original.features, onlineBooking: false, reviews: false } };
  draft.phones = '+1-555-0111';
  const patch = buildStoreSavePayload(draft, admin(original));
  assert.deepEqual({ ...latest, ...patch }, { ...latest, phones: ['+1-555-0111'] });
  draft.reviews = false;
  assert.deepEqual(buildStoreSavePayload(draft, admin(original)), { phones: ['+1-555-0111'], features: { reviews: false } });
});

test('a saved profile round trip keeps existing media, contacts, hours and business fields without readonly account fields', () => {
  const store = existingStore(); const payload = buildStorePayload(draftFromStore(store), admin(store));
  assert.deepEqual(payload, {
    name: store.name, shortName: store.shortName, subtitle: store.subtitle, status: 'APPROVED',
    phones: store.phones, emails: store.emails, timezone: store.timezone, businessHours: store.businessHours,
    address: store.address, city: store.city, state: store.state, zipCode: store.zipCode,
    logoUrl: store.logoUrl, bannerUrl: store.bannerUrl, gallery: store.gallery, videoUrl: store.videoUrl,
    about: store.about, tags: store.tags, features: { onlineBooking: true, reviews: true }, mapShareUrl: store.mapShareUrl,
    links: { website: '', instagram: '', facebook: '' }, brandColor: 'teal', buttonShape: 'rounded',
  });
});

test('menu changes including clearing require the original revision, while unrelated edits omit stale menu data', () => {
  const store = existingStore(); store.priceMenu = [{ category: '', items: [{ name: 'Original', priceText: '$80' }] }];
  const draft = draftFromStore(store); draft.priceMenu = [];
  assert.deepEqual(buildStoreSavePayload(draft, admin(store)), { priceMenu: [], expectedPriceMenuRevision: 'a'.repeat(64) });
  const mixed = { ...draft, address: 'Updated street' };
  assert.equal(buildStoreSavePayload(mixed, admin(store)).expectedPriceMenuRevision, store.priceMenuRevision);
  assert.throws(() => buildStoreSavePayload(draft, admin({ ...store, priceMenuRevision: undefined })), /版本缺失/);
  const unrelated = draftFromStore(store); unrelated.phones = '+1-555-0111';
  const payload = buildStoreSavePayload(unrelated, admin({ ...store, priceMenuRevision: undefined }));
  assert.deepEqual(payload.phones, ['+1-555-0111']);
  assert.equal(Object.hasOwn(payload, 'priceMenu'), false);
  assert.equal(Object.hasOwn(payload, 'expectedPriceMenuRevision'), false);
});

test('only an administrator can create and exact owner IDs are never converted to floating-point numbers', () => {
  const draft = pendingDraft(); draft.name = '  Pending studio  '; draft.phones = ' \n +1-555-0100 \n';
  const payload = buildStorePayload(draft, admin(null));
  assert.equal(payload.ownerId, '9007199254740995'); assert.equal(payload.name, 'Pending studio');
  assert.deepEqual(payload.phones, ['+1-555-0100']);
  assert.throws(() => buildStorePayload(draft, { isStoreManager: true, editing: null }), /平台管理员/);
});

test('merchant editing cannot submit ownership, publication decisions, passwords or unsupported payment features', () => {
  const store = existingStore(); const draft = draftFromStore(store);
  Object.assign(draft, { ownerId: '99', status: 'REJECTED', reviewReason: 'A forged decision', sysPassword: 'not-a-real-secret', onlinePayment: true, membershipCard: true });
  const payload = buildStorePayload(draft, { isStoreManager: true, editing: store });
  for (const key of ['ownerId', 'status', 'reviewReason', 'sysPassword', 'onlinePayment', 'membershipCard', 'sysAccount']) assert.equal(Object.hasOwn(payload, key), false);
  assert.deepEqual(payload.features, { onlineBooking: true, reviews: true });
});

test('missing required names and owner IDs fail before creation, including malformed or overflowing account IDs', () => {
  const draft = pendingDraft();
  assert.throws(() => buildStorePayload({ ...draft, name: ' ' }, admin(null)), /名称与唯一短链/);
  assert.throws(() => buildStorePayload({ ...draft, shortName: '' }, admin(null)), /名称与唯一短链/);
  assert.throws(() => buildStorePayload({ ...draft, ownerId: '' }, admin(null)), /选择实际商家账户/);
  for (const ownerId of ['0', '-1', '1e3', '9223372036854775808']) assert.throws(() => buildStorePayload({ ...draft, ownerId }, admin(null)), /有效的商家账户/);
  assert.throws(() => buildStorePayload({ ...draft, name: 'x'.repeat(201) }, admin(null)), /门店名称最多 200/);
});

test('contact limits and email validation match Studio instead of silently dropping extra contacts', () => {
  const draft = pendingDraft();
  assert.throws(() => buildStorePayload({ ...draft, phones: Array(6).fill('+1-555-0100').join('\n') }, admin(null)), /联系电话最多 5/);
  assert.throws(() => buildStorePayload({ ...draft, phones: '1'.repeat(21) }, admin(null)), /联系电话最多 20/);
  assert.throws(() => buildStorePayload({ ...draft, emails: Array(6).fill('a@example.test').join('\n') }, admin(null)), /联系邮箱最多 5/);
  assert.throws(() => buildStorePayload({ ...draft, emails: 'invalid-address' }, admin(null)), /有效的联系邮箱/);
});

test('invalid timezone and incomplete publication details cannot be hidden by switching UI sections', () => {
  const draft = draftFromStore(existingStore());
  assert.throws(() => buildStorePayload({ ...draft, timezone: 'Not/A_Timezone' }, admin()), /IANA 时区/);
  for (const field of ['timezone', 'phones', 'address', 'city', 'state'] as const) assert.throws(() => buildStorePayload({ ...draft, [field]: '' }, admin()), /发布前/);
  assert.throws(() => buildStorePayload({ ...draft, businessHours: emptyHours() }, admin()), /发布前/);
  assert.equal(buildStorePayload(pendingDraft(), admin(null)).status, 'PENDING');
});

test('all open days are checked, legacy AM/PM values normalize, and rejecting a new decision needs a reason', () => {
  const draft = draftFromStore(existingStore());
  for (const hours of [{ open: true, start: '25:00', end: '26:00' }, { open: true, start: '18:00', end: '09:00' }, { open: true, start: '09:00', end: '' }]) {
    assert.throws(() => buildStorePayload({ ...draft, businessHours: { ...draft.businessHours, '周二': hours } }, admin()), /周二/);
  }
  const payload = buildStorePayload({ ...draft, businessHours: { ...draft.businessHours, '周一': { open: true, start: '09:00 AM', end: '06:00 PM' } } }, admin());
  assert.deepEqual((payload.businessHours as StoreDraft['businessHours'])['周一'], { open: true, start: '09:00', end: '18:00' });
  assert.throws(() => buildStorePayload({ ...draft, status: 'REJECTED', reviewReason: ' ' }, admin()), /拒绝原因/);
  assert.equal(buildStorePayload({ ...draft, status: 'REJECTED', reviewReason: '  Missing information  ' }, admin()).reviewReason, 'Missing information');
});

test('media uses real HTTPS URLs with existing backend size/count limits and supports deliberate clearing', () => {
  const draft = pendingDraft();
  for (const logoUrl of ['javascript:alert(1)', 'data:image/png;base64,test', 'http://example.test/logo.png', 'https://user:password@example.test/logo.png']) assert.throws(() => buildStorePayload({ ...draft, logoUrl }, admin(null)), /HTTPS/);
  assert.throws(() => buildStorePayload({ ...draft, videoUrl: 'https://example.test/' + 'x'.repeat(500) }, admin(null)), /最多 500/);
  assert.throws(() => buildStorePayload({ ...draft, gallery: Array(21).fill('https://example.test/a.jpg').join('\n') }, admin(null)), /最多 20/);
  assert.throws(() => buildStorePayload({ ...draft, tags: Array(11).fill('tag').join('\n') }, admin(null)), /标签最多 10/);
  assert.throws(() => buildStorePayload({ ...draft, tags: 'x'.repeat(101) }, admin(null)), /标签最多 100/);
  const allowed = buildStorePayload({ ...draft, gallery: Array(20).fill('https://example.test/a.jpg').join('\n'), tags: Array(10).fill('tag').join('\n') }, admin(null));
  assert.equal((allowed.gallery as string[]).length, 20); assert.equal((allowed.tags as string[]).length, 10);
  const cleared = buildStorePayload({ ...draftFromStore(existingStore()), logoUrl: '', bannerUrl: '', gallery: '', videoUrl: '', mapShareUrl: '' }, admin());
  assert.deepEqual([cleared.logoUrl, cleared.bannerUrl, cleared.gallery, cleared.videoUrl, cleared.mapShareUrl], ['', '', [], '', '']);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, businessHours, randomStorePassword, serviceImportData, variantImportData } = require('./import-legacy-stores.cjs');

function fixture(projects, prices, categories = []) {
  return {
    shopRowStats: { total: 1, unnamed: 0 },
    shops: [{ id: 1, name: 'Import fixture' }],
    projects: projects.map(row => ({ mch_id: 1, status: 1, delete_time: 0, ...row })),
    prices,
    categories,
    technicians: [],
    coupons: [],
    giftCards: [],
    ratings: [],
  };
}

test('future imports recover legacy 24-hour PM business hours through the shared parser', () => {
  const warnings = [];
  const hours = businessHours({
    monday_state: 1, monday_time: '[["09:00 AM","22:00 PM"]]',
    tuesday_state: 0,
    wednesday_state: 1, wednesday_time: [{ open: '10:00', close: '20:00 PM' }],
    thursday_state: 1, thursday_time: '[["14:00 AM","22:00 PM"]]',
  }, warnings);
  assert.deepEqual(hours.monday, { open: '09:00', close: '22:00', closed: false });
  assert.deepEqual(hours.tuesday, { closed: true });
  assert.deepEqual(hours.wednesday, { open: '10:00', close: '20:00', closed: false });
  assert.equal(hours.thursday, undefined);
  assert.deepEqual(warnings, ['thursday', 'friday', 'saturday', 'sunday']);
});

test('active single, couple and four-hands services retain exact total prices and staff allocations', () => {
  const plan = buildPlan(fixture([
    { id: 10, name: 'Chair massage' },
    { id: 20, name: 'Couple massage' },
    { id: 30, name: 'Four-hands massage' },
  ], [
    { id: 100, pid: 10, minute: 15, price: '25.50' },
    { id: 200, pid: 20, minute: 60, price: '150' },
    { id: 300, pid: 30, minute: 60, price: '180.25' },
  ]));
  const rows = plan.services.get('1').map(service => ({
    service: serviceImportData(service, 1n, 0),
    variant: variantImportData(service.timedPrices[0], 2n, 0),
  }));
  assert.deepEqual(rows.map(row => [row.service.participantCount, row.service.requiredStaffCount]), [[1, 1], [2, 2], [1, 2]]);
  assert.deepEqual(rows.map(row => row.variant.priceCents), [2550, 15000, 18025]);
  for (const row of rows) {
    assert.equal(row.service.isActive, true);
    assert.equal(row.variant.isActive, true);
    assert.equal(row.service.priceBasis, 'PER_BOOKING');
    assert.equal(row.variant.priceBasis, 'PER_BOOKING');
    assert.equal(row.service.priceCents, row.variant.priceCents);
    assert.equal(row.service.durationMin, row.variant.durationMin);
  }
  assert.equal(plan.summary.activeServices, 3);
  assert.equal(plan.summary.activeVariants, 3);
  assert.equal(plan.summary.linkedTimedItems, 3);
});

test('original category names determine staffing before display categories are normalized', () => {
  const plan = buildPlan(fixture([
    { id: 10, name: 'Relaxation treatment', cid: '1' },
    { id: 20, name: 'Relaxation treatment', cid: '2' },
  ], [
    { id: 100, pid: 10, minute: 60, price: '150' },
    { id: 200, pid: 20, minute: 60, price: '180' },
  ], [{ id: 1, name: 'Couples Massage' }, { id: 2, name: '4 Hands Massage' }]));
  assert.deepEqual(plan.services.get('1').map(service => [service.policy.participantCount, service.policy.requiredStaffCount]), [[2, 2], [1, 2]]);
});

test('generic Services projects split exact ordinary, couple and four-hands options while keeping menu order and source identities', () => {
  const plan = buildPlan(fixture([{ id: 10, name: 'Services' }], [
    { id: 100, pid: 10, name: '60 min Body Massage', minute: 60, price: '75.25' },
    { id: 101, pid: 10, name: '60 min Couple Massage', minute: 60, price: '150.50' },
    { id: 102, pid: 10, name: '90 min Body Massage', minute: 90, price: '110' },
    { id: 103, pid: 10, name: '60 min Four Hands Massage', minute: 60, price: '180.75' },
  ]));
  const services = plan.services.get('1');
  assert.deepEqual(services.map(service => [service.policy.mode, service.policy.participantCount, service.policy.requiredStaffCount]), [
    ['SINGLE', 1, 1], ['COUPLE', 2, 2], ['FOUR_HANDS', 1, 2],
  ]);
  assert.deepEqual(services.map(service => service.serviceKey), ['1:10:SINGLE', '1:10:COUPLE', '1:10:FOUR_HANDS']);
  assert.deepEqual(services.map(service => service.timedPrices.map(option => option.row.id)), [[100, 102], [101], [103]]);
  assert.deepEqual(services.map(service => service.name), ['Services · Single Massage', 'Services · Couple Massage', 'Services · Four Hands Massage']);
  assert.deepEqual(services.map(service => service.priceCents), [7525, 15050, 18075]);
  const menu = plan.menus.get('1');
  assert.equal(menu.length, 1);
  assert.deepEqual(menu[0].items.map(item => [item.id, item.__variantSourceId, item.name]), [
    ['legacy-price-100', '100', '60 min Body Massage'],
    ['legacy-price-101', '101', '60 min Couple Massage'],
    ['legacy-price-102', '102', '90 min Body Massage'],
    ['legacy-price-103', '103', '60 min Four Hands Massage'],
  ]);
  // The apply phase must identify the split service by its actual options,
  // rather than the unsplit project's original price list.
  assert.deepEqual(menu[0].items.map(item => services.find(service => service.timedPrices.some(option => String(option.row.id) === item.__variantSourceId)).policy.mode),
    ['SINGLE', 'COUPLE', 'SINGLE', 'FOUR_HANDS']);
  assert.equal(plan.summary.activeServices, 3);
  assert.equal(plan.summary.activeVariants, 4);
  assert.equal(plan.summary.priceMenuItems, 4);
});

test('an explicit option overrides its special parent while generic options inherit and ambiguous rows stay display-only', () => {
  const plan = buildPlan(fixture([{ id: 10, name: 'Couple Massage' }], [
    { id: 100, pid: 10, name: '60 minutes', minute: 60, price: '150' },
    { id: 101, pid: 10, name: 'Four Hands Massage', minute: 60, price: '180' },
    { id: 102, pid: 10, name: 'Couple / Four Hands Massage', minute: 60, price: '160' },
  ]));
  const services = plan.services.get('1');
  assert.deepEqual(services.map(service => service.policy?.mode || 'DISPLAY_ONLY'), ['COUPLE', 'FOUR_HANDS', 'DISPLAY_ONLY']);
  assert.deepEqual(services.map(service => service.isActive), [true, true, false]);
  assert.equal(services[2].timedPrices[0].isActive, false);
  const items = plan.menus.get('1').flatMap(group => group.items);
  assert.deepEqual(items.map(item => item.__variantSourceId), ['100', '101', undefined]);
  assert.deepEqual(items.map(item => item.pricing.priceCents), [15000, 18000, 16000]);
  assert.equal(plan.summary.linkedTimedItems, 2);
  assert.equal(plan.summary.displayOnlyItems, 1);
});

test('gift cards and prepaid multi-visit packages remain visible without becoming single appointments', () => {
  const plan = buildPlan(fixture([{ id: 10, name: 'Services' }], [
    { id: 100, pid: 10, name: '60 min Swedish Massage', minute: 60, price: '90' },
    { id: 101, pid: 10, name: '60 min Massage Gift Card', minute: 60, price: '100' },
    { id: 102, pid: 10, name: 'Buy 4 Get 1 Free Massage', minute: 60, price: '360' },
    { id: 103, pid: 10, name: 'Package of 5 Massages', minute: 60, price: '400' },
  ]));
  const services = plan.services.get('1');
  assert.deepEqual(services.map(service => service.policy?.mode || 'DISPLAY_ONLY'), ['SINGLE', 'DISPLAY_ONLY']);
  assert.equal(services[0].isActive, true);
  assert.equal(services[1].isActive, false);
  assert.deepEqual(services[1].timedPrices.map(option => [option.row.id, option.isActive]), [[101, false], [102, false], [103, false]]);
  const items = plan.menus.get('1').flatMap(group => group.items);
  assert.deepEqual(items.map(item => item.id), ['legacy-price-100', 'legacy-price-101', 'legacy-price-102', 'legacy-price-103']);
  assert.deepEqual(items.map(item => item.pricing.priceCents), [9000, 10000, 36000, 40000]);
  assert.deepEqual(items.map(item => item.__variantSourceId), ['100', undefined, undefined, undefined]);
  assert.equal(plan.summary.activeServices, 1);
  assert.equal(plan.summary.activeVariants, 1);
  assert.equal(plan.summary.displayOnlyItems, 3);
});

test('combined couple/four-hands categories stay visible without a booking link or enabled option', () => {
  const plan = buildPlan(fixture([
    { id: 10, name: '60 minute treatment', cid: '1' },
    { id: 20, name: 'Body massage', cid: '2, 3' },
  ], [
    { id: 100, pid: 10, minute: 60, price: '160' },
    { id: 200, pid: 20, minute: 90, price: '220' },
  ], [
    { id: 1, name: 'Body & Foot & 4 Hands & Couple' },
    { id: 2, name: 'Couple Massage' },
    { id: 3, name: 'Four Hands Massage' },
  ]));
  for (const service of plan.services.get('1')) {
    assert.equal(service.policy, null);
    assert.equal(serviceImportData(service, 1n, 0).isActive, false);
    assert.equal(variantImportData(service.timedPrices[0], 2n, 0).isActive, false);
  }
  const items = plan.menus.get('1').flatMap(group => group.items);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.pricing.priceCents), [16000, 22000]);
  assert.equal(items.some(item => '__variantSourceId' in item || 'booking' in item), false);
  assert.equal(plan.summary.ambiguousServices, 2);
  assert.equal(plan.summary.displayOnlyItems, 2);
});

test('paused, deleted and unknown source statuses cannot enable services or variants', () => {
  const plan = buildPlan(fixture([
    { id: 10, name: 'Paused massage', status: 0 },
    { id: 20, name: 'Deleted massage', delete_time: 1720000000 },
    { id: 30, name: 'Unknown massage', status: null },
  ], [
    { id: 100, pid: 10, minute: 60, price: '100' },
    { id: 200, pid: 20, minute: 60, price: '100' },
    { id: 300, pid: 30, minute: 60, price: '100' },
  ]));
  for (const service of plan.services.get('1')) {
    assert.equal(serviceImportData(service, 1n, 0).isActive, false);
    assert.equal(variantImportData(service.timedPrices[0], 2n, 0).isActive, false);
  }
  assert.equal(plan.summary.activeServices, 0);
  assert.equal(plan.summary.activeVariants, 0);
  assert.equal(plan.summary.priceMenuItems, 3);
});

test('only valid duration/price options enable and the base price comes from one valid option', () => {
  const plan = buildPlan(fixture([{ id: 10, name: 'Body massage' }], [
    { id: 100, pid: 10, minute: 4, price: '1' },
    { id: 101, pid: 10, minute: 300, price: '200' },
    { id: 102, pid: 10, minute: 60, price: '0' },
    { id: 103, pid: 10, minute: 30, price: 'invalid' },
    { id: 104, pid: 10, minute: 60, price: '100001' },
    { id: 105, pid: 10, minute: 15, price: '25' },
    { id: 106, pid: 10, minute: 5, price: '0.01' },
    { id: 107, pid: 10, minute: 240, price: '100000' },
  ]));
  const service = plan.services.get('1')[0];
  assert.equal(service.isActive, true);
  assert.deepEqual(service.timedPrices.map(option => [option.row.id, option.isActive]), [[100, false], [101, false], [104, false], [105, true], [106, true], [107, true]]);
  assert.deepEqual([service.duration, service.priceCents], [15, 2500]);
  assert.equal(plan.summary.priceMenuItems, 8);
  assert.equal(plan.summary.activeVariants, 3);
  assert.equal(plan.summary.displayOnlyItems, 2);
});

test('projects without valid priced options remain display-only and inactive', () => {
  const plan = buildPlan(fixture([{ id: 10, name: 'Call for pricing' }], []));
  const service = serviceImportData(plan.services.get('1')[0], 1n, 0);
  assert.equal(service.isActive, false);
  assert.equal(service.durationKind, 'VARIABLE');
  assert.equal(plan.summary.priceMenuItems, 1);
  assert.equal(plan.summary.linkedTimedItems, 0);
});

test('importer continues generating eight-character letter-and-digit initial passwords', () => {
  const generated = Array.from({ length: 20 }, () => randomStorePassword());
  for (const password of generated) {
    assert.match(password, /^[A-Za-z0-9]{8}$/);
    assert.match(password, /[A-Za-z]/);
    assert.match(password, /\d/);
  }
  assert.equal(new Set(generated).size, generated.length);
});

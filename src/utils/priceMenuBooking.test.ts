import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePriceMenu, type PriceMenuGroup } from './priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './priceMenuPricing';
import { cloneNextPriceMenuItem } from './priceMenuQuickEntry';

const pricing: PriceMenuPricing = { kind: 'TIMED', baseName: 'Massage', durationMin: 60, priceCents: 8000, titleMode: 'AUTO' };
const row = { id: 'main', name: formatPriceMenuTitle(pricing), priceText: '', pricing, bookingEnabled: true, bookingMode: 'FOUR_HANDS' as const };
test('explicit booking mode and stable same-shop reference round-trip without re-entering amounts', () => {
  const menu: PriceMenuGroup[] = [{ category: 'Massage', items: [{ ...row, booking: { serviceId: '20', variantId: '30' }, reservedDurationMin: 60 }] }];
  assert.deepEqual(validatePriceMenu(menu), menu);
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ ...row, bookingMode: undefined }] }]), /预约方式/);
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ ...row, booking: { serviceId: '20', variantId: '30', addOnId: '40' } }] }]), /不能同时关联/);
});
test('cloning a menu row creates a fresh display draft, never another live link to the old SKU', () => {
  const cloned = cloneNextPriceMenuItem({ ...row, booking: { serviceId: '20', variantId: '30' } }, { minutes: 30, priceCents: 1000 }).item;
  assert.equal(cloned.id, undefined); assert.equal(cloned.booking, undefined); assert.notEqual(cloned.bookingEnabled, true);
  assert.equal(cloned.newVariantOf, '20'); assert.equal(cloned.bookingMode, 'FOUR_HANDS');
  assert.equal(cloned.pricing?.durationMin, 90); assert.equal(cloned.pricing?.priceCents, 9000);
});
test('unsaved option copies retain their explicit draft parent and non-fixed occupied minutes', () => {
  const draft = { ...row, id: 'draft-first', pricing: { ...pricing, kind: 'VARIABLE' as const, durationMin: null }, reservedDurationMin: 45 };
  const cloned = cloneNextPriceMenuItem(draft, { minutes: 0, priceCents: 1000 }).item;
  assert.equal(cloned.newVariantOf, 'item:draft-first'); assert.equal(cloned.reservedDurationMin, 45); assert.equal(cloned.bookingMode, 'FOUR_HANDS');
});
test('read snapshots keep explicit effective false without clearing the configured switch', () => {
  const paused = { ...row, booking: { serviceId: '20', variantId: '30' }, bookingAvailable: false, bookingUnavailableReason: 'PARENT_PAUSED' as const };
  const normalized = validatePriceMenu([{ category: 'Massage', items: [paused] }])[0].items[0];
  assert.equal(normalized.bookingEnabled, true); assert.equal(normalized.bookingAvailable, false); assert.equal(normalized.bookingUnavailableReason, 'PARENT_PAUSED');
  const clone = cloneNextPriceMenuItem(paused, { minutes: 30, priceCents: 1000 }).item;
  assert.equal(clone.bookingAvailable, undefined); assert.equal(clone.bookingUnavailableReason, undefined);
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ ...paused, bookingAvailable: 'false' as unknown as boolean }] }]), /布尔值/);
});

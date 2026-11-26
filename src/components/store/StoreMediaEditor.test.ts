import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STORE_MEDIA_MAX_IMAGES, STORE_MEDIA_MAX_URL_LENGTH,
  addStoreMediaUrls, dedupeStoreMediaUrls, dropStoreMediaUrl, moveStoreMediaUrl, parseStoreMediaUrls, validateStoreMediaUrl,
} from './StoreMediaEditor';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/PriceMenuPreview.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { safePreviewImageUrl } = await import('./StoreCustomerPreview');

// These pure helper regressions never mount the UI, fetch an image or call a provider.
const image = (index: number) => `https://images.example.test/room-${index}.jpg`;

test('managed images accept only the exact server file route and keep gallery order and clear semantics',()=>{
  const managed='/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
  assert.equal(validateStoreMediaUrl(managed),null);
  assert.equal(addStoreMediaUrls(image(1),managed).value,image(1)+'\n'+managed);
  for(const bad of ['/uploads/image.png','//example.test/image.png',managed+'?x=1',managed+'#x',managed.replace('4000','0000')])assert.ok(validateStoreMediaUrl(bad));
});

test('media validation accepts HTTPS image URLs up to the exact saved length limit', () => {
  for (const url of [image(1), '  HTTPS://IMAGES.EXAMPLE.TEST/logo.png?q=1#crop  ', 'https://images.example.test/门店.jpg']) {
    assert.equal(validateStoreMediaUrl(url), null);
  }
  const prefix = 'https://images.example.test/';
  const exactLimit = prefix + 'a'.repeat(STORE_MEDIA_MAX_URL_LENGTH - prefix.length);
  assert.equal(exactLimit.length, 500);
  assert.equal(validateStoreMediaUrl(exactLimit), null);
  assert.ok(validateStoreMediaUrl(exactLimit + 'a'));
});

test('media validation rejects unsafe schemes, credentials and malformed addresses', () => {
  for (const url of [
    '', 'http://images.example.test/a.jpg', '/uploads/a.jpg', '//images.example.test/a.jpg',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///a.png',
    'https://user:password@images.example.test/a.jpg', 'https://user@images.example.test/a.jpg',
    'https://', 'https:images.example.test/a.jpg', 'https://[invalid]/a.jpg',
    'https://images.example.test/a b.jpg', 'https://images.example.test\\a.jpg',
    'https://images.example.test/a\nb.jpg', 'https://images.example.test/a\u0000b.jpg',
  ]) assert.ok(validateStoreMediaUrl(url), `Must reject ${JSON.stringify(url)}`);
});

test('line parsing and canonical deduplication retain the first raw URL and original order', () => {
  const first = 'https://IMAGES.example.test:443/room.jpg?crop=Right#large';
  const duplicate = 'https://images.example.test/room.jpg?crop=Right#large';
  const differentQuery = 'https://images.example.test/room.jpg?crop=Left#large';
  const parsed = parseStoreMediaUrls(`  ${first} \r\n\n ${image(2)}\n${duplicate}\n ${differentQuery}  `);
  assert.deepEqual(parsed, [first, image(2), duplicate, differentQuery]);
  assert.deepEqual(dedupeStoreMediaUrls(parsed), [first, image(2), differentQuery]);
  assert.deepEqual(parsed, [first, image(2), duplicate, differentQuery], 'Deduplication must not mutate its input');
});

test('the 20-image limit counts unique URLs so duplicates do not consume gallery slots', () => {
  assert.equal(STORE_MEDIA_MAX_IMAGES, 20);
  const nineteen = Array.from({ length: 19 }, (_, index) => image(index)).join('\n');
  const twentieth = addStoreMediaUrls(nineteen, `${image(19)}\n${image(19)}\n${image(0)}`);
  assert.equal(twentieth.error, null);
  assert.equal(parseStoreMediaUrls(twentieth.value).length, 20);
  const repeatedAtLimit = addStoreMediaUrls(twentieth.value, image(19));
  assert.equal(repeatedAtLimit.error, null);
  assert.equal(repeatedAtLimit.value, twentieth.value);
  const overflow = addStoreMediaUrls(twentieth.value, image(20));
  assert.ok(overflow.error);
  assert.equal(overflow.value, twentieth.value, 'An overflowing batch must leave the saved order intact');
});

test('a batch containing an invalid URL is rejected in full without adding its valid prefix', () => {
  const original = ` ${image(1)} \r\n${image(2)}`;
  for (const invalid of ['http://images.example.test/bad.jpg', 'https://user:pass@images.example.test/bad.jpg', 'https://images.example.test/' + 'a'.repeat(500)]) {
    const result = addStoreMediaUrls(original, `${image(3)}\n${invalid}\n${image(4)}`);
    assert.ok(result.error);
    assert.equal(result.value, original, 'Failure must preserve the exact incoming controlled value');
  }
  const empty = addStoreMediaUrls(original, ' \r\n ');
  assert.ok(empty.error);
  assert.equal(empty.value, original);
});

test('successful additions and reorder operations preserve raw URL text and only change requested positions', () => {
  const first = 'https://IMAGES.example.test:443/one.jpg?size=Large';
  const original = `${first}\n${image(2)}`;
  const result = addStoreMediaUrls(original, ` ${image(3)} \n${first}\n${image(4)}`);
  assert.equal(result.error, null);
  assert.equal(result.value, `${first}\n${image(2)}\n${image(3)}\n${image(4)}`);
  const forward = moveStoreMediaUrl(result.value, 2, -1);
  assert.equal(forward, `${first}\n${image(3)}\n${image(2)}\n${image(4)}`);
  assert.equal(moveStoreMediaUrl(forward, 1, 1), result.value);
  assert.equal(original, `${first}\n${image(2)}`);
});

test('reordering at gallery boundaries or with invalid indices leaves the controlled value unchanged', () => {
  const original = `${image(1)}\n${image(2)}`;
  for (const [index, direction] of [[0, -1], [1, 1], [-1, 1], [2, -1], [0.5, 1], [NaN, 1]] as const) {
    assert.equal(moveStoreMediaUrl(original, index, direction), original);
  }
  assert.equal(moveStoreMediaUrl('', 0, 1), '');
  assert.equal(moveStoreMediaUrl(image(1), 0, -1), image(1));
  assert.equal(moveStoreMediaUrl(image(1), 0, 1), image(1));
});

test('a long-distance gallery drop retains every image and the order of untouched neighbours', () => {
  const original = [1, 2, 3, 4, 5].map(image).join('\n');
  const moved = dropStoreMediaUrl(original, original, image(1), image(4));
  assert.equal(moved, [2, 3, 4, 1, 5].map(image).join('\n'));
  assert.equal(dropStoreMediaUrl(moved!, moved!, image(1), image(2)), original);
  assert.equal(dropStoreMediaUrl(original, original, image(1), image(1)), null);
  assert.equal(dropStoreMediaUrl(original, original, image(99), image(1)), null);
});

test('a stale gallery drop cannot restore a deleted image or discard a newly added image', () => {
  const before = [1, 2, 3].map(image).join('\n');
  for (const after of [[1, 3], [1, 2, 3, 4], [3, 2, 1]].map(order => order.map(image).join('\n'))) {
    assert.equal(dropStoreMediaUrl(after, before, image(1), image(3)), null);
  }
  assert.equal(dropStoreMediaUrl(before, before, image(1), image(99)), null);
});

test('the customer preview never exposes unsafe or credential-bearing values as an image source', () => {
  for (const value of [
    '', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://images.example.test/a.jpg',
    '//images.example.test/a.jpg', '/uploads/a.jpg', 'https://user:password@images.example.test/a.jpg',
    'https://user@images.example.test/a.jpg', 'https://images.example.test\\a.jpg',
    'https://images.example.test/a\nb.jpg',
  ]) assert.equal(safePreviewImageUrl(value), null, `Must not preview ${JSON.stringify(value)}`);
  assert.equal(safePreviewImageUrl('  https://IMAGES.example.test:443/a.jpg  '), 'https://images.example.test/a.jpg');
});

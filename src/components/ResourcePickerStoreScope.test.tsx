import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ResourcePicker from './ResourcePicker';

test('service selection without a shop never exposes retained selected IDs as clickable qualifications', () => {
  const html = renderToStaticMarkup(<ResourcePicker resource="services" multiple value={['81', '82']} onChange={() => { throw Error('No unscoped selection'); }} />);
  assert.match(html, /请先明确选择所属门店/);
  assert.doesNotMatch(html, /checkbox|当前记录 #81|value="81"/);
});

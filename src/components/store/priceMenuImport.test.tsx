import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzePriceMenuPaste, PRICE_MENU_TEMPLATE_CONTENT, PRICE_MENU_TEMPLATE_FILENAME, type PriceMenuGroup } from '../../utils/priceMenu';

// Layout is accepted in the browser; Node verifies download payload and accessible feedback.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('/StorePriceMenuEditor.css') || url.endsWith('/MenuCatalogPicker.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StorePriceMenuEditor, downloadPriceMenuTemplate, PriceMenuImportIssues } = await import('./StorePriceMenuEditor');

function downloadDocument() {
  let appended = false, clicked = 0, removed = false;
  const anchor = { href: '', download: '', hidden: false, click: () => { assert.equal(appended, true); clicked++; }, remove: () => { removed = true; } };
  const doc = { createElement: (tag: string) => { assert.equal(tag, 'a'); return anchor; }, body: { appendChild: (child: unknown) => { assert.equal(child, anchor); appended = true; } } };
  return { doc: doc as unknown as Document, anchor, state: () => ({ appended, clicked, removed }) };
}

test('native template download uses exact BOM TSV examples and never exports the current shop or pasted draft', () => {
  const value: PriceMenuGroup[] = [{ category: 'Draft-only category', items: [{ name: 'Draft-only private name', priceText: '$123 draft only' }] }];
  const paste = 'Paste-only category\tPaste-only name\tCall the store';
  const before = structuredClone(value); let menuChanges = 0, pasteChanges = 0;
  const html = renderToStaticMarkup(<StorePriceMenuEditor value={value} pasteText={paste} onChange={() => { menuChanges++; return true; }} onPasteTextChange={() => { pasteChanges++; return true; }} />);
  assert.match(html, /下载表格模板/);
  assert.match(html, /新增行默认隐藏/);
  const native = downloadDocument(); downloadPriceMenuTemplate(native.doc);
  assert.equal(native.anchor.download, PRICE_MENU_TEMPLATE_FILENAME);
  assert.match(native.anchor.download, /\.tsv$/);
  assert.ok(native.anchor.href.startsWith('data:text/tab-separated-values;charset=utf-8,'));
  const content = decodeURIComponent(native.anchor.href.slice(native.anchor.href.indexOf(',') + 1));
  assert.equal(content, PRICE_MENU_TEMPLATE_CONTENT);
  assert.deepEqual([...new TextEncoder().encode(content).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.doesNotMatch(content, /Draft-only|Paste-only|\$123/);
  assert.deepEqual(native.state(), { appended: true, clicked: 1, removed: true });
  assert.equal(menuChanges, 0); assert.equal(pasteChanges, 0); assert.deepEqual(value, before);
});

test('structured errors render original physical lines and field columns including a multiline description', () => {
  const analysis = analyzePriceMenuPaste('\n分组\t项目名称\t原价文字\t说明\n\nMassage\t\t$80\t\nMassage\tDeep tissue\t$90\t"First line\n<b>Not plain</b>"');
  assert.ok(analysis.errorCount >= 2); assert.deepEqual(analysis.groups, []);
  const html = renderToStaticMarkup(<PriceMenuImportIssues analysis={analysis} id="import-issues" />);
  assert.match(html, /role="alert"/); assert.match(html, /id="import-issues"/);
  assert.match(html, /第 4 行 · 第 2 列（项目名称）/);
  assert.match(html, /第 6 行 · 第 4 列（说明）/);
  assert.match(html, /未生成可追加预览/);
  assert.doesNotMatch(html, /确认追加/);
});

test('large invalid pastes show at most twenty detailed errors and the remaining count', () => {
  const analysis = analyzePriceMenuPaste(Array.from({ length: 25 }, () => 'Massage\t\t$80').join('\n'));
  assert.equal(analysis.errorCount, 25); assert.deepEqual(analysis.groups, []);
  const html = renderToStaticMarkup(<PriceMenuImportIssues analysis={analysis} />);
  assert.equal((html.match(/<li>/g) ?? []).length, 20);
  assert.match(html, /另有 5 处问题未展开/);
  assert.match(html, /重新解析/);
});

test('disabled editors keep controlled paste and existing menu intact with all import write controls disabled', () => {
  const value: PriceMenuGroup[] = [{ category: 'Saved', items: [{ name: 'Saved wording', priceText: 'From $80' }] }];
  const paste = 'New group\tUnappended wording\t$90'; let menuChanges = 0, pasteChanges = 0;
  const html = renderToStaticMarkup(<StorePriceMenuEditor value={value} pasteText={paste} disabled onChange={() => { menuChanges++; return true; }} onPasteTextChange={() => { pasteChanges++; return true; }} />);
  for (const label of ['下载表格模板', '解析并预览', '清除粘贴内容']) {
    const button = html.match(new RegExp('<button[^>]*>' + label + '</button>'))?.[0];
    assert.ok(button); assert.match(button, /disabled=""/);
  }
  assert.match(html, /Unappended wording/); assert.match(html, /粘贴内容尚未追加/);
  assert.doesNotMatch(html, /确认追加到本店草稿/);
  assert.equal(menuChanges, 0); assert.equal(pasteChanges, 0);
  assert.equal(value[0].items[0].name, 'Saved wording');
});

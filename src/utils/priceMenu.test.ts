import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePriceMenuPaste, appendPriceMenu, parsePriceMenuPaste, priceMenuFromShop, safePriceMenuImage, validatePriceMenu, PRICE_MENU_LIMITS, PRICE_MENU_PASTE_LIMITS, PRICE_MENU_TEMPLATE_CONTENT, PRICE_MENU_TEMPLATE_FILENAME, type PriceMenuGroup } from './priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './priceMenuPricing';

const menu = (): PriceMenuGroup[] => [{ category: 'Massage', items: [{ name: 'Deep tissue', priceText: 'From $80 / 60 min', description: 'Please call to confirm.' }] }];

test('explicit pricing saves four complete-title modes, retaining old menus and source snapshots without inferred values', () => {
  const timed: PriceMenuPricing = { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO' };
  const options: PriceMenuPricing[] = [timed, ...(['PER_SESSION', 'VARIABLE', 'ADD_ON'] as const).map(kind => ({ ...timed, kind, durationMin: null }))];
  const structured = [{ category: 'Body', items: options.map(pricing => ({ name: formatPriceMenuTitle(pricing), priceText: '', pricing })) }];
  assert.deepEqual(validatePriceMenu(structured), structured);
  const legacySource = { name: ' Original source name ', priceText: ' From CAD 80 / package? ' };
  const input = [{ category: 'Body', items: [{ name: formatPriceMenuTitle(timed), priceText: '', pricing: { ...timed, legacySource } }] }];
  const saved = validatePriceMenu(input);
  assert.deepEqual(saved[0].items[0].pricing?.legacySource, legacySource);
  assert.notEqual(saved[0].items[0].pricing, input[0].items[0].pricing);
  assert.notEqual(saved[0].items[0].pricing?.legacySource, legacySource);
  assert.deepEqual(validatePriceMenu(menu()), menu());
  assert.equal(Object.hasOwn(validatePriceMenu(menu())[0].items[0], 'pricing'), false);
});

test('structured menu saving rejects unfinished numbers, mixed old price text and mismatched automatic titles without mutating input', () => {
  const pricing: PriceMenuPricing = { kind: 'TIMED', baseName: 'Body Massage', durationMin: 30, priceCents: 5000, titleMode: 'AUTO' };
  const item = { name: '30Mins Body Massage $50', priceText: '', description: 'Keep', pricing };
  const prior = [{ category: 'Body', items: [item] }];
  assert.deepEqual(validatePriceMenu(prior), prior);
  const invalid = [
    { ...item, pricing: undefined }, { ...item, pricing: null }, { ...item, pricing: { ...pricing, priceCents: null } },
    { ...item, pricing: { ...pricing, priceCents: '5000' } }, { ...item, pricing: { ...pricing, durationMin: null } },
    { ...item, pricing: { ...pricing, durationMin: '30' } }, { ...item, pricing: { ...pricing, kind: 'PER_SESSION' } },
    { ...item, pricing: { ...pricing, hidden: 'PRIVATE' } }, { ...item, pricing: { ...pricing, legacySource: { name: 'Old', priceText: '', hidden: true } } },
    { ...item, name: '60Mins Body Massage $50' }, { ...item, name: ' 30Mins Body Massage $50 ' },
    { ...item, priceText: '$50 / 30min' }, { ...item, priceText: ' ' },
  ];
  for (const bad of invalid) {
    const value = [{ category: 'Body', items: [bad] }] as PriceMenuGroup[], before = structuredClone(value);
    assert.throws(() => validatePriceMenu(value));
    assert.deepEqual(value, before);
  }
  const custom = [{ category: '', items: [{ ...item, name: 'Custom complete title', pricing: { ...pricing, titleMode: 'CUSTOM' as const } }] }];
  assert.deepEqual(validatePriceMenu(custom), custom);
});

test('display prices retain original wording and unknown prices without deriving amount or duration', () => {
  const value = menu(); value.push({ category: '', items: [{ name: 'Consultation', priceText: '' }] });
  assert.deepEqual(validatePriceMenu(value), value);
  assert.deepEqual(Object.keys(validatePriceMenu(value)[0].items[0]), ['name', 'priceText', 'description']);
  assert.deepEqual(validatePriceMenu([]), [], 'explicit empty menu is a supported clear');
});

test('shop drafts prefer explicit top-level menu and never share mutable menu data across shops', () => {
  const shop = { studioProfile: { priceMenu: menu() } };
  const first = priceMenuFromShop(shop), second = priceMenuFromShop(shop);
  first[0].items[0].name = 'Draft change';
  assert.equal(second[0].items[0].name, 'Deep tissue');
  assert.equal((shop.studioProfile.priceMenu as PriceMenuGroup[])[0].items[0].name, 'Deep tissue');
  assert.deepEqual(priceMenuFromShop({ ...shop, priceMenu: [] }), []);
  assert.deepEqual(priceMenuFromShop({}), []);
});

test('TSV imports exact price text into matching groups and appends without mutating the existing menu', () => {
  const pasted = parsePriceMenuPaste('分组\t项目名称\t原价文字\t说明\r\nMassage\tSwedish\t$70 / 60 min\tGentle\r\nFoot\tReflexology\tCall for price\t');
  const original = menu(), before = structuredClone(original);
  const result = appendPriceMenu(original, pasted);
  assert.deepEqual(original, before);
  assert.equal(result[0].items[0].name, 'Deep tissue');
  assert.equal(result[0].items[1].priceText, '$70 / 60 min');
  assert.equal(result[1].items[0].priceText, 'Call for price');
  pasted[0].items[0].name = 'Later paste mutation';
  assert.equal(result[0].items[1].name, 'Swedish');
});

test('invalid paste is rejected as a whole and never silently drops an unparseable line', () => {
  for (const value of ['', 'Name only', 'Group\t\t$80', 'Group\tName\t$80\textra\tunexpected', 'Group\tValid\t$80\nInvalid row']) assert.throws(() => parsePriceMenuPaste(value));
});

test('paste errors use original physical rows after BOM, empty lines, CRLF and an optional header', () => {
  const source = '\uFEFF\r\n \t \r\n分组\t项目名称\t原价文字\t说明\r\n\r\nMassage\tValid item\t$80\tFine\r\n\r\nFoot\t\tCall for price\tNotes';
  const result = analyzePriceMenuPaste(source);
  assert.equal(result.rows, 2); assert.equal(result.errorCount, 1); assert.deepEqual(result.groups, []);
  assert.deepEqual(result.issues.map(({ line, column }) => ({ line, column })), [{ line: 7, column: 2 }]);
  assert.match(result.issues[0].message, /名称不能为空/);
  assert.throws(() => parsePriceMenuPaste(source), /第 7 行第 2 列/);
  const classicMac = analyzePriceMenuPaste('category\tname\tprice_text\rBody\tValid\tCall\rFoot\t\tAsk');
  assert.equal(classicMac.issues[0].line, 3); assert.equal(classicMac.issues[0].column, 2);
});

test('Excel quoting preserves escaped quotes, embedded Tabs and multiline descriptions without deriving prices', () => {
  const source = 'Body\t"Deep ""relax"" massage"\t"From $80 / package"\t"Line one\r\nLine two\tbring a friend"\r\nBody\tConsultation\tCall for price\r\n';
  const result = analyzePriceMenuPaste(source);
  assert.equal(result.rows, 2); assert.equal(result.errorCount, 0); assert.deepEqual(result.issues, []);
  assert.deepEqual(result.groups, [{ category: 'Body', items: [
    { name: 'Deep "relax" massage', priceText: 'From $80 / package', description: 'Line one\nLine two\tbring a friend' },
    { name: 'Consultation', priceText: 'Call for price' },
  ] }]);
  assert.deepEqual(validatePriceMenu(result.groups), result.groups);
  assert.deepEqual(Object.keys(result.groups[0].items[0]), ['name', 'priceText', 'description']);
});

test('errors inside or after quoted multiline records point to the actual physical row', () => {
  const result = analyzePriceMenuPaste('\n分组\t项目名称\t原价文字\t说明\n\nMassage\t\t$80\t\nMassage\tDeep tissue\t$90\t"First line\n<b>Not plain</b>"');
  assert.equal(result.rows, 2); assert.equal(result.errorCount, 2); assert.deepEqual(result.groups, []);
  assert.deepEqual(result.issues.map(({ line, column }) => ({ line, column })), [{ line: 4, column: 2 }, { line: 6, column: 4 }]);
  const afterQuoted = analyzePriceMenuPaste('Body\tGood\t$80\t"First\r\nSecond"\r\n\r\nFoot\t\tCall');
  assert.equal(afterQuoted.issues[0].line, 4); assert.equal(afterQuoted.issues[0].column, 2);
  const control = analyzePriceMenuPaste('Body\tGood\t$80\t"First\nSecond\u0000line"');
  assert.equal(control.issues[0].line, 2); assert.equal(control.issues[0].column, 4);
});

test('Tabs and line breaks inside quoted single-line fields are rejected under their actual field rules', () => {
  for (const [source, column] of [
    ['"Body\tcare"\tName\t$80', 1], ['Body\t"Long\nname"\t$80', 2], ['Body\tName\t"$80\tper person"', 3],
  ] as const) {
    const result = analyzePriceMenuPaste(source);
    assert.equal(result.errorCount, 1); assert.equal(result.issues[0].column, column); assert.match(result.issues[0].message, /Tab 或换行/);
    assert.deepEqual(result.groups, []);
  }
  assert.equal(analyzePriceMenuPaste('Body\tName\t$80\t"Tab\tallowed\nNew line allowed"').errorCount, 0);
});

test('malformed quotes and extra/missing columns reject the whole batch, including valid earlier rows', () => {
  const malformed = [
    'Body\t"Unclosed\t$80', 'Body\tNam"e\t$80', 'Body\t"Name"suffix\t$80',
    'Body\t"Name" \t$80', 'Body\tName\t$80\t"Text"\textra', 'Body\tName',
    '"Body"\t"Name"\t"$80"\t"First\nSecond""',
  ];
  for (const row of malformed) {
    const source = `Body\tEarlier valid item\t$70\n${row}`, result = analyzePriceMenuPaste(source);
    assert.ok(result.errorCount > 0, row); assert.deepEqual(result.groups, [], row); assert.equal(result.rows, 2, row);
    assert.equal(result.issues[0].line, 2, row); assert.throws(() => parsePriceMenuPaste(source));
  }
  const tooMany = analyzePriceMenuPaste('Body\tName\t$80\tDescription\textra');
  assert.equal(tooMany.issues[0].column, 5);
});

test('complete first headers are optional; header-like real names/prices are never silently discarded', () => {
  const data = parsePriceMenuPaste('Category\tName\t$80\n分组\t项目名称\tCall for price');
  assert.equal(data.length, 2); assert.equal(data[0].items[0].name, 'Name'); assert.equal(data[0].items[0].priceText, '$80');
  assert.equal(data[1].items[0].name, '项目名称');
  for (const header of ['category\tname\tprice_text', 'CATEGORY\tNAME\tPriceText\tDescription', '分组\t项目\t价格原文\t说明']) {
    const parsed = analyzePriceMenuPaste(`\n${header}\nBody\tReal item\tFrom $80`);
    assert.equal(parsed.rows, 1); assert.equal(parsed.errorCount, 0); assert.equal(parsed.groups[0].items[0].name, 'Real item');
  }
  const repeated = analyzePriceMenuPaste('分组\t项目名称\t原价文字\nBody\tOne\t$80\n分组\t项目名称\t原价文字\nBody\tTwo\t$90');
  assert.equal(repeated.rows, 2); assert.equal(repeated.errorCount, 1); assert.equal(repeated.issues[0].line, 3);
  assert.match(repeated.issues[0].message, /重复表头/); assert.deepEqual(repeated.groups, []);
});

test('field diagnostics identify spreadsheet columns for length, required name, HTML and control characters', () => {
  for (const [column, invalid, pattern] of [
    [1, 'x'.repeat(201), /200/], [2, 'x'.repeat(301), /300/], [3, 'x'.repeat(301), /300/], [4, 'x'.repeat(2001), /2000/],
    [2, '   ', /不能为空/], [1, '<b>Group</b>', /HTML/], [2, '<img src=x>', /HTML/], [3, '<b>$80</b>', /HTML/],
    [4, 'Notes\u0000', /控制字符/], [3, '$80\u007f', /控制字符/],
  ] as const) {
    const fields = ['Body', 'Name', '$80', 'Notes']; fields[column - 1] = invalid;
    const result = analyzePriceMenuPaste(fields.join('\t'));
    assert.equal(result.errorCount, 1); assert.equal(result.issues[0].line, 1); assert.equal(result.issues[0].column, column);
    assert.match(result.issues[0].message, pattern); assert.deepEqual(result.groups, []);
  }
});

test('diagnostics cap visible issues while counting all invalid data rows, never exposing partial successful data', () => {
  const source = ['分组\t项目名称\t原价文字', 'Body\tValid prefix\t$80', ...Array.from({ length: 25 }, (_, index) => `Body ${index}\t\tCall for price`)].join('\n');
  const result = analyzePriceMenuPaste(source);
  assert.equal(result.rows, 26); assert.equal(result.errorCount, 25); assert.equal(result.issues.length, 20); assert.deepEqual(result.groups, []);
  assert.equal(result.issues[0].line, 3); assert.equal(result.issues[19].line, 22);
  assert.throws(() => parsePriceMenuPaste(source), /共 25 处错误/);
});

test('100 groups and 1000 rows are accepted at the boundary; the first excess physical row makes the batch atomic', () => {
  const thousand = Array.from({ length: PRICE_MENU_LIMITS.items }, (_, index) => `Body\tItem ${index}\tCall for price`).join('\n');
  const accepted = analyzePriceMenuPaste(thousand);
  assert.equal(accepted.errorCount, 0); assert.equal(accepted.rows, 1000); assert.equal(accepted.groups[0].items.length, 1000);
  const excessItem = analyzePriceMenuPaste(`${thousand}\nBody\tOne extra item\t$80`);
  assert.equal(excessItem.issues[0].line, 1001); assert.match(excessItem.issues[0].message, /1000/); assert.deepEqual(excessItem.groups, []);
  const hundred = Array.from({ length: PRICE_MENU_LIMITS.groups }, (_, index) => `Group ${index}\tItem\t$80`).join('\n');
  assert.equal(analyzePriceMenuPaste(hundred).groups.length, 100);
  const excessGroup = analyzePriceMenuPaste(`${hundred}\nOne extra group\tItem\t$80`);
  assert.equal(excessGroup.issues[0].line, 101); assert.equal(excessGroup.issues[0].column, 1); assert.deepEqual(excessGroup.groups, []);
});

test('UTF8 payload and raw paste guards reject oversize batches without trimming away offending rows', () => {
  const source = Array.from({ length: 200 }, (_, index) => `Body\tItem ${index}\t$80\t${'文'.repeat(2000)}`).join('\n');
  const result = analyzePriceMenuPaste(source);
  assert.equal(result.rows, 200); assert.equal(result.errorCount, 1); assert.deepEqual(result.groups, []);
  assert.match(result.issues[0].message, /768 KiB/); assert.ok(result.issues[0].line > 1 && result.issues[0].line < 200);
  const oversized = analyzePriceMenuPaste(' '.repeat(PRICE_MENU_PASTE_LIMITS.characters + 1));
  assert.equal(oversized.rows, 0); assert.equal(oversized.errorCount, 1); assert.deepEqual(oversized.groups, []);
});

test('blank/header-only input and extremely wide nonblank rows remain bounded and cannot become valid data', () => {
  for (const source of ['', '\uFEFF\r\n\t\t \r\n', PRICE_MENU_TEMPLATE_CONTENT.split('\r\n')[0]]) {
    const result = analyzePriceMenuPaste(source);
    assert.equal(result.rows, 0); assert.equal(result.errorCount, 1); assert.deepEqual(result.groups, []); assert.match(result.issues[0].message, /至少一个/);
  }
  const wide = analyzePriceMenuPaste('\t'.repeat(20_000) + 'Actual nonblank cell');
  assert.equal(wide.rows, 1); assert.equal(wide.errorCount, 1); assert.equal(wide.issues[0].column, 5); assert.deepEqual(wide.groups, []);
  const emptyQuotes = analyzePriceMenuPaste('""\t""\t""');
  assert.equal(emptyQuotes.rows, 1); assert.equal(emptyQuotes.issues[0].column, 2);
});

test('downloadable template is a fixed BOM TSV with two synthetic English examples and round-trips through the parser', () => {
  assert.equal(PRICE_MENU_TEMPLATE_FILENAME, 'massajoy-price-menu-template.tsv');
  assert.equal(PRICE_MENU_TEMPLATE_CONTENT.charCodeAt(0), 0xfeff);
  assert.ok(PRICE_MENU_TEMPLATE_CONTENT.startsWith('\uFEFF大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明\r\n'));
  const result = analyzePriceMenuPaste(PRICE_MENU_TEMPLATE_CONTENT);
  assert.equal(result.errorCount, 0); assert.equal(result.rows, 2); assert.equal(result.groups.flatMap(group => group.items).length, 2);
  assert.equal(result.format, 'STRUCTURED');
  assert.deepEqual(result.groups.flatMap(group => group.items.map(item => item.name)), ['30 min Body Massage $50', '60 min Body Massage $80']);
  assert.deepEqual(result.groups.flatMap(group => group.items.map(item => item.priceText)), ['', '']);
  assert.deepEqual(result.groups.flatMap(group => group.items.map(item => [item.pricing?.durationMin, item.pricing?.priceCents])), [[30, 5000], [60, 8000]]);
  assert.equal(Object.hasOwn(result.groups[0].items[0], 'durationMin'), false);
  assert.equal(Object.hasOwn(result.groups[0].items[0], 'priceCents'), false);
});

test('structured six-column TSV accepts all English and Chinese explicit modes without deriving values from labels', () => {
  const header = '大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明';
  const rows = [
    'Body\tBody Massage\tTIMED\t30\t50\tFirst',
    'Body\tBody Massage\t固定时长\t60\t80.05\tSecond',
    'Foot\tFoot Massage\tPER_SESSION\t\t0\t',
    'Foot\tFoot Massage\t按次\t\t50.10\t',
    'Spa\tCustom 60min $200 label\tVARIABLE\t\t99.99\t',
    'Spa\tCustom\t非固定时长\t\t99\t',
    'Add-ons\tEssential Oil\tADD_ON\t\t10\t',
    'Add-ons\tEssential Oil\t附加项目\t\t10.01\t',
  ];
  const result = analyzePriceMenuPaste(header + '\n' + rows.join('\n'));
  assert.equal(result.errorCount, 0); assert.equal(result.rows, 8); assert.equal(result.format, 'STRUCTURED');
  const items = result.groups.flatMap(group => group.items);
  assert.deepEqual(items.map(item => item.pricing?.kind), ['TIMED', 'TIMED', 'PER_SESSION', 'PER_SESSION', 'VARIABLE', 'VARIABLE', 'ADD_ON', 'ADD_ON']);
  assert.deepEqual(items.map(item => item.pricing?.durationMin), [30, 60, null, null, null, null, null, null]);
  assert.deepEqual(items.map(item => item.pricing?.priceCents), [5000, 8005, 0, 5010, 9999, 9900, 1000, 1001]);
  assert.equal(items[4].name, 'Custom 60min $200 label $99.99 · Duration varies');
  assert.equal(items[7].name, 'Essential Oil +$10.01 · Add-on');
  assert.ok(items.every(item => item.priceText === '' && !Object.hasOwn(item, 'durationMin') && !Object.hasOwn(item, 'priceCents')));
  assert.deepEqual(validatePriceMenu(result.groups), result.groups);
});

test('structured TSV preserves quoted multiline descriptions and reports errors at actual physical rows/columns', () => {
  const header = '\uFEFF大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明';
  const good = `${header}\r\nBody\t"Deep ""relax"" massage"\tTIMED\t30\t10.05\t"First\r\nSecond\tcontinued"`;
  const result = analyzePriceMenuPaste(good);
  assert.equal(result.errorCount, 0); assert.equal(result.rows, 1);
  assert.equal(result.groups[0].items[0].description, 'First\nSecond\tcontinued');
  assert.equal(result.groups[0].items[0].name, '30 min Deep "relax" massage $10.05');
  const invalid = analyzePriceMenuPaste(good + '\r\n\r\nBody\tOther\tTIMED\t30.5\t50\t');
  assert.equal(invalid.rows, 2); assert.equal(invalid.errorCount, 1); assert.deepEqual(invalid.groups, []);
  assert.deepEqual(invalid.issues.map(({ line, column }) => ({ line, column })), [{ line: 5, column: 4 }]);
  const html = analyzePriceMenuPaste(`${header}\nBody\tName\tTIMED\t30\t50\t"First\n<b>Not plain</b>"`);
  assert.equal(html.issues[0].line, 3); assert.equal(html.issues[0].column, 6); assert.deepEqual(html.groups, []);
});

test('structured TSV rejects missing, imprecise or mixed units, non-timed minutes and overlong fields without partial data', () => {
  const header = '大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明';
  const base = ['Body', 'Name', 'TIMED', '30', '50', 'Description'];
  for (const [column, value] of [
    [1, 'x'.repeat(201)], [2, ''], [2, 'x'.repeat(201)], [3, 'UNKNOWN'],
    [4, ''], [4, '0'], [4, '-30'], [4, '30.5'], [4, '30min'], [4, '1441'],
    [5, ''], [5, '-1'], [5, '50.001'], [5, '$50'], [5, '1,000'], [5, '50 USD'], [5, '1000000'],
    [6, 'x'.repeat(2001)],
  ] as const) {
    const row = [...base]; row[column - 1] = value;
    const result = analyzePriceMenuPaste(`${header}\nBody\tEarlier valid\tTIMED\t30\t50\t\n` + row.join('\t'));
    assert.equal(result.rows, 2); assert.ok(result.errorCount > 0); assert.deepEqual(result.groups, []);
    assert.equal(result.issues[0].line, 3); assert.equal(result.issues[0].column, column);
  }
  for (const kind of ['PER_SESSION', 'VARIABLE', 'ADD_ON']) {
    const result = analyzePriceMenuPaste(`${header}\nBody\tName\t${kind}\t30\t50\t`);
    assert.equal(result.issues[0].column, 4); assert.deepEqual(result.groups, []);
  }
  for (const duration of [1, 1440]) {
    const result = analyzePriceMenuPaste(`${header}\nBody\tName\tTIMED\t${duration}\t999999.99\t`);
    assert.equal(result.errorCount, 0); assert.equal(result.groups[0].items[0].pricing?.durationMin, duration);
    assert.equal(result.groups[0].items[0].pricing?.priceCents, 99_999_999);
  }
});

test('structured parser requires its header, rejects repeated/mixed headers and preserves old three/four-column wording', () => {
  const header = '大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明';
  const row = 'Body\tName\tTIMED\t30\t50\t';
  assert.deepEqual(analyzePriceMenuPaste(row).groups, []);
  for (const repeated of [header, '分组\t项目名称\t原价文字']) {
    const result = analyzePriceMenuPaste(`${header}\n${row}\n${repeated}`);
    assert.equal(result.errorCount, 1); assert.equal(result.issues[0].line, 3); assert.match(result.issues[0].message, /重复表头/); assert.deepEqual(result.groups, []);
  }
  for (const suffix of ['\textra', '\textra\textra']) {
    const result = analyzePriceMenuPaste(`${header}\n${row}${suffix}`);
    assert.equal(result.issues[0].column, 7); assert.deepEqual(result.groups, []);
  }
  const missing = analyzePriceMenuPaste(`${header}\nBody\tName\tTIMED\t30\t50`);
  assert.equal(missing.issues[0].column, 6); assert.deepEqual(missing.groups, []);
  const legacy = analyzePriceMenuPaste('分组\t项目名称\t原价文字\t说明\nBody\t30mins custom name\tFrom CAD 50 / package\tOriginal note');
  assert.equal(Object.hasOwn(legacy, 'format'), false); assert.equal(legacy.errorCount, 0);
  assert.deepEqual(legacy.groups, [{ category: 'Body', items: [{ name: '30mins custom name', priceText: 'From CAD 50 / package', description: 'Original note' }] }]);
  assert.equal(Object.hasOwn(legacy.groups[0].items[0], 'pricing'), false);
});

test('structured imports keep issue caps, group/item limits and UTF8 budget while rejecting the whole package', () => {
  const header = '大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明';
  const issues = analyzePriceMenuPaste(header + '\n' + Array.from({ length: 25 }, () => 'Body\tName\tTIMED\t30\t\t').join('\n'));
  assert.equal(issues.errorCount, 25); assert.equal(issues.issues.length, 20); assert.equal(issues.issues[19].line, 21); assert.deepEqual(issues.groups, []);
  const thousand = Array.from({ length: 1000 }, (_, i) => `Body\tItem ${i}\tTIMED\t30\t50\t`).join('\n');
  assert.equal(analyzePriceMenuPaste(`${header}\n${thousand}`).errorCount, 0);
  const excess = analyzePriceMenuPaste(`${header}\n${thousand}\nBody\tExtra\tTIMED\t30\t50\t`);
  assert.equal(excess.issues[0].line, 1002); assert.deepEqual(excess.groups, []);
  const groups = analyzePriceMenuPaste(header + '\n' + Array.from({ length: 101 }, (_, i) => `Group ${i}\tItem\tTIMED\t30\t50\t`).join('\n'));
  assert.equal(groups.issues[0].line, 102); assert.match(groups.issues[0].message, /100/); assert.deepEqual(groups.groups, []);
  const large = analyzePriceMenuPaste(header + '\n' + Array.from({ length: 200 }, () => `Body\tName\tTIMED\t30\t50\t${'文'.repeat(2000)}`).join('\n'));
  assert.equal(large.errorCount, 1); assert.match(large.issues[0].message, /768 KiB/); assert.deepEqual(large.groups, []);
});

test('plain text and exact field limits reject malformed or injected structured fields', () => {
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: '', priceText: '$80' }] }]), /名称/);
  assert.throws(() => validatePriceMenu([{ category: 'x'.repeat(201), items: [] }]), /200/);
  assert.throws(() => validatePriceMenu(Array.from({ length: 101 }, () => ({ category: '', items: [] }))), /100/);
  assert.throws(() => validatePriceMenu([{ category: '', items: Array.from({ length: 1001 }, () => ({ name: 'Item', priceText: '$1' })) }]), /1000/);
  for (const bad of ['<script>alert(1)</script>', '<img src=x>', 'Text\u0000']) assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: bad, priceText: '$80' }] }]), /纯文本/);
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: 'Item', priceText: 80 as unknown as string }] }]), /纯文本/);
  assert.throws(() => validatePriceMenu([{ category: '', items: [], address: 'Other store' } as unknown as PriceMenuGroup]), /格式/);
  assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: 'Item', priceText: '$80', priceCents: 8000 } as unknown as PriceMenuGroup['items'][number]] }]), /格式/);
  for (const bad of ['Line\nname', 'Tabbed\tname']) assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: bad, priceText: '$80' }] }]), /纯文本/);
  assert.equal(validatePriceMenu([{ category: '', items: [{ name: 'Item', priceText: '$80', description: 'Line one\r\nLine two' }] }])[0].items[0].description, 'Line one\nLine two');
});

test('total menu size is measured in UTF-8 bytes before saving or applying a pasted batch', () => {
  const large = [{ category: '', items: Array.from({ length: 200 }, () => ({ name: 'Item', priceText: '', description: '文'.repeat(2000) })) }];
  assert.throws(() => validatePriceMenu(large), /768 KiB/);
  const original = menu(), before = structuredClone(original);
  assert.throws(() => appendPriceMenu(original, large), /768 KiB/);
  assert.deepEqual(original, before);
});

test('menu images use safe HTTPS or the exact managed route and reject credential or alternate schemes', () => {
  const managed = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
  assert.equal(safePriceMenuImage(managed), managed);
  assert.equal(safePriceMenuImage(' HTTPS://EXAMPLE.TEST/photo.jpg '), 'https://example.test/photo.jpg');
  for (const bad of ['https:example.test/a.jpg', 'http://example.test/a.jpg', '//example.test/a.jpg', 'data:image/png;base64,x', 'https://user:pass@example.test/a.jpg', managed + '?other=1', 'https://example.test/a\nb.jpg']) {
    assert.equal(safePriceMenuImage(bad), null);
    assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: 'Item', priceText: '$1', imageUrl: bad }] }]));
  }
});

test('display menus retain exact versioned gallery subjects at the key-length boundaries', () => {
  for (const key of ['a', 'body-massage', 'a1--z', 'a'.repeat(80)]) {
    const imageUrl = `/service-gallery/v1/${key}.webp`;
    assert.equal(safePriceMenuImage(imageUrl), imageUrl);
    const value = [{ category: 'Body', items: [{ name: 'Custom wording', priceText: 'Call for price', imageUrl }] }];
    assert.deepEqual(validatePriceMenu(value), value);
  }
});

test('gallery URLs cannot broaden the relative-path allowlist through encoding, traversal, suffixes or alternate namespaces', () => {
  for (const imageUrl of [
    '/service-gallery/v1/.webp', `/service-gallery/v1/${'a'.repeat(81)}.webp`,
    '/service-gallery/v1/1body.webp', '/service-gallery/v1/Body.webp', '/service-gallery/v1/body_massage.webp',
    '/service-gallery/v2/body.webp', '/service-gallery/V1/body.webp', '/Service-gallery/v1/body.webp',
    '/service-gallery/v1/body.WEBP', '/service-gallery/v1/body.jpg', '/service-gallery/v1/body.webp?x=1',
    '/service-gallery/v1/body.webp#x', '/service-gallery/v1/body.webp?', '/service-gallery/v1/body.webp#',
    '/service-gallery/v1/%62ody.webp', '/service-gallery/v1/body%2fother.webp',
    '/service-gallery/v1/../body.webp', '/service-gallery/v1/body/../other.webp',
    '/service-gallery/v1/body.webp/other.webp', '/service-gallery/v1/body\\other.webp',
    '//evil.invalid/service-gallery/v1/body.webp', 'service-gallery/v1/body.webp', '/other/body.webp',
    '/service-gallery/v1/body\nother.webp',
  ]) {
    assert.equal(safePriceMenuImage(imageUrl), null, imageUrl);
    assert.throws(() => validatePriceMenu([{ category: '', items: [{ name: 'Item', priceText: '', imageUrl }] }]), undefined, imageUrl);
  }
});

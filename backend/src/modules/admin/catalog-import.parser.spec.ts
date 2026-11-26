import { CATALOG_MAX_BYTES, catalogId, parseCatalog } from './catalog-import.parser';

const header = 'name,category,duration_minutes,price_usd,description';
const csv = (...rows: string[]) => [header, ...rows].join('\n');
const code = (text: string, expected: string, line?: number) => {
  try { parseCatalog('11', text); throw Error('Expected parser rejection'); }
  catch (error: any) {
    expect(error.getResponse?.().catalogImportCode).toBe(expected);
    if (line) expect(error.getResponse?.().line).toBe(line);
  }
};

describe('catalog CSV/Excel boundary', () => {
  test('accepts reordered Chinese TSV headers, fullwidth parentheses, BOM and CRLF; sorts minutes and merges duplicate cents', () => {
    const text = '\uFEFF价格（USD）\t项目名称\t时长（分钟）\t服务类型\t说明\r\n75.20\tDeep Tissue\t90\t按摩\tPublic text\r\n50\tDeep Tissue\t60\t按摩\tPublic text\r\n050.00\tDeep Tissue\t60\t按摩\tPublic text\r\n\t\t\t\t\r\n';
    const parsed = parseCatalog('11', text);
    expect(parsed).toMatchObject({ inputRows: 3, duplicateRows: 1, groups: [{ name: 'Deep Tissue', category: 'MASSAGE', sourceRows: [2, 3, 4],
      variants: [{ name: '60 min', durationMin: 60, priceCents: 5000, sourceRows: [3, 4] }, { durationMin: 90, priceCents: 7520, sourceRows: [2] }] }] });
  });
  test('quoted commas/tabs/newlines, escaped quote and physical row errors are parsed without split shortcuts', () => {
    const parsed = parseCatalog('11', csv('"Massage, ""Special""",MASSAGE,60,65.09,"First\r\nsecond\tline"'));
    expect(parsed.groups[0]).toMatchObject({ name: 'Massage, "Special"', description: 'First\nsecond\tline', sourceRows: [2] });
    code(csv('"Deep\nTissue",MASSAGE,60,65,'), 'TEXT_INVALID', 2);
    code(csv('Massage,MASSAGE,60,65,"First\nsecond"', 'Foot,REFLEXOLOGY,4,60,'), 'DURATION_INVALID', 4);
  });
  test.each(['"Name,MASSAGE,60,50,', 'Name"bad,MASSAGE,60,50,', '"Name" x,MASSAGE,60,50,', 'Name,MASSAGE,60,50', 'Name,MASSAGE,60,50,,extra'])('rejects malformed or ragged row %s', row => {
    expect(() => parseCatalog('11', csv(row))).toThrow();
  });
  test.each(['name,category,duration_minutes,price_usd,currency', 'name,name,category,duration_minutes,price_usd', 'name,category,duration_minutes,price', 'name,category,duration_minutes,price_usd,constructor', 'name,category,duration_minutes,price_usd,__proto__'])('rejects missing, duplicate and unknown headers %s', value => {
    code(value + '\nMassage,MASSAGE,60,50,', 'HEADERS_INVALID', 1);
  });
  test.each(['0', '0.00', '100000.01', '1.001', '-1', '+1', '$50', '1e2', 'NaN', 'Infinity', '1,000', '1 000', '.5', '5.'])('rejects unsafe USD price %s', value => {
    code(csv(`Massage,MASSAGE,60,"${value}",`), 'PRICE_INVALID', 2);
  });
  test.each([['0.01', 1], ['19.99', 1999], ['100000.00', 10000000], ['007.2', 720]])('converts %s exactly to integer cents', (value, cents) => {
    expect(parseCatalog('11', csv(`Massage,MASSAGE,60,${value},`)).groups[0].variants[0].priceCents).toBe(cents);
  });
  test.each([5, 15, 29, 121, 180, 240])('duration %i is preserved within the booking range', value => {
    expect(parseCatalog('11', csv(`Massage,MASSAGE,${value},50,`)).groups[0].variants[0]).toMatchObject({ name: `${value} min`, durationMin: value });
  });
  test.each(['0', '4', '241', '999', '60.0', '6e1', '+60', ''])('duration %s must not be inferred or clamped', value => code(csv(`Massage,MASSAGE,${value},50,`), 'DURATION_INVALID', 2));
  test('rejects conflicting same duration price, inconsistent grouped names/descriptions and missing categories', () => {
    code(csv('Massage,MASSAGE,60,50,', 'Massage,MASSAGE,60,51,'), 'DURATION_PRICE_CONFLICT', 3);
    code(csv('Massage,MASSAGE,60,50,A', 'massage,MASSAGE,90,75,A'), 'GROUP_CONTENT_CONFLICT', 3);
    code(csv('Massage,MASSAGE,60,50,A', 'Massage,MASSAGE,90,75,B'), 'GROUP_CONTENT_CONFLICT', 3);
    code(csv('Massage,,60,50,'), 'CATEGORY_INVALID', 2);
    code(csv('Massage,足部,60,50,'), 'CATEGORY_INVALID', 2);
  });
  test('names/descriptions normalize NFKC, groups preserve categories, empty rows alone ignored', () => {
    const result = parseCatalog('11', csv('Ｍａｓｓａｇｅ,MASSAGE,60,50, Ｆｏｏ ', ',,,,', 'Massage,OTHER,60,55,Foo'));
    expect(result.groups).toHaveLength(2); expect(result.groups[0]).toMatchObject({ name: 'Massage', description: 'Foo' });
    code(csv(',MASSAGE,60,50,'), 'TEXT_INVALID', 2);
    code(csv('Massage,MASSAGE,60,50,\u0000'), 'TEXT_INVALID', 2);
  });
  test('bounds bytes, rows, groups and unique durations before any data can be written', () => {
    code('x'.repeat(CATALOG_MAX_BYTES + 1), 'TEXT_TOO_LARGE');
    code(csv(...Array.from({ length: 101 }, () => 'Massage,MASSAGE,60,50,')), 'ROW_COUNT_INVALID');
    code(csv(...Array.from({ length: 51 }, (_, n) => `Service ${n},MASSAGE,60,50,`)), 'GROUP_COUNT_INVALID', 52);
    code(csv(...Array.from({ length: 11 }, (_, n) => `Massage,MASSAGE,${30 + n},50,`)), 'VARIANT_COUNT_INVALID', 12);
    code(csv('按摩,MASSAGE,60,50,' + '中'.repeat(21000)), 'TEXT_TOO_LARGE');
  });
  test('binds normalized package digest to the captured shop and logical values, rejects noncanonical int64 IDs', () => {
    const text = csv('Massage,MASSAGE,60,50,');
    expect(parseCatalog('11', text).packageDigest).not.toBe(parseCatalog('12', text).packageDigest);
    expect(parseCatalog('11', text).packageDigest).toBe(parseCatalog('11', text.replace('50,', '50.00,')).packageDigest);
    for (const id of ['0', '01', '9223372036854775808', '1e1', 11, null]) expect(catalogId(id)).toBe(false);
    expect(catalogId('9223372036854775807')).toBe(true);
  });
});

import { inferStoreTimezone, storeZipStateConflict, usStateCodeFromZip } from './store-timezone';

describe('store address timezone inference', () => {
  test.each([
    ['Victoria', 'British Columbia', 'BC', 'America/Vancouver'],
    ['Calgary', 'Alberta', 'AB', 'America/Edmonton'],
    ['Winnipeg', 'Manitoba', 'MB', 'America/Winnipeg'],
    ['Fredericton', 'New Brunswick', 'NB', 'America/Moncton'],
    ['St Johns', 'Newfoundland and Labrador', 'NL', 'America/St_Johns'],
    ['Halifax', 'Nova Scotia', 'NS', 'America/Halifax'],
    ['Toronto', 'Ontario', 'ON', 'America/Toronto'],
    ['Charlottetown', 'Prince Edward Island', 'PE', 'America/Halifax'],
    ['Montreal', 'Quebec', 'QC', 'America/Toronto'],
    ['Regina', 'Saskatchewan', 'SK', 'America/Regina'],
    ['Whitehorse', 'Yukon', 'YT', 'America/Whitehorse'],
    ['Yellowknife', 'Northwest Territories', 'NT', 'America/Yellowknife'],
    ['Iqaluit', 'Nunavut', 'NU', 'America/Iqaluit'],
  ])('%s accepts either the full province name or abbreviation', (city, name, code, expected) => {
    expect(inferStoreTimezone(city, name)).toBe(expected);
    expect(inferStoreTimezone(city, code)).toBe(expected);
  });

  test.each([
    ['Houghton', 'MI', '49931', 'America/New_York'],
    ['Somerset', 'KY', '42501', 'America/New_York'],
    ['Elizabethtown', 'KY', '42701', 'America/New_York'],
    ['Dunlap', 'TN', '37327', 'America/Chicago'],
    ['Apalachicola', 'FL', '32320', 'America/New_York'],
    ['Port St Joe', 'FL', '32456', 'America/New_York'],
    ['Vincennes', 'IN', '47591', 'America/New_York'],
    ['Williston', 'ND', '58801', 'America/Chicago'],
    ['Watford City', 'ND', '58854', 'America/Chicago'],
    ['El Paso', 'TX', '79925', 'America/Denver'],
    ['Crown Point', 'IN', '46307', 'America/Chicago'],
    ['Owensboro', 'KY', '42301', 'America/Chicago'],
    ['Garden City', 'KS', '67846', 'America/Chicago'],
    ['Dodge City', 'KS', '67801', 'America/Chicago'],
    ['Goodland', 'KS', '67735', 'America/Denver'],
  ])('%s uses city and state boundaries rather than broad ZIP timezone prefixes', (city, state, zip, expected) => {
    expect(inferStoreTimezone(city, state, zip)).toBe(expected);
  });

  test('a stale ZIP cannot move an explicitly entered city/state to another timezone', () => {
    expect(inferStoreTimezone('Seattle', 'Washington', '79901')).toBe('America/Los_Angeles');
    expect(storeZipStateConflict('Washington', '79901')).toEqual({ enteredState: 'WA', zipState: 'TX' });
    expect(storeZipStateConflict('Washington', '98144')).toBeNull();
    expect(inferStoreTimezone('Vancouver', 'British Columbia', '79901')).toBe('America/Vancouver');
    expect(inferStoreTimezone('Montréal', 'Québec', 'H2Y 1C6')).toBe('America/Toronto');
  });

  test('ZIP state hints preserve leading zeroes, reject incomplete ZIPs, and cover postal exceptions', () => {
    expect(usStateCodeFromZip('02116')).toBe('MA');
    expect(usStateCodeFromZip('98144-1234')).toBe('WA');
    expect(usStateCodeFromZip('98144junk')).toBe('');
    expect(usStateCodeFromZip('9814')).toBe('');
    expect(usStateCodeFromZip('')).toBe('');
    expect(storeZipStateConflict('Texas', '73301')).toBeNull();
    expect(storeZipStateConflict('New York', '06390')).toBeNull();
    expect(inferStoreTimezone('Seattle', '', '98144')).toBe('America/Los_Angeles');
    expect(inferStoreTimezone('', '', '')).toBe('');
  });
});

'use strict';

const crypto = require('node:crypto');
const { hash } = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { parseDay, optionBookingPolicy, validOption } = require('./lib/legacy-booking.cjs');
const { selectLegacyStoreShortLinks } = require('./lib/legacy-store-short-links.cjs');

const SOURCE_DB = 'mj_legacy_source';
const TARGET_DB_PATTERN = /^mj2_store_migration_[a-f0-9]{8}$/;
const IMPORT_SOURCE = 'Massajoy1.0';
const APPLY_FLAGS = ['--apply', '--acknowledge-local-only'];
const args = new Set(process.argv.slice(2));

function parseUrl(value, label, expectedDb) {
  let url;
  try { url = new URL(value || ''); } catch { throw new Error(label + ' database URL is required'); }
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '33089' || url.search || url.hash || url.username === '' || url.password === '') {
    throw new Error(label + ' must use the isolated local MySQL endpoint on port 33089');
  }
  if (typeof expectedDb === 'string' && db !== expectedDb) throw new Error(label + ' database name is not the expected isolated schema');
  if (expectedDb instanceof RegExp && !expectedDb.test(db)) throw new Error(label + ' database name must be a dedicated migration schema');
  url.pathname = '/' + db;
  return url.toString();
}

function text(value, limit = 20000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u0000/g, '').trim().slice(0, limit);
}

function plainText(value, limit = 20000) {
  return text(value, limit).replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cents(value) {
  const raw = text(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const amount = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return amount <= 99999999n ? Number(amount) : null;
}

function integer(value, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function dateFromEpoch(value) {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return new Date();
  const result = new Date(seconds * 1000);
  return Number.isNaN(result.getTime()) ? new Date() : result;
}

function safeHttps(value) {
  const candidate = text(value, 500);
  if (!candidate || /[\s\\\u0000-\u001f\u007f]/u.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};
const US_STATE_CODES = new Map(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
const US_STATE_PATTERN = [...new Set([...Object.keys(US_STATES), ...Object.values(US_STATES)])]
  .sort((left, right) => right.length - left.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

function normalizeUsState(value) {
  const candidate = plainText(value, 100).replace(/\.$/, '').trim();
  if (!candidate) return '';
  if (US_STATES[candidate.toUpperCase()]) return US_STATES[candidate.toUpperCase()];
  const code = US_STATE_CODES.get(candidate.toLowerCase());
  return code ? US_STATES[code] : candidate;
}

function parseUsAddress(value) {
  const parts = plainText(value, 500).split(',').map(part => part.trim()).filter(Boolean);
  while (parts.length && /^(USA|United States)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 3) return { street: parts[0] || '', city: '', state: '', zipCode: '' };

  let stateIndex = -1;
  let state = '';
  let zipCode = '';
  for (let index = parts.length - 1; index >= 1; index--) {
    const match = parts[index].match(new RegExp('(?:^|\\s)(' + US_STATE_PATTERN + ')\\s*,?\\s*(\\d{5}(?:-\\d{4})?)\\s*$', 'i'));
    if (!match) continue;
    const normalized = normalizeUsState(match[1]);
    if (!US_STATES[US_STATE_CODES.get(normalized.toLowerCase())] && !Object.values(US_STATES).includes(normalized)) continue;
    stateIndex = index;
    state = normalized;
    zipCode = match[2];
    break;
  }
  if (stateIndex < 0) return { street: parts[0], city: '', state: '', zipCode: '' };
  const city = stateIndex > 1 ? parts[stateIndex - 1] : '';
  const street = parts.slice(0, Math.max(1, stateIndex - 1)).join(', ');
  return { street, city, state, zipCode };
}

function legacyLocation(row) {
  const rawAddress = plainText(row.address, 500) || [row.addr, row.house_number, row.address_extra].map(value => plainText(value, 255)).filter(Boolean).join(' ');
  const parsed = parseUsAddress(rawAddress);
  const zipSource = plainText(row.zipcode, 10);
  const zipCode = /^\d{5}(?:-\d{4})?$/.test(zipSource) ? zipSource : parsed.zipCode;
  return {
    rawAddress,
    address: (parsed.street || rawAddress).slice(0, 500),
    city: plainText(row.city, 100) || parsed.city,
    state: normalizeUsState(row.province) || parsed.state,
    zipCode,
  };
}

function legacyMapShareUrl(row, latitude, longitude) {
  const legacyLink = safeHttps(row.google_map_share_url) || safeHttps(row.google_map);
  if (legacyLink) return legacyLink;
  if (latitude === 0 || longitude === 0) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(latitude + ',' + longitude);
}

function jsonValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function contactList(primary, extra, email = false) {
  const values = [primary];
  const parsed = jsonValue(extra);
  if (Array.isArray(parsed)) values.push(...parsed);
  else if (typeof extra === 'string') values.push(...extra.split(/[;,]/));
  const result = [];
  for (const value of values) {
    const item = text(value, email ? 255 : 40);
    if (!item || (email ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item) : !/^[+0-9(). \-]{7,40}$/.test(item))) continue;
    if (!result.includes(item)) result.push(item);
    if (result.length === 5) break;
  }
  return result;
}

function mediaList(value) {
  const parsed = jsonValue(value);
  const items = Array.isArray(parsed) ? parsed : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(items.map(safeHttps).filter(Boolean))].slice(0, 20);
}

function shortName(row) {
  const source = text(row.name, 200);
  const slug = source.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'legacy-store';
  return slug + '-' + String(row.id);
}

function planShortLinks(rows) {
  const shortNames = new Map();
  const generatedOwners = new Map();
  for (const row of rows) {
    const sourceId = String(row.id);
    const generated = shortName(row).replace(/--(?=\d+$)/, '-');
    const fallback = /^store-\d+$/.test(generated) ? 'legacy-' + generated : generated;
    shortNames.set(sourceId, { canonical: fallback, aliases: [fallback] });
    generatedOwners.set(fallback, sourceId);
  }
  const { links, skipped } = selectLegacyStoreShortLinks(rows);
  let retained = 0;
  for (const { legacyId, value } of links) {
    const owner = generatedOwners.get(value);
    if (owner !== undefined && owner !== legacyId) {
      skipped.push({ reason: 'generated-conflict', legacyIds: [legacyId], value });
      continue;
    }
    const store = shortNames.get(legacyId);
    store.canonical = value;
    if (owner === undefined) store.aliases.push(value);
    retained++;
  }
  return { shortNames, retained, skipped };
}

function legacyLoginName(value, sourceId) {
  const source = plainText(value, 100).normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[-_.]+$/g, '').slice(0, 48);
  return 'm1-' + (source.length >= 3 ? source : 'store') + '-' + String(sourceId);
}

function randomStorePassword() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password;
  do { password = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (!/[a-zA-Z]/.test(password) || !/\d/.test(password));
  return password;
}

function categoryName(project, categories) {
  const id = text(project.cid).split(',')[0].trim();
  const original = text(categories.get(id), 200);
  const token = (original + ' ' + text(project.name, 200) + ' ' + text(project.service_cate_info, 500)).toLowerCase();
  if (/\bfoot\b|足疗|足部/u.test(token)) return 'Foot Massage';
  if (/\bbody\b|全身/u.test(token)) return 'Body Massage';
  if (/\bhead\b|头疗/u.test(token)) return 'Head Therapy';
  if (/\bcup|罐\b/u.test(token)) return 'Cupping';
  if (/\bscrap|gua|刮痧/u.test(token)) return 'Scraping';
  if (/\bbeauty\b|美容/u.test(token)) return 'Beauty';
  if (/\bmassage\b|按摩/u.test(token)) return 'Massage';
  return 'Other Services';
}

function serviceCategory(group) {
  if (group === 'Massage' || group === 'Body Massage') return 'MASSAGE';
  if (group === 'Foot Massage') return 'REFLEXOLOGY';
  if (group === 'Cupping') return 'CUPPING';
  if (group === 'Scraping') return 'SCRAPING';
  if (group === 'Head Therapy') return 'HEAD_THERAPY';
  return 'OTHER';
}

function validTimezone(value) {
  const candidate = text(value, 100);
  if (!candidate) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: candidate }); return candidate; }
  catch { return null; }
}

function externalLinks(value) {
  const parsed = jsonValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result = {};
  const website = safeHttps(parsed.website || parsed.web || parsed.url);
  if (website) result.website = website;
  for (const field of ['instagram', 'facebook']) {
    const url = safeHttps(parsed[field]);
    if (!url) continue;
    try {
      const host = new URL(url).hostname.toLowerCase();
      const domains = field === 'instagram' ? ['instagram.com'] : ['facebook.com', 'fb.com'];
      if (domains.some(domain => host === domain || host.endsWith('.' + domain))) result[field] = url;
    } catch { /* Ignore invalid legacy URLs. */ }
  }
  return result;
}

function stringList(value, limit = 20) {
  const parsed = jsonValue(value);
  const values = Array.isArray(parsed) ? parsed : typeof value === 'string' ? value.split(/[;,]/) : [];
  return [...new Set(values.map(item => plainText(item, 100)).filter(Boolean))].slice(0, limit);
}

function shopStatus(row) {
  if (Number(row.delete_time) > 0 || Number(row.status) === 2) return 'SUSPENDED';
  return 'APPROVED';
}

async function loadSource(source) {
  const [shopRowStats, shops, projects, prices, technicians, categories, coupons, giftCards, ratings] = await Promise.all([
    source.$queryRawUnsafe("SELECT COUNT(*) AS total, SUM(name IS NULL OR TRIM(name)='') AS unnamed FROM merchant"),
    source.$queryRawUnsafe("SELECT id,uid,name,account,contact_name,sub_name,redirect,province,city,area,addr,house_number,zipcode,address,address_extra,lat,lng,logo,phone,phone_more,customer_tel,email,email_more,img,intro,content,notice,tags,links,google_map,google_map_share_url,company_cert_img,cert_img,video,video_img,sort,score,ser_comment_num,start_time,end_time,utc,monday_state,monday_time,tuesday_state,tuesday_time,wednesday_state,wednesday_time,thursday_state,thursday_time,friday_state,friday_time,saturday_state,saturday_time,sunday_state,sunday_time,status,is_auth,is_up,is_open,create_time,delete_time FROM merchant WHERE name IS NOT NULL AND TRIM(name)<>'' ORDER BY id"),
    source.$queryRawUnsafe("SELECT id,cid,mch_id,name,sub_name,img,duration,intro,content,sort,status,create_time,delete_time,service_cate_info FROM pro_project WHERE mch_id IS NOT NULL ORDER BY id"),
    source.$queryRawUnsafe("SELECT id,pid,img,name,price,price_vip,og_price,price_minute,times,minute,sort FROM pro_price WHERE pid IS NOT NULL ORDER BY pid,sort,id"),
    source.$queryRawUnsafe("SELECT id,mch_id,name,gender,avatar,img,exp_intro,intro,ser_intro,status,ser_running,sort,create_time,delete_time FROM master WHERE mch_id IS NOT NULL ORDER BY mch_id,sort,id"),
    source.$queryRawUnsafe("SELECT id,name FROM pro_cate"),
    source.$queryRawUnsafe("SELECT id,mch_id,type,platform,name,money,full_money,price,num,use_num,award_times,expire_day,DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date,status,reg_send,is_req,is_recharge,recharge_num,recharge_money,content,goods,stores,content_ban,delete_time,create_time FROM coupon WHERE mch_id IS NOT NULL AND mch_id>0 ORDER BY mch_id,id"),
    source.$queryRawUnsafe("SELECT id,mch_id,type,cid,name,sub_name,img,money,full_money,minute,price,num,use_num,expire_day,use_times,DATE_FORMAT(start_time,'%Y-%m-%d %H:%i:%s') AS start_time,DATE_FORMAT(end_time,'%Y-%m-%d %H:%i:%s') AS end_time,service_cate_ids,service_cate_info,intro,content,goods,price_attrs,status,reg_send,is_req,is_recharge,recharge_num,recharge_money,province,city,area,sort,delete_time,create_time FROM gift_card WHERE mch_id IS NOT NULL AND mch_id>0 ORDER BY mch_id,id"),
    source.$queryRawUnsafe("SELECT mch_id,COUNT(*) AS review_count,AVG(level) AS avg_rating FROM comment WHERE mch_id IS NOT NULL AND COALESCE(delete_time,0)=0 AND COALESCE(status,1)=1 AND COALESCE(public,1)=1 GROUP BY mch_id"),
  ]);
  return { shopRowStats: shopRowStats[0], shops, projects, prices, technicians, categories, coupons, giftCards, ratings };
}

function buildPlan(data) {
  const shopIds = new Set(data.shops.map(row => String(row.id)));
  const { shortNames, retained, skipped } = planShortLinks(data.shops);
  const projectByShop = new Map();
  const pricesByProject = new Map();
  const techniciansByShop = new Map();
  const couponsByShop = new Map();
  const giftsByShop = new Map();
  const categories = new Map(data.categories.map(row => [String(row.id), text(row.name, 200)]));
  for (const row of data.projects) if (shopIds.has(String(row.mch_id))) {
    const key = String(row.mch_id);
    if (!projectByShop.has(key)) projectByShop.set(key, []);
    projectByShop.get(key).push(row);
  }
  for (const row of data.prices) {
    const key = String(row.pid);
    if (!pricesByProject.has(key)) pricesByProject.set(key, []);
    pricesByProject.get(key).push(row);
  }
  for (const [rows, map] of [[data.technicians, techniciansByShop], [data.coupons, couponsByShop], [data.giftCards, giftsByShop]]) {
    for (const row of rows) if (shopIds.has(String(row.mch_id))) {
      const key = String(row.mch_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
  }
  const ratingMap = new Map(data.ratings.map(row => [String(row.mch_id), row]));
  const menus = new Map();
  const services = new Map();
  const variants = new Map();
  const menuCounters = { timedLinked: 0, displayOnly: 0 };
  for (const row of data.shops) {
    const sid = String(row.id);
    const groups = new Map();
    let serviceCount = 0, variantCount = 0, menuCount = 0;
    for (const project of projectByShop.get(sid) || []) {
      const groupName = categoryName(project, categories);
      const groupKey = groupName;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      const pricesForProject = pricesByProject.get(String(project.id)) || [];
      const serviceName = plainText(project.name, 200) || ('待整理项目 ' + String(project.id));
      const sourceCategoryNames = text(project.cid).split(',')
        .map(id => plainText(categories.get(id.trim()), 200)).filter(Boolean);
      const parentName = [serviceName, ...sourceCategoryNames].join(' ');
      const sourceActive = Number(project.status) === 1 && Number(project.delete_time || 0) === 0;
      const policyGroups = new Map();
      // A source project can mix ordinary, couple, four-hands and prepaid rows.
      // Group canonical booking services by the exact option's resource policy;
      // leave the customer price-menu category and source option order intact.
      for (const price of pricesForProject.length ? pricesForProject : [null]) {
        const policy = optionBookingPolicy(plainText(price?.name, 300), parentName);
        const mode = policy?.mode || 'DISPLAY_ONLY';
        if (!policyGroups.has(mode)) policyGroups.set(mode, { policy, prices: [] });
        if (price) policyGroups.get(mode).prices.push(price);
      }
      const candidatesByPrice = new Map();
      if (!services.has(sid)) services.set(sid, []);
      for (const [mode, { policy, prices }] of policyGroups) {
        const timedPrices = prices.map(price => ({
          row: price,
          duration: integer(price.minute, 1, 1440),
          priceCents: cents(price.price),
        })).filter(value => value.duration !== null && value.priceCents !== null && value.priceCents > 0)
          .map(value => ({ ...value, isActive: sourceActive && !!policy && validOption({ durationMin: value.duration, priceCents: value.priceCents }) }));
        // Keep fallback duration and price from one option within the same policy.
        const base = timedPrices.find(value => value.isActive) || timedPrices[0];
        const split = policyGroups.size > 1;
        const suffix = { SINGLE: 'Single Massage', COUPLE: 'Couple Massage', FOUR_HANDS: 'Four Hands Massage', DISPLAY_ONLY: 'Needs Review' }[mode];
        const name = split ? (serviceName + ' · ' + suffix).slice(0, 200) : serviceName;
        const serviceKey = sid + ':' + String(project.id) + (split ? ':' + mode : '');
        services.get(sid).push({ row: project, name, category: groupName, duration: base?.duration ?? 0, priceCents: base?.priceCents ?? 0,
          timedPrices, serviceKey, policy, isActive: timedPrices.some(value => value.isActive) });
        for (const candidate of timedPrices) candidatesByPrice.set(String(candidate.row.id), { candidate, policy });
        serviceCount++;
        variantCount += timedPrices.length;
      }
      if (!pricesForProject.length) {
        groups.get(groupKey).push({ id: 'legacy-project-' + project.id, name: serviceName, priceText: 'Price and duration require review', description: plainText(project.intro || project.sub_name, 2000) });
        menuCount++;
        menuCounters.displayOnly++;
      }
      for (const price of pricesForProject) {
        const { candidate, policy } = candidatesByPrice.get(String(price.id)) || {};
        const name = plainText(price.name, 300) || serviceName;
        const rawPrice = cents(price.price);
        const priceLabel = rawPrice === null ? 'Price requires review' : '$' + (rawPrice / 100).toFixed(rawPrice % 100 ? 2 : 0);
        const durationLabel = integer(price.minute, 1, 1440) === null ? '' : integer(price.minute, 1, 1440) + ' min · ';
        const item = {
          id: 'legacy-price-' + String(price.id),
          name,
          priceText: durationLabel + priceLabel,
          ...(plainText(project.intro || project.sub_name, 2000) ? { description: plainText(project.intro || project.sub_name, 2000) } : {}),
          ...(safeHttps(price.img) || safeHttps((text(project.img, 600).split(',')[0] || '')) ? { imageUrl: safeHttps(price.img) || safeHttps(text(project.img, 600).split(',')[0]) } : {}),
        };
        if (candidate) {
          const legacyPrice = [
            'price=' + text(price.price),
            'price_vip=' + text(price.price_vip),
            'og_price=' + text(price.og_price),
            'price_minute=' + text(price.price_minute),
            'times=' + text(price.times),
          ].filter(value => !value.endsWith('=')).join('; ').slice(0, 300);
          item.pricing = {
            kind: 'TIMED',
            baseName: plainText(project.name, 200) || serviceName,
            durationMin: candidate.duration,
            priceCents: candidate.priceCents,
            titleMode: 'CUSTOM',
            legacySource: { name: name.slice(0, 300), priceText: legacyPrice.slice(0, 300) },
          };
          if (policy) {
            item.__variantSourceId = String(price.id);
            menuCounters.timedLinked++;
          } else {
            menuCounters.displayOnly++;
          }
        } else {
          menuCounters.displayOnly++;
        }
        groups.get(groupKey).push(item);
        menuCount++;
      }
    }
    const itemCount = menuCount;
    if (groups.size > 100 || itemCount > 1000) throw new Error('A source shop exceeds 2.0 price-menu limits; the import is blocked rather than dropping rows');
    menus.set(sid, [...groups.entries()].map(([category, items]) => ({ category, items })));
    const menuBytes = Buffer.byteLength(JSON.stringify(menus.get(sid)), 'utf8');
    if (menuBytes > 768 * 1024) throw new Error('A source shop exceeds 2.0 price-menu byte limits; the import is blocked rather than dropping rows');
    variants.set(sid, variantCount);
  }
  const sourceDigest = crypto.createHash('sha256').update(JSON.stringify({
    shopRowStats: data.shopRowStats,
    shops: data.shops, projects: data.projects, prices: data.prices, technicians: data.technicians,
    categories: data.categories, coupons: data.coupons, giftCards: data.giftCards, ratings: data.ratings,
    shortLinks: [...shortNames],
  }, (_key, value) => typeof value === 'bigint' ? String(value) : value)).digest('hex');
  const totalShopRows = Number(data.shopRowStats.total || 0);
  const summary = {
    shops: data.shops.length,
    namedStores: data.shops.length,
    sourceShopRows: totalShopRows,
    sourceShopRowsWithoutName: Number(data.shopRowStats.unnamed || 0),
    retainedShortLinks: retained,
    skippedShortLinks: skipped.reduce((result, { reason }) => {
      result[reason] = (result[reason] ?? 0) + 1;
      return result;
    }, {}),
    softDeletedStores: data.shops.filter(row => Number(row.delete_time) > 0).length,
    projects: [...services.values()].reduce((total, rows) => total + rows.length, 0),
    activeServices: [...services.values()].flat().filter(service => service.isActive).length,
    activeVariants: [...services.values()].flat().reduce((total, service) => total + service.timedPrices.filter(option => option.isActive).length, 0),
    ambiguousServices: [...services.values()].flat().filter(service => !service.policy).length,
    technicians: [...techniciansByShop.values()].reduce((total, rows) => total + rows.length, 0),
    priceMenuItems: [...menus.values()].reduce((total, groups) => total + groups.reduce((sum, group) => sum + group.items.length, 0), 0),
    linkedTimedItems: menuCounters.timedLinked,
    displayOnlyItems: menuCounters.displayOnly,
    shopCouponDefinitions: [...couponsByShop.values()].reduce((total, rows) => total + rows.length, 0),
    shopGiftProductDefinitions: [...giftsByShop.values()].reduce((total, rows) => total + rows.length, 0),
    sourceRowsExcluded: ['unnamed merchant placeholders', 'customers', 'orders', 'payments', 'refunds', 'individual coupon claims', 'gift-card purchases and balances', 'legacy passwords and login secrets', 'payment provider settings', 'certificate files', 'platform statistics'],
    migratedStoreAccounts: data.shops.length,
  };
  return { data, shopIds, shortNames, projectByShop, pricesByProject, techniciansByShop, couponsByShop, giftsByShop, categories, ratingMap, menus, services, variants, sourceDigest, summary };
}

function businessHours(row, warningDays) {
  const out = {};
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    const parsed = parseDay(row[day + '_state'], row[day + '_time']);
    if (parsed.warning) warningDays.push(day);
    if (parsed.value !== null) out[day] = parsed.value;
  }
  return out;
}

function serviceImportData(service, shopId, fallbackSortOrder) {
  return {
    shopId,
    name: service.name,
    category: serviceCategory(service.category),
    durationKind: service.duration > 0 ? 'TIMED' : 'VARIABLE',
    durationMin: service.duration,
    priceCents: service.priceCents,
    priceBasis: 'PER_BOOKING',
    participantCount: service.policy?.participantCount ?? 1,
    requiredStaffCount: service.policy?.requiredStaffCount ?? 1,
    description: plainText(service.row.intro || service.row.sub_name || service.row.content, 10000) || null,
    isActive: service.isActive,
    sortOrder: integer(service.row.sort, 0, 2147483647) ?? fallbackSortOrder,
  };
}

function variantImportData(option, serviceId, fallbackSortOrder) {
  return {
    serviceId,
    name: plainText(option.row.name, 100) || (option.duration + ' min'),
    durationMin: option.duration,
    priceCents: option.priceCents,
    priceBasis: 'PER_BOOKING',
    currency: 'usd',
    isActive: option.isActive,
    sortOrder: integer(option.row.sort, 0, 2147483647) ?? fallbackSortOrder,
  };
}

function rawBusinessHours(row) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return Object.fromEntries(days.map(day => [day, {
    state: row[day + '_state'] === null || row[day + '_state'] === undefined ? null : Number(row[day + '_state']),
    time: text(row[day + '_time'], 1000),
  }]));
}

function dateOnly(value, fallback) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
  const raw = text(value, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const result = new Date(raw + 'T00:00:00.000Z');
  return Number.isNaN(result.getTime()) ? fallback : result;
}

function couponRows(plan, sourceShopId) {
  const rows = plan.couponsByShop.get(sourceShopId) || [];
  return rows.filter(row => Number(row.delete_time || 0) === 0).map(row => {
    const value = cents(row.money);
    const threshold = cents(row.full_money) ?? 0;
    if (value === null || value <= 0) return null;
    return {
      title: plainText(row.name, 200) || ('旧版优惠券 ' + String(row.id)),
      description: '旧版权益领取记录和使用状态未迁移；草稿，需核对规则后启用。',
      type: 'FIXED_AMOUNT',
      value,
      minSpendCents: threshold,
      totalQuantity: integer(row.num, 0, 2147483647) ?? 0,
      claimedCount: 0,
      usedCount: 0,
      perUserLimit: 1,
      validFrom: dateOnly(row.start_date, dateFromEpoch(row.create_time)),
      validUntil: dateOnly(row.end_date, null),
      status: 'DRAFT',
    };
  }).filter(Boolean);
}

function giftRows(plan, sourceShopId) {
  return (plan.giftsByShop.get(sourceShopId) || []).filter(row => Number(row.delete_time || 0) === 0).map(row => {
    const priceCents = cents(row.price);
    const useTimes = integer(row.use_times, 1, 10000) ?? 1;
    const expireDays = integer(row.expire_day, 1, 3650) ?? 365;
    if (priceCents === null || priceCents <= 0 || useTimes === null || expireDays === null) return null;
    return {
      title: plainText(row.name, 200) || ('旧版礼品卡 ' + String(row.id)),
      description: (plainText(row.intro || row.sub_name || row.content, 10000) + '\n旧版购买记录和余额未迁移；草稿，需核对后启用。'
        + (integer(row.expire_day, 1, 3650) === null ? ' 旧版有效期缺失，暂以草稿默认值保存。' : '')
        + (integer(row.use_times, 1, 10000) === null ? ' 旧版使用次数缺失，暂以草稿默认值保存。' : '')).trim(),
      priceCents,
      useTimes,
      expireDays,
      status: 'DRAFT',
    };
  }).filter(Boolean);
}

function legacyCouponDefinitions(plan, sourceShopId) {
  return (plan.couponsByShop.get(sourceShopId) || []).map(row => ({
    sourceId: String(row.id),
    name: plainText(row.name, 500),
    type: row.type === null ? null : Number(row.type),
    platform: text(row.platform, 40) || null,
    money: text(row.money, 40) || null,
    fullMoney: text(row.full_money, 40) || null,
    price: text(row.price, 40) || null,
    quantity: row.num === null ? null : Number(row.num),
    issuedCount: row.award_times === null ? null : Number(row.award_times),
    usedCount: row.use_num === null ? null : Number(row.use_num),
    expireDays: row.expire_day === null ? null : Number(row.expire_day),
    startDate: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : text(row.start_date, 20) || null,
    endDate: row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : text(row.end_date, 20) || null,
    oldStatus: row.status === null ? null : Number(row.status),
    registrationReward: Number(row.reg_send) === 1,
    requestOnly: Number(row.is_req) === 1,
    rechargeRule: Number(row.is_recharge) === 1,
    rechargeCount: row.recharge_num === null ? null : Number(row.recharge_num),
    rechargeAmount: text(row.recharge_money, 40) || null,
    description: plainText(row.content, 5000),
    eligibleGoods: plainText(row.goods, 2000),
    storeScope: plainText(row.stores, 2000),
    exclusions: plainText(row.content_ban, 2000),
    wasDeleted: Number(row.delete_time || 0) > 0,
  }));
}

function legacyGiftDefinitions(plan, sourceShopId) {
  return (plan.giftsByShop.get(sourceShopId) || []).map(row => ({
    sourceId: String(row.id),
    name: plainText(row.name, 1000),
    subtitle: plainText(row.sub_name, 1000),
    originalImages: mediaList(row.img),
    faceValue: text(row.money, 40) || null,
    fullValue: text(row.full_money, 40) || null,
    durationMinutes: row.minute === null ? null : Number(row.minute),
    salePrice: text(row.price, 40) || null,
    quantity: row.num === null ? null : Number(row.num),
    soldCount: row.use_num === null ? null : Number(row.use_num),
    uses: row.use_times === null ? null : Number(row.use_times),
    expireDays: row.expire_day === null ? null : Number(row.expire_day),
    startsAt: row.start_time instanceof Date ? row.start_time.toISOString() : text(row.start_time, 30) || null,
    endsAt: row.end_time instanceof Date ? row.end_time.toISOString() : text(row.end_time, 30) || null,
    serviceCategories: plainText(row.service_cate_info, 2000),
    introduction: plainText(row.intro, 5000),
    description: plainText(row.content, 5000),
    eligibleGoods: plainText(row.goods, 2000),
    priceAttributes: plainText(row.price_attrs, 5000),
    oldStatus: row.status === null ? null : Number(row.status),
    wasDeleted: Number(row.delete_time || 0) > 0,
  }));
}

async function ensureEmptyTarget(target) {
  const dbName = await target.$queryRawUnsafe('SELECT DATABASE() AS name');
  const tables = await Promise.all([
    target.shop.count(), target.shopAlias.count(), target.user.count(), target.shopService.count(), target.therapist.count(),
    target.coupon.count(), target.giftCardProduct.count(), target.booking.count(),
  ]);
  if (String(dbName[0]?.name || '') !== decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
    || tables.some(count => count !== 0)) throw new Error('Target database is not the expected empty migration database; no writes were made');
}

async function applyPlan(plan, target) {
  await ensureEmptyTarget(target);
  const sourceShopIds = [...plan.shopIds];
  const outcome = await target.$transaction(async tx => {
    let projectCount = 0, variantCount = 0, technicianCount = 0, couponCount = 0, giftCount = 0, imageCount = 0;
    for (const sourceId of sourceShopIds) {
      const row = plan.data.shops.find(item => String(item.id) === sourceId);
      const shortLinks = plan.shortNames.get(sourceId);
      // No legacy password, phone, email, or provider identity is copied into this placeholder.
      const owner = await tx.user.create({ data: {
        loginName: 'legacy-store-' + sourceId,
        name: '旧系统门店账号待认领',
        role: 'MERCHANT',
        status: 'ACTIVE',
      } });
      const sourceEmail = contactList(row.email, row.email_more, true)[0]?.toLowerCase();
      const emailTaken = sourceEmail ? await tx.user.findUnique({ where: { email: sourceEmail }, select: { id: true } }) : null;
      const sourcePhone = contactList(row.phone, row.phone_more, false).find(value => value.length <= 20);
      const phoneTaken = sourcePhone ? await tx.user.findUnique({ where: { phone: sourcePhone }, select: { id: true } }) : null;
      const loginAccount = await tx.user.create({ data: {
        loginName: legacyLoginName(row.account, sourceId),
        name: plainText(row.contact_name, 100) || plainText(row.name, 100) || '旧版门店账号',
        ...(sourceEmail && !emailTaken ? { email: sourceEmail } : {}),
        ...(sourcePhone && !phoneTaken ? { phone: sourcePhone } : {}),
        passwordHash: await hash(randomStorePassword(), 12),
        role: 'MERCHANT',
        status: 'SUSPENDED',
      } });
      const warningDays = [];
      const business = businessHours(row, warningDays);
      const phones = contactList(row.phone, row.phone_more, false);
      for (const extra of contactList(row.customer_tel, null, false)) if (!phones.includes(extra) && phones.length < 5) phones.push(extra);
      const emails = contactList(row.email, row.email_more, true);
      const photos = mediaList(row.img);
      const logo = safeHttps(row.logo);
      const coordinate = value => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
      };
      const lat = coordinate(row.lat);
      const lng = coordinate(row.lng);
      const latitude = lat >= -90 && lat <= 90 ? lat : 0;
      const longitude = lng >= -180 && lng <= 180 ? lng : 0;
      const location = legacyLocation(row);
      const rating = plan.ratingMap.get(sourceId);
      const importedReviewCount = integer(rating?.review_count, 0, 2147483647);
      const shop = await tx.shop.create({ data: {
        ownerId: owner.id,
        name: plainText(row.name, 200) || ('Imported store ' + sourceId),
        shortName: shortLinks.canonical,
        timezone: validTimezone(row.utc),
        nameEn: null,
        description: plainText(row.intro || row.content, 20000) || null,
        phone: phones[0] && phones[0].length <= 20 ? phones[0] : '',
        address: location.address,
        city: location.city,
        state: location.state.slice(0, 50),
        zipCode: location.zipCode.slice(0, 10),
        latitude,
        longitude,
        category: 'MIXED',
        status: shopStatus(row),
        reviewComment: '旧版正常营业门店已迁移为公开展示；独立账号已迁移并停用登录，预约配置可在门店后台继续维护。',
        shopType: 'APPRENTICE',
        businessHours: business,
        avgRating: 0,
        reviewCount: 0,
        createdAt: dateFromEpoch(row.create_time),
        studioProfile: {
          subtitle: plainText(row.sub_name, 500),
          about: plainText(row.intro || row.content, 20000),
          phones,
          emails,
          logoUrl: logo,
          gallery: photos,
          links: externalLinks(row.links),
          mapShareUrl: legacyMapShareUrl(row, latitude, longitude),
          tags: stringList(row.tags),
          features: { onlineBooking: false, onlinePayment: false, reviews: false, membershipCard: false },
          legacyImport: {
            source: IMPORT_SOURCE,
            sourceShopId: sourceId,
            sourceOwnerId: row.uid === null || row.uid === undefined ? null : String(row.uid),
            previousStatus: { status: row.status === null ? null : Number(row.status), isAuth: row.is_auth === null ? null : Number(row.is_auth) },
            legacyTimezone: text(row.utc, 32) || null,
            timezoneNeedsReview: !validTimezone(row.utc),
            coordinatesNeedReview: latitude === 0 || longitude === 0,
            hoursNeedsReview: warningDays,
            legacyNotice: plainText(row.notice, 1000) || null,
            legacyDefaultHours: { start: text(row.start_time, 20) || null, end: text(row.end_time, 20) || null },
            certificateReferences: [
              ...(safeHttps(row.company_cert_img) ? [{ kind: 'BUSINESS_LICENSE_REVIEW_REQUIRED', url: safeHttps(row.company_cert_img) }] : []),
              ...(safeHttps(row.cert_img) ? [{ kind: 'CERTIFICATE_TYPE_REVIEW_REQUIRED', url: safeHttps(row.cert_img) }] : []),
            ],
            videoReferences: [safeHttps(row.video), safeHttps(row.video_img)].filter(Boolean),
            legacyMapReferences: [safeHttps(row.google_map_share_url), safeHttps(row.google_map)].filter(Boolean),
            legacyRatingSource: { average: rating?.avg_rating === null || rating?.avg_rating === undefined ? null : Number(rating.avg_rating), reviewCount: importedReviewCount ?? integer(row.ser_comment_num, 0, 2147483647) ?? 0 },
            rawBusinessHours: rawBusinessHours(row),
          sourceCategories: [...new Map((plan.services.get(sourceId) || []).map(service => {
            const sourceCategoryId = text(service.row.cid).split(',')[0].trim();
            return [sourceCategoryId, { sourceId: sourceCategoryId, sourceName: text(plan.categories.get(sourceCategoryId), 200), displayName: service.category }];
          })).values()],
          couponDefinitions: legacyCouponDefinitions(plan, sourceId),
          giftCardDefinitions: legacyGiftDefinitions(plan, sourceId),
            mediaStorage: 'legacy HTTPS references only; local binaries were not copied',
          },
        },
      } });
      await tx.shopLoginBinding.create({ data: {
        shopId: shop.id, userId: loginAccount.id, createdById: owner.id,
        reason: 'Massajoy1.0 merchant account migrated with a random password and login suspended',
      } });
      await tx.merchantProfile.create({ data: { userId: owner.id, shopId: shop.id } });
      const aliases = [
        { shopId: shop.id, kind: 'LEGACY_STORE_ID', source: IMPORT_SOURCE, value: sourceId },
        { shopId: shop.id, kind: 'LEGACY_ID', source: 'massajoy1', value: sourceId },
        ...shortLinks.aliases.map(value => ({ shopId: shop.id, kind: 'SHORT_NAME', source: 'massajoy', value })),
        ...(row.uid === null || row.uid === undefined ? [] : [{ shopId: shop.id, kind: 'LEGACY_OWNER_REF', source: IMPORT_SOURCE, value: sourceId + ':' + String(row.uid) }]),
      ];
      await tx.shopAlias.createMany({ data: aliases });
      if (photos.length) {
        await tx.shopImage.createMany({ data: photos.map((imageUrl, index) => ({
          shopId: shop.id, imageUrl, imageType: index === 0 ? 'STORE_FRONT' : 'INTERIOR', sortOrder: index,
        })) });
        imageCount += photos.length;
      }
      const menu = plan.menus.get(sourceId) || [];
      const serviceIds = new Map();
      const variantsByProject = new Map();
      for (const service of plan.services.get(sourceId) || []) {
        const created = await tx.shopService.create({ data: serviceImportData(service, shop.id, projectCount) });
        serviceIds.set(service.serviceKey, created.id);
        projectCount++;
        for (const timed of service.timedPrices) {
          const price = timed.row;
          const variant = await tx.shopServiceVariant.create({ data: variantImportData(timed, created.id, variantCount) });
          variantsByProject.set(service.serviceKey + ':' + String(price.id), variant.id);
          variantCount++;
        }
      }
      const linkedMenu = menu.map(group => ({
        ...group,
        items: group.items.map(item => {
          const sourceVariant = item.__variantSourceId;
          if (!sourceVariant) return item;
          const project = (plan.services.get(sourceId) || []).find(service => service.timedPrices.some(option => String(option.row.id) === sourceVariant));
          if (!project) { const { __variantSourceId, ...displayOnly } = item; return displayOnly; }
          const serviceId = serviceIds.get(project.serviceKey);
          const variantId = variantsByProject.get(project.serviceKey + ':' + sourceVariant);
          const { __variantSourceId, ...display } = item;
          return serviceId && variantId ? { ...display, booking: { serviceId: String(serviceId), variantId: String(variantId) } } : display;
        }),
      }));
      const currentProfile = shop.studioProfile;
      await tx.shop.update({ where: { id: shop.id }, data: { studioProfile: { ...currentProfile, priceMenu: linkedMenu } } });
      const technicianRows = plan.techniciansByShop.get(sourceId) || [];
      const technicians = technicianRows.map((entry, index) => {
        const active = Number(entry.status) === 1 && Number(entry.ser_running) === 1 && Number(entry.delete_time || 0) === 0;
        const image = safeHttps(entry.avatar) || mediaList(entry.img)[0] || null;
        const genderCode = Number(entry.gender);
        return {
          shopId: shop.id,
          name: plainText(entry.name, 100) || ('待整理技师 ' + String(entry.id)),
          avatarUrl: image,
          title: '按摩技师',
          bio: plainText(entry.ser_intro || entry.intro || entry.exp_intro, 10000) || null,
          yearsExp: 0,
          gender: genderCode === 1 ? '男' : genderCode === 2 ? '女' : null,
          isActive: active,
          sortOrder: integer(entry.sort, 0, 2147483647) ?? index,
          scheduleMode: 'SHOP',
        };
      });
      if (technicians.length) {
        await tx.therapist.createMany({ data: technicians });
        technicianCount += technicians.length;
      }
      const couponData = couponRows(plan, sourceId).map(item => ({ ...item, shopId: shop.id }));
      if (couponData.length) { await tx.coupon.createMany({ data: couponData }); couponCount += couponData.length; }
      const giftData = giftRows(plan, sourceId).map(item => ({ ...item, shopId: shop.id }));
      if (giftData.length) { await tx.giftCardProduct.createMany({ data: giftData }); giftCount += giftData.length; }
    }
    return { shops: sourceShopIds.length, projects: projectCount, timedVariants: variantCount, technicians: technicianCount, coupons: couponCount, giftProducts: giftCount, publicImages: imageCount };
  }, { maxWait: 30000, timeout: 600000, isolationLevel: 'ReadCommitted' });
  return outcome;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Legacy store migration is local-only');
  const sourceUrl = parseUrl(process.env.LEGACY_DATABASE_URL, 'Legacy source', SOURCE_DB);
  const targetUrl = parseUrl(process.env.DATABASE_URL, '2.0 target', TARGET_DB_PATTERN);
  if (args.has('--apply') && !APPLY_FLAGS.every(flag => args.has(flag))) throw new Error('Apply requires --apply --acknowledge-local-only');
  if (!args.has('--apply') && args.has('--acknowledge-local-only')) throw new Error('Acknowledgement is accepted only with --apply');
  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });
  try {
    const plan = buildPlan(await loadSource(source));
    const summary = { ...plan.summary, sourceDigest: plan.sourceDigest, mode: args.has('--apply') ? 'apply' : 'dry-run' };
    if (!args.has('--apply')) { process.stdout.write(JSON.stringify(summary) + '\n'); return; }
    const expected = process.argv.find(value => value.startsWith('--expected-digest='));
    if (!expected || expected.slice('--expected-digest='.length) !== plan.sourceDigest) throw new Error('Source digest changed; no target writes were made');
    if (!await target.$connect().then(() => true).catch(() => false)) throw new Error('2.0 target database is unavailable');
    const inserted = await applyPlan(plan, target);
    process.stdout.write(JSON.stringify({ ...summary, inserted }) + '\n');
  } finally {
    await Promise.all([source.$disconnect(), target.$disconnect()]);
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write('Legacy store migration failed: ' + String(error && error.message || 'unknown error').replace(/[\r\n]/g, ' ') + '\n');
    process.exitCode = 1;
  });
}

module.exports = { IMPORT_SOURCE, TARGET_DB_PATTERN, buildPlan, businessHours, legacyLocation, legacyLoginName, legacyMapShareUrl, normalizeUsState, parseUrl, plainText, randomStorePassword, serviceImportData, shopStatus, shortName, text, variantImportData };

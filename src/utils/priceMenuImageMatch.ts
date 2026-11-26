import { PRICE_MENU_CATALOG_ITEMS } from './priceMenuCatalog';
import { PRICE_MENU_GALLERY, type PriceMenuGalleryEntry } from './priceMenuGallery';

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function score(value: string, candidate: string): number {
  const source = normalize(value), term = normalize(candidate);
  if (!term || term.length < 2 || !source) return 0;
  if (source === term) return 1000 + term.length;
  return /[\u3400-\u9fff]/u.test(term) ? source.includes(term) ? term.length : 0 : (` ${source} `).includes(` ${term} `) ? term.length : 0;
}
const aliases: Record<string, string[]> = {
  'body-massage': ['swedish-massage', 'aromatherapy'], 'deep-tissue-massage': ['deep-tissue', 'back-neck'],
  'foot-massage': ['foot-reflexology'], 'couples-massage': ['couples'], 'neck-shoulder-massage': ['back-neck'],
  'hot-stone-massage': ['hot-stone'], 'aromatherapy-massage': ['aromatherapy'], 'essential-oil': ['aromatherapy'],
  'hot-compress': ['herbal-compress', 'hot-towel'],
};
/** Local, finite library only. This never reads other shops' media or fetches a URL. */
export function matchPriceMenuImage(_category: string, name: string): PriceMenuGalleryEntry | null {
  if (!name.trim()) return null;
  const known = PRICE_MENU_CATALOG_ITEMS.map(item => ({ item, score: Math.max(...[item.name, item.nameZh, ...item.keywords].map(term => score(name, term))) })).sort((a, b) => b.score - a.score)[0];
  const direct = PRICE_MENU_GALLERY.map(image => ({ image, score: Math.max(...[image.title, image.titleZh, ...image.keywords].map(term => score(name, term))) })).sort((a, b) => b.score - a.score)[0];
  if (direct?.score && direct.score >= (known?.score ?? 0)) return direct.image;
  if (known?.score) {
    for (const key of [known.item.imageKey, ...(aliases[known.item.imageKey] ?? [])]) {
      const image = PRICE_MENU_GALLERY.find(image => image.key === key);
      if (image) return image;
    }
    // A known technique with no matching subject must never borrow a sibling's
    // image (e.g. acupuncture -> cupping or hot compress -> essential oil).
    return null;
  }
  if (direct?.score) return direct.image;
  return null;
}

export function parsePriceMenuStepCents(value: string): number {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) throw new Error('价格步长须为 0–999999.99 美元，最多两位小数。');
  const [dollars, cents = ''] = value.split('.');
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
}

/**
 * Optional wording suggestions for display menus, reviewed against the local
 * 100-store sample. Choosing a suggestion never supplies a price, duration,
 * booking rule or medical claim; custom wording remains valid.
 * Image keys identify subjects, never another store's photos.
 */
export interface PriceMenuCatalogItem {
  id: string;
  name: string;
  nameZh: string;
  keywords: string[];
  imageKey: string;
}
export interface PriceMenuCatalogGroup {
  id: string;
  category: string;
  categoryZh: string;
  items: PriceMenuCatalogItem[];
}

export const PRICE_MENU_CATALOG: PriceMenuCatalogGroup[] = [
  {
    id: 'body', category: 'Body Massage', categoryZh: '全身按摩', items: [
      { id: 'body-massage', name: 'Body Massage', nameZh: '全身按摩', keywords: ['body work', 'bodywork', 'full body', '全身', '身体按摩'], imageKey: 'body-massage' },
      { id: 'swedish-massage', name: 'Swedish Massage', nameZh: '瑞典式按摩', keywords: ['swedish body massage', 'sweedish', '瑞典', '舒缓按摩'], imageKey: 'swedish-massage' },
      { id: 'deep-tissue-massage', name: 'Deep Tissue Massage', nameZh: '深层组织按摩', keywords: ['deep tissue', 'deep tissues', '深层', '深度按摩'], imageKey: 'deep-tissue-massage' },
      { id: 'thai-massage', name: 'Thai Massage', nameZh: '泰式按摩', keywords: ['thai', 'tai sport', '泰式', '泰国按摩'], imageKey: 'thai-massage' },
      { id: 'lomi-lomi-massage', name: 'Lomi Lomi Massage', nameZh: '夏威夷按摩', keywords: ['lomilomi', 'lomi', '夏威夷', '洛米'], imageKey: 'lomi-lomi-massage' },
      { id: 'shiatsu-massage', name: 'Shiatsu Massage', nameZh: '日式指压', keywords: ['shiatsu', '日式', '日式指压'], imageKey: 'shiatsu-massage' },
    ],
  },
  {
    id: 'foot', category: 'Foot Massage', categoryZh: '足部按摩', items: [
      { id: 'foot-massage', name: 'Foot Massage', nameZh: '足部按摩', keywords: ['foot rub', 'foot spa', 'foot bath', '足部', '足疗', '足浴'], imageKey: 'foot-massage' },
      { id: 'foot-reflexology', name: 'Foot Reflexology', nameZh: '足底按摩', keywords: ['reflexology', 'foot relexology', '足底', '反射区'], imageKey: 'foot-reflexology' },
    ],
  },
  {
    id: 'specialty', category: 'Specialty Massage', categoryZh: '双人及四手按摩', items: [
      { id: 'couples-massage', name: 'Couples Massage', nameZh: '双人按摩', keywords: ['couple massage', 'couples body massage', "couple's massage", '2 people', '双人', '情侣'], imageKey: 'couples-massage' },
      { id: 'four-hands-massage', name: 'Four Hands Massage', nameZh: '四手按摩', keywords: ['four hands', '4 hands', '四手', '四手联弹'], imageKey: 'four-hands-massage' },
    ],
  },
  {
    id: 'targeted', category: 'Targeted Massage', categoryZh: '局部按摩', items: [
      { id: 'head-massage', name: 'Head Massage', nameZh: '头部按摩', keywords: ['head therapy', 'head treatment', 'head spa', 'scalp massage', 'happy head', '头部', '头疗', '头皮'], imageKey: 'head-massage' },
      { id: 'neck-shoulder-massage', name: 'Neck & Shoulder Massage', nameZh: '肩颈按摩', keywords: ['neck and shoulder', 'head.neck&shoulders', 'neck', 'shoulder', '肩颈', '颈部', '肩部'], imageKey: 'neck-shoulder-massage' },
      { id: 'chair-massage', name: 'Chair Massage', nameZh: '椅式按摩', keywords: ['chair relaxing', 'chair massage', '椅式', '坐式'], imageKey: 'chair-massage' },
    ],
  },
  {
    id: 'traditional', category: 'Traditional Treatments', categoryZh: '传统项目', items: [
      { id: 'acupressure', name: 'Acupressure', nameZh: '穴位指压', keywords: ['acupressure massage', 'acupressure treatments', 'meridian massage', '穴位', '指压', '经络'], imageKey: 'acupressure' },
      { id: 'tui-na', name: 'Tui Na', nameZh: '中式推拿', keywords: ['tuina', 'chinese massage', 'tui na massage', '推拿', '中式'], imageKey: 'tui-na' },
      { id: 'cupping', name: 'Cupping', nameZh: '拔罐', keywords: ['cupping therapy', 'cupping treatment', 'vacuum/pump cupping', '拔罐', '走罐', '火罐'], imageKey: 'cupping' },
      { id: 'gua-sha', name: 'Gua Sha', nameZh: '刮痧', keywords: ['gua sba', 'scraping', 'gua sha', '刮痧'], imageKey: 'gua-sha' },
      { id: 'acupuncture', name: 'Acupuncture', nameZh: '针灸', keywords: ['aupuncture', 'acupuncture', '针灸'], imageKey: 'acupuncture' },
      { id: 'moxibustion', name: 'Moxibustion', nameZh: '艾灸', keywords: ['moxibustion treatment', 'moxibustion', '艾灸'], imageKey: 'moxibustion' },
    ],
  },
  {
    id: 'spa', category: 'Spa Treatments', categoryZh: 'SPA 护理', items: [
      { id: 'hot-stone-massage', name: 'Hot Stone Massage', nameZh: '热石按摩', keywords: ['hot stone', 'hotstone', 'energy hot stone', '热石', '热石按摩'], imageKey: 'hot-stone-massage' },
      { id: 'aromatherapy-massage', name: 'Aromatherapy Massage', nameZh: '芳香精油按摩', keywords: ['aromatherapy', 'hot oil massage', 'essential oil services', '芳香', '精油按摩', '热油'], imageKey: 'aromatherapy-massage' },
      { id: 'body-scrub', name: 'Body Scrub', nameZh: '身体磨砂', keywords: ['scrub', 'body scrub', '身体磨砂', '磨砂', '去角质'], imageKey: 'body-scrub' },
      { id: 'facial', name: 'Facial', nameZh: '面部护理', keywords: ['facial treatment', 'facial spa', 'skin care', 'hydrating facial', '面部', '美容', '护肤'], imageKey: 'facial' },
    ],
  },
  {
    id: 'combo', category: 'Combo Massage', categoryZh: '组合按摩', items: [
      { id: 'foot-body-combo', name: 'Foot & Body Combo', nameZh: '足部加全身组合', keywords: ['foot and body', 'foot & body', 'body and foot', 'foot & bady', 'foot body', 'combo massage', 'combination', '足部全身', '足部加全身', '组合'], imageKey: 'foot-body-combo' },
      { id: 'back-foot-combo', name: 'Back & Foot Combo', nameZh: '背部加足部组合', keywords: ['back & foot', 'back and foot', 'back foot', '背部足部', '背部加足部'], imageKey: 'back-foot-combo' },
    ],
  },
  {
    id: 'wellness', category: 'Specialized Massage', categoryZh: '专项按摩', items: [
      { id: 'prenatal-massage', name: 'Prenatal Massage', nameZh: '孕期按摩', keywords: ['prenatal', 'pregnancy massage', '孕期', '孕妇'], imageKey: 'prenatal-massage' },
      { id: 'lymphatic-drainage', name: 'Lymphatic Drainage Massage', nameZh: '淋巴引流按摩', keywords: ['lymphatic drainage', 'lymphatic', '淋巴', '引流'], imageKey: 'lymphatic-drainage' },
      { id: 'sports-massage', name: 'Sports Massage', nameZh: '运动按摩', keywords: ['sport massage', 'sports', 'tai sport', '运动按摩', '运动'], imageKey: 'sports-massage' },
    ],
  },
  {
    id: 'addons', category: 'Add-ons', categoryZh: '附加项目', items: [
      { id: 'essential-oil', name: 'Essential Oil', nameZh: '精油加项', keywords: ['essential oils', 'essential oil add-ons', '精油', '香薰'], imageKey: 'essential-oil' },
      { id: 'hot-compress', name: 'Hot Compress', nameZh: '热敷', keywords: ['hot compress', 'herbal compress', '热敷', '热毛巾'], imageKey: 'hot-compress' },
    ],
  },
];

export const PRICE_MENU_CATALOG_ITEMS = PRICE_MENU_CATALOG.flatMap(group => group.items);

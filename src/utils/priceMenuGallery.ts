/** Curated, bundled service illustrations. Display-only; choosing an image creates no booking service. */
export interface PriceMenuGalleryEntry {
  key: string;
  title: string;
  titleZh: string;
  url: string;
  keywords: string[];
}

/** Paths are an explicit versioned allowlist. Do not derive paths from user input. */
export const PRICE_MENU_GALLERY: readonly PriceMenuGalleryEntry[] = [
  {
    "key": "swedish-massage",
    "title": "Swedish massage",
    "titleZh": "瑞典式全身按摩",
    "url": "/service-gallery/v1/swedish-massage.webp",
    "keywords": [
      "swedish",
      "relaxation",
      "body massage",
      "full body",
      "全身",
      "瑞典",
      "放松",
      "按摩"
    ]
  },
  {
    "key": "deep-tissue",
    "title": "Deep tissue massage",
    "titleZh": "深层肌肉按摩",
    "url": "/service-gallery/v1/deep-tissue.webp",
    "keywords": [
      "deep tissue",
      "muscle",
      "firm pressure",
      "sports",
      "深层",
      "肌肉",
      "运动",
      "按摩"
    ]
  },
  {
    "key": "back-neck",
    "title": "Back and neck massage",
    "titleZh": "肩颈背部按摩",
    "url": "/service-gallery/v1/back-neck.webp",
    "keywords": [
      "back",
      "neck",
      "shoulder",
      "upper body",
      "背部",
      "肩颈",
      "颈部",
      "肩部"
    ]
  },
  {
    "key": "couples",
    "title": "Couples massage",
    "titleZh": "双人按摩",
    "url": "/service-gallery/v1/couples.webp",
    "keywords": [
      "couples",
      "couple",
      "duo",
      "two people",
      "双人",
      "情侣",
      "两人",
      "按摩"
    ]
  },
  {
    "key": "hot-stone",
    "title": "Hot stone massage",
    "titleZh": "热石按摩",
    "url": "/service-gallery/v1/hot-stone.webp",
    "keywords": [
      "hot stone",
      "warm stone",
      "stones",
      "热石",
      "热石按摩",
      "温石"
    ]
  },
  {
    "key": "cupping",
    "title": "Cupping",
    "titleZh": "拔罐护理",
    "url": "/service-gallery/v1/cupping.webp",
    "keywords": [
      "cupping",
      "cups",
      "fire cupping",
      "拔罐",
      "火罐",
      "罐"
    ]
  },
  {
    "key": "head-massage",
    "title": "Head massage",
    "titleZh": "头部按摩",
    "url": "/service-gallery/v1/head-massage.webp",
    "keywords": [
      "head",
      "scalp massage",
      "temple",
      "头部",
      "头部按摩",
      "头皮",
      "太阳穴"
    ]
  },
  {
    "key": "head-spa",
    "title": "Head spa",
    "titleZh": "头部水疗",
    "url": "/service-gallery/v1/head-spa.webp",
    "keywords": [
      "head spa",
      "scalp spa",
      "hair wash",
      "shampoo",
      "头疗",
      "头部水疗",
      "洗头",
      "头皮护理"
    ]
  },
  {
    "key": "facial",
    "title": "Facial care",
    "titleZh": "面部护理",
    "url": "/service-gallery/v1/facial.webp",
    "keywords": [
      "facial",
      "skin care",
      "face mask",
      "beauty",
      "美容",
      "面部",
      "面膜",
      "护肤"
    ]
  },
  {
    "key": "foot-reflexology",
    "title": "Foot reflexology",
    "titleZh": "足部按摩",
    "url": "/service-gallery/v1/foot-reflexology.webp",
    "keywords": [
      "foot",
      "feet",
      "reflexology",
      "foot massage",
      "足疗",
      "足部",
      "脚部",
      "足底按摩"
    ]
  },
  {
    "key": "foot-soak",
    "title": "Foot soak",
    "titleZh": "舒缓足浴",
    "url": "/service-gallery/v1/foot-soak.webp",
    "keywords": [
      "foot soak",
      "foot bath",
      "pedicure soak",
      "足浴",
      "泡脚",
      "足部浸泡"
    ]
  },
  {
    "key": "gua-sha",
    "title": "Gua sha",
    "titleZh": "刮痧护理",
    "url": "/service-gallery/v1/gua-sha.webp",
    "keywords": [
      "gua sha",
      "scraping",
      "guasha",
      "刮痧",
      "刮痧护理"
    ]
  },
  {
    "key": "aromatherapy",
    "title": "Aromatherapy",
    "titleZh": "精油护理",
    "url": "/service-gallery/v1/aromatherapy.webp",
    "keywords": [
      "aromatherapy",
      "essential oil",
      "oil",
      "add on",
      "精油",
      "芳香",
      "加项",
      "附加项目"
    ]
  },
  {
    "key": "bath-salts",
    "title": "Bath salts",
    "titleZh": "浴盐护理",
    "url": "/service-gallery/v1/bath-salts.webp",
    "keywords": [
      "bath salts",
      "herbal bath",
      "soak",
      "add on",
      "浴盐",
      "草本浴",
      "加项",
      "附加项目"
    ]
  },
  {
    "key": "body-scrub",
    "title": "Body scrub",
    "titleZh": "身体磨砂",
    "url": "/service-gallery/v1/body-scrub.webp",
    "keywords": [
      "body scrub",
      "scrub",
      "exfoliation",
      "add on",
      "身体磨砂",
      "磨砂",
      "去角质",
      "加项"
    ]
  }
];

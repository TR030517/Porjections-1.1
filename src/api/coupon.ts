import { GiftCard, PurchasedGiftCard } from '../types/giftcard';

// Seed initial default data in localStorage if not exists
const DEFAULT_TEMPLATES: GiftCard[] = [
  {
    cardId: 'GC-ARIV-9302',
    templateName: 'Ariva 经典理疗特惠卡',
    totalUsages: 5,
    validityDays: 180,
    intro: '深度解压，经典理疗。5次卡专享VIP服务，限时发售。',
    description: '包含全身温和舒缓按摩、纯正精油导入、局部热石温补，带来极致宁静感。',
    boundServices: ['60Mins Body Massage', '30Mins Hot Stone Therapy'],
    inventory: 200,
    salesStatus: '售卖中'
  },
  {
    cardId: 'GC-ROES-4182',
    templateName: 'Roes 全身复元奢宠卡',
    totalUsages: 10,
    validityDays: 365,
    intro: '超值十次复元卡。特级技师全程服务，尊享包厢。',
    description: '此礼品卡每次消费可用一个自选项目，完美针对久坐疲劳人群的深度肌肉经络疏通。',
    boundServices: ['60Mins Swedish Massage', 'Foot Reflexology'],
    inventory: 120,
    salesStatus: '售卖中'
  }
];

const DEFAULT_PURCHASED: PurchasedGiftCard[] = [
  {
    id: 'GP-7629-8134-9210',
    cardId: 'GC-ARIV-9302',
    cardName: 'Ariva 经典理疗特惠卡',
    userPhone: '303-475-1234',
    remainingCount: 3,
    totalCount: 5,
    validityEndDate: '2026-11-26',
    status: '正常',
    updateDate: '2026-05-30'
  },
  {
    id: 'GP-2831-0941-8840',
    cardId: 'GC-ROES-4182',
    cardName: 'Roes 全身复元奢宠卡',
    userPhone: '312-283-9988',
    remainingCount: 0,
    totalCount: 10,
    validityEndDate: '2027-05-29',
    status: '已用完',
    updateDate: '2026-05-29'
  }
];

function getStorageItem<T>(key: string, defaultVal: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

function setStorageItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Failed to write to localStorage', e);
  }
}

// Ensure initial database seeding
if (!localStorage.getItem('giftcard_templates_db')) {
  setStorageItem('giftcard_templates_db', DEFAULT_TEMPLATES);
}
if (!localStorage.getItem('giftcard_purchased_db')) {
  setStorageItem('giftcard_purchased_db', DEFAULT_PURCHASED);
}

/**
 * 获取礼品卡模板列表 (Get Gift Card templates list)
 */
export async function getGiftCardTemplates(): Promise<GiftCard[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const templates = getStorageItem<GiftCard[]>('giftcard_templates_db', DEFAULT_TEMPLATES);
      resolve(templates);
    }, 200);
  });
}

/**
 * 获取已购买礼品卡列表 (Get Purchased Gift Cards list)
 */
export async function getPurchasedGiftCards(): Promise<PurchasedGiftCard[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const purchased = getStorageItem<PurchasedGiftCard[]>('giftcard_purchased_db', DEFAULT_PURCHASED);
      resolve(purchased);
    }, 200);
  });
}

/**
 * 新增/创建礼品卡模板 (Create clean template)
 */
export async function createGiftCardTemplate(template: Omit<GiftCard, 'cardId'>): Promise<GiftCard> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const templates = getStorageItem<GiftCard[]>('giftcard_templates_db', DEFAULT_TEMPLATES);
      const randomLetters = Array.from({ length: 4 }, () => 
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]
      ).join('');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const newCardId = `GC-${randomLetters}-${randomNum}`;
      
      const newTemplate: GiftCard = {
        ...template,
        cardId: newCardId
      };
      
      templates.unshift(newTemplate);
      setStorageItem('giftcard_templates_db', templates);
      resolve(newTemplate);
    }, 200);
  });
}

/**
 * 编辑/更新礼品卡模板 (Update template)
 */
export async function updateGiftCardTemplate(updatedTemplate: GiftCard): Promise<GiftCard> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const templates = getStorageItem<GiftCard[]>('giftcard_templates_db', DEFAULT_TEMPLATES);
      const index = templates.findIndex(t => String(t.cardId) === String(updatedTemplate.cardId));
      if (index === -1) {
        reject(new Error('未找到该模板ID'));
        return;
      }
      templates[index] = updatedTemplate;
      setStorageItem('giftcard_templates_db', templates);
      resolve(updatedTemplate);
    }, 200);
  });
}

/**
 * 删除礼品卡模板 (Delete template)
 */
export async function deleteGiftCardTemplate(cardId: string | number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const templates = getStorageItem<GiftCard[]>('giftcard_templates_db', DEFAULT_TEMPLATES);
      const filtered = templates.filter(t => String(t.cardId) !== String(cardId));
      setStorageItem('giftcard_templates_db', filtered);
      resolve(true);
    }, 200);
  });
}

/**
 * 模拟购买 (Simulate Purchase)
 */
export async function simulatePurchase(cardId: string | number, userPhone: string): Promise<PurchasedGiftCard> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const templates = getStorageItem<GiftCard[]>('giftcard_templates_db', DEFAULT_TEMPLATES);
      const template = templates.find(t => String(t.cardId) === String(cardId));
      
      if (!template) {
        reject(new Error('未找到匹配该礼品卡的可用模板'));
        return;
      }
      if (template.salesStatus === '已停售') {
        reject(new Error('该项目次卡已经下架停止售卖'));
        return;
      }
      if (template.inventory <= 0) {
        reject(new Error('该网点次卡在当前库存已售罄'));
        return;
      }

      // Deduct inventory
      template.inventory = template.inventory - 1;
      setStorageItem('giftcard_templates_db', templates);

      // Create Voucher purchased object
      const segments = Array.from({ length: 4 }, () => Math.floor(1000 + Math.random() * 9000).toString());
      const newCouponCode = `GP-${segments.join('-')}`;

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + template.validityDays);
      const expireStr = expirationDate.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];

      const purchasedItem: PurchasedGiftCard = {
        id: newCouponCode,
        cardId: template.cardId,
        cardName: template.templateName,
        userPhone: userPhone.trim(),
        remainingCount: template.totalUsages,
        totalCount: template.totalUsages,
        validityEndDate: expireStr,
        status: '正常',
        updateDate: todayStr
      };

      const purchasedList = getStorageItem<PurchasedGiftCard[]>('giftcard_purchased_db', DEFAULT_PURCHASED);
      purchasedList.unshift(purchasedItem);
      setStorageItem('giftcard_purchased_db', purchasedList);

      resolve(purchasedItem);
    }, 250);
  });
}

/**
 * 模拟服务卡扣减核销 (Simulate Redeem verification)
 */
export async function redeemGiftCardUsage(voucherId: string): Promise<PurchasedGiftCard> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const purchasedList = getStorageItem<PurchasedGiftCard[]>('giftcard_purchased_db', DEFAULT_PURCHASED);
      const item = purchasedList.find(c => c.id === voucherId);
      if (!item) {
        reject(new Error('未找到匹配的电子券号，请重新核对'));
        return;
      }
      if (item.remainingCount <= 0) {
        reject(new Error('扣减失败：该礼券消费次数已经彻底用完'));
        return;
      }

      item.remainingCount -= 1;
      if (item.remainingCount === 0) {
        item.status = '已用完';
      }
      item.updateDate = new Date().toISOString().split('T')[0];

      setStorageItem('giftcard_purchased_db', purchasedList);
      resolve(item);
    }, 200);
  });
}

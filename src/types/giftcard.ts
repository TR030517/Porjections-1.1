export interface GiftCard {
  cardId: string | number;
  templateName: string; // 卡名称
  totalUsages: number; // 可享总服务次数
  validityDays: number; // 兑换券有效期限天数
  intro: string; // 简介
  description: string; // 项目明细描述
  boundServices: string[]; // 已绑定的服务项目数组，如 ['60Mins Body Massage', '30Mins Hot Stone Therapy']
  inventory: number; // 单店库存限制
  salesStatus: '售卖中' | '已停售'; // 销售状态：售卖中/已停售
  imagePreset?: string; // CSS gradient class
  imageUrl?: string; // Optional custom URL
}

export interface PurchasedGiftCard {
  id: string; // 随机核销券码, e.g. GP-9281-3841-2104
  cardId: string | number;
  cardName: string;
  userPhone: string; // 手机号
  remainingCount: number; // 剩余次数
  totalCount: number; // 总可看对应次数
  validityEndDate: string; // 截止有效期
  status: '正常' | '已用完' | '已失效';
  updateDate: string;
}

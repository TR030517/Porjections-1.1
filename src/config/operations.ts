import { SERVICE_DURATION_LABELS, SERVICE_DURATION_KINDS } from '../utils/serviceDuration';
import type { ResourceName } from '../api/resources';
import type { PasswordRole } from '../../backend/src/common/password-policy';
export interface OperationColumn { key: string; label: string; kind?: 'boolean' | 'cents' | 'date' | 'list' | 'dateOnly' | 'time' | 'schedule' | 'checklist'; }
export interface OperationFilter {
  key: 'status' | 'paymentStatus' | 'isActive' | 'startDate' | 'endDate'; label: string;
  type?: 'date'; options?: { value: string; label: string }[]; defaultValue?: string; allValue?: string;
}
export interface OperationField {
  key: string; label: string; type?: 'text' | 'datetime-local' | 'email' | 'tel' | 'password' | 'textarea' | 'number' | 'checkbox' | 'select' | 'reference' | 'references';
  required?: boolean; options?: { value: string; label: string }[]; defaultValue?: string | number | boolean;
  min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; immutable?: boolean; resource?: ResourceName; parentKey?: string;
  createOnly?: boolean; editOnly?: boolean; readOnly?: boolean; requiredOnCreate?: boolean; hint?: string;
  passwordRole?: PasswordRole;
}
export interface OperationConfig {
  resource: ResourceName; title: string; description: string; columns: OperationColumn[];
  fields?: OperationField[]; allowCreate?: boolean; allowEdit?: boolean; allowDelete?: boolean; searchable?: boolean;
  allowReview?: boolean; filters?: OperationFilter[]; details?: OperationColumn[]; defaultCurrency?: string; searchPlaceholder?: string;
}
const accountFields: OperationField[] = [
  { key: 'name', label: '姓名', requiredOnCreate: true, maxLength: 100 },
  { key: 'email', label: '登录邮箱', type: 'email', required: true, maxLength: 255, immutable: true },
  { key: 'phone', label: '联系电话', type: 'tel', required: true, maxLength: 20, immutable: true },
  { key: 'password', label: '初始密码', type: 'password', passwordRole: 'ADMIN', required: true, createOnly: true, maxLength: 72, hint: '12–72 个 UTF-8 字节（英文和数字每个 1 字节，常见汉字每个 3 字节），不可包含空字符或换行。仅用于创建账户。' },
  { key: 'status', label: '账户状态', type: 'select', required: true, editOnly: true, options: [{ value: 'ACTIVE', label: '启用' }, { value: 'SUSPENDED', label: '禁用' }], hint: '禁用后服务器将撤销该账户的登录会话。' },
];
const merchantAccountFields: OperationField[] = [
  ...accountFields.map(field => field.key === 'phone' ? { ...field, label: '联系电话（可选）', required: false } : field.key === 'password' ? { ...field, passwordRole: 'MERCHANT' as const, minLength: 6, hint: '默认生成 8 位字母与数字；可手动修改为 6–72 个 UTF-8 字节，首尾不可留空或包含空字符、换行。' } : field),
];
const customerAccountFields: OperationField[] = accountFields.map(field => field.key === 'password'
  ? { ...field, passwordRole: 'CUSTOMER' as const, hint: '6–72 个 UTF-8 字节，不可包含空字符或换行。仅用于创建账户。' } : field);
const shop: OperationField = { key: 'shopId', label: '所属门店', type: 'reference', resource: 'stores', required: true, immutable: true };
const name: OperationField = { key: 'name', label: '名称', required: true, maxLength: 200 };
const active: OperationField = { key: 'isActive', label: '启用', type: 'checkbox', defaultValue: true };
const description: OperationField = { key: 'description', label: '说明', type: 'textarea', maxLength: 5000 };
const price: OperationField = { key: 'priceCents', label: '价格（美分，100 美分 = 1 美元）', type: 'number', required: true, min: 1, max: 100000000 };
const options = (values: Record<string, string>) => Object.entries(values).map(([value, label]) => ({ value, label }));
const accountFilters: OperationFilter[] = [{ key: 'status', label: '账户状态', options: options({ ACTIVE: '启用', SUSPENDED: '禁用' }) }];
const activeFilters: OperationFilter[] = [{ key: 'isActive', label: '启用状态', options: options({ true: '启用', false: '停用' }) }];
const orderFilters: OperationFilter[] = [
  { key: 'status', label: '预约状态', options: options({ PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款' }) },
  { key: 'paymentStatus', label: '支付状态', options: options({ UNPAID: '未支付', PAID: '已支付', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款' }) },
  { key: 'startDate', label: '预约日期从', type: 'date' }, { key: 'endDate', label: '预约日期至', type: 'date' },
];
const orderColumns: OperationColumn[] = [
  { key: 'orderNo', label: '订单号' }, { key: 'customerName', label: '预约联系人' }, { key: 'contactLabel', label: '联系人来源' }, { key: 'storeName', label: '门店' }, { key: 'serviceName', label: '服务' },
  { key: 'bookingDate', label: '预约日期 / 时段（门店当地）', kind: 'schedule' }, { key: 'currency', label: '币种' },
  { key: 'totalCents', label: '订单金额', kind: 'cents' }, { key: 'paidCents', label: '已付金额', kind: 'cents' }, { key: 'refundedCents', label: '已退金额', kind: 'cents' },
  { key: 'status', label: '预约状态' }, { key: 'paymentStatus', label: '支付状态' },
];
const orderDetails: OperationColumn[] = [
  { key: 'id', label: '订单 ID' }, ...orderColumns.filter(column => column.kind !== 'schedule'),
  { key: 'bookingDate', label: '预约日期（门店当地）', kind: 'dateOnly' }, { key: 'startTime', label: '开始时间（门店当地）', kind: 'time' },
  { key: 'endTime', label: '结束时间（门店当地）', kind: 'time' }, { key: 'shopTimezone', label: '预约时区' },
  { key: 'therapistId', label: '技师 ID' }, { key: 'durationKind', label: '预约项目类型' }, { key: 'durationMin', label: '预约总跨度（分钟）' },
  { key: 'priceCents', label: '服务原价', kind: 'cents' }, { key: 'discountCents', label: '优惠金额', kind: 'cents' }, { key: 'platformFeeCents', label: '平台费用', kind: 'cents' },
  { key: 'notes', label: '预约备注' }, { key: 'cancelReason', label: '取消原因' }, { key: 'createdAt', label: '创建时间（门店当地）', kind: 'date' }, { key: 'updatedAt', label: '更新时间（门店当地）', kind: 'date' },
];
export const operations: Record<string, OperationConfig> = {
  'user-list': { resource: 'users', title: '用户列表', filters: accountFilters, searchPlaceholder: '输入姓名、邮箱或电话', description: '管理用户账户、姓名与启用状态。新建账户固定为顾客身份。', allowCreate: true, allowEdit: true, fields: customerAccountFields, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '姓名' }, { key: 'email', label: '邮箱' }, { key: 'status', label: '状态' }, { key: 'createdAt', label: '注册时间', kind: 'date' }] },
  'service-orders': { resource: 'service-orders', title: '服务订单', description: '按门店当地预约日期查询。预约与支付状态分别显示，金额使用订单实际币种。', columns: orderColumns, filters: orderFilters, details: orderDetails, searchPlaceholder: '输入订单号' },
  services: { resource: 'services', title: '服务项目', filters: activeFilters, defaultCurrency: 'USD', description: '日常新增、改价、启停和顾客展示请进入“服务与价格工作区”统一维护。管理员批量导入只创建停用预约草稿，不会发布顾客价目。停用后保留历史记录。', allowCreate: true, allowEdit: true, allowDelete: true, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '项目名称' }, { key: 'shopId', label: '门店 ID' }, { key: 'category', label: '服务类型' }, { key: 'durationKind', label: '项目时长类型' }, { key: 'durationMin', label: '基础时长（无规格时）' }, { key: 'priceCents', label: '基础价（无规格时，USD）', kind: 'cents' }, { key: 'isActive', label: '启用', kind: 'boolean' }], fields: [shop, name, { key: 'category', label: '服务类型', type: 'select', required: true, options: [{value:'MASSAGE',label:'按摩'}, {value:'REFLEXOLOGY',label:'足疗'}, {value:'CUPPING',label:'拔罐'}, {value:'SCRAPING',label:'刮痧'}, {value:'HEAD_THERAPY',label:'头疗'}, {value:'OTHER',label:'其他'}] }, { key: 'durationKind', label: '项目时长类型', type: 'select', required: true, defaultValue: 'TIMED', options: SERVICE_DURATION_KINDS.map(value => ({ value, label: SERVICE_DURATION_LABELS[value] })) }, { key: 'durationMin', label: '固定服务时长（分钟）', type: 'number', required: true, min: 5, max: 240 }, price, description, active] },
  technicians: { resource: 'technicians', title: '技师管理', filters: [{key:'status',label:'技师状态',options:options({ACTIVE:'启用',INACTIVE:'停用'})}], description: '管理本店技师与启停，所有启用技师自动承接本店全部项目。', allowCreate: true, allowEdit: true, allowDelete: true, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '姓名' }, { key: 'shopId', label: '门店 ID' }, { key: 'bio', label: '简介' }, { key: 'status', label: '状态' }], fields: [shop, name, {key:'bio',label:'简介',type:'textarea',maxLength:5000}, { key:'status',label:'状态',type:'select',required:true,defaultValue:'ACTIVE',options:[{value:'ACTIVE',label:'启用'},{value:'INACTIVE',label:'停用'}] }] },
  industries: { resource: 'industries', title: '行业管理', filters: activeFilters, description: '管理运营分类名称、排序与启用状态。此目录独立于顾客端固定服务类型，不会改变服务计价或预约资格。', allowCreate: true, allowEdit: true, allowDelete: true, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '行业名称' }, { key: 'sortOrder', label: '排序' }, { key: 'isActive', label: '启用', kind: 'boolean' }], fields: [name, {key:'sortOrder',label:'排序',type:'number',required:true,min:0,defaultValue:0}, active] },
  'help-list': { resource: 'content', title: '平台公告', filters: activeFilters, description: '公告可保存为草稿或定时启用。显示时间按当前设备时区，提交时转换为明确的 UTC 时刻。正文以文本显示，不执行 HTML。', allowCreate:true,allowEdit:true,allowDelete:true,
    columns:[{key:'title',label:'标题'},{key:'type',label:'优先级'},{key:'scope',label:'展示范围'},{key:'publicationState',label:'当前状态'},{key:'startAt',label:'开始时间',kind:'date'},{key:'endAt',label:'结束时间',kind:'date'}],
    fields:[{key:'title',label:'标题',required:true,maxLength:500},{key:'body',label:'正文',type:'textarea',required:true,maxLength:50000},
      {key:'type',label:'优先级',type:'select',required:true,defaultValue:'INFO',options:options({INFO:'普通',IMPORTANT:'重要',URGENT:'紧急'})},
      {key:'scope',label:'展示范围',type:'select',required:true,defaultValue:'ALL',options:options({ALL:'全部',USERS:'顾客',MERCHANTS:'商家与员工'})},
      {key:'startAt',label:'开始时间（当前设备时区）',type:'datetime-local',hint:'留空立即开始；已有公告留空保留原开始时刻。'},
      {key:'endAt',label:'结束时间（当前设备时区）',type:'datetime-local',hint:'留空不设结束。结束时间必须晚于开始。'},
      {key:'isPublished',label:'启用（开始之前显示为待发布，结束后自动停止展示）',type:'checkbox',defaultValue:false}] },
  'banner-list': {resource:'banners',title:'首页轮播',description:'配置首页图片、顺序、时间与明确跳转目标。默认草稿；失效或未发布门店的跳转不会对顾客展示。轮播分类使用顾客端固定服务类型。',filters:activeFilters,allowCreate:true,allowEdit:true,allowDelete:true,
    columns:[{key:'title',label:'标题'},{key:'targetType',label:'跳转类型'},{key:'sortOrder',label:'顺序'},{key:'publicationState',label:'当前状态'},{key:'startAt',label:'开始',kind:'date'},{key:'endAt',label:'结束',kind:'date'}],
    fields:[{key:'title',label:'标题',required:true,maxLength:200},{key:'imageUrl',label:'图片 HTTPS 地址',required:true,maxLength:500},
      {key:'targetType',label:'跳转类型',type:'select',required:true,defaultValue:'NONE',options:options({NONE:'仅展示',SHOP_DETAIL:'门店详情',CATEGORY:'服务类型',COUPON_CENTER:'优惠券中心',EXTERNAL_URL:'外部 HTTPS 页面'})},
      {key:'targetValue',label:'跳转目标',maxLength:255,hint:'门店填写本系统门店 ID；服务类型为 MASSAGE / REFLEXOLOGY / CUPPING / SCRAPING / HEAD_THERAPY / OTHER；外部链接须 HTTPS。仅展示和优惠券中心留空。'},
      {key:'sortOrder',label:'顺序（较小靠前）',type:'number',min:0,max:999999,required:true,defaultValue:0},
      {key:'startAt',label:'开始时间（当前设备时区）',type:'datetime-local'},{key:'endAt',label:'结束时间（当前设备时区）',type:'datetime-local'},
      {key:'isActive',label:'启用',type:'checkbox',defaultValue:false}] },
  'store-application': { resource: 'applications', title: '门店申请', filters: [{key:'status',label:'审核状态',defaultValue:'PENDING',allValue:'ALL',options:options({PENDING:'待审核',APPROVED:'已发布',REJECTED:'已拒绝',SUSPENDED:'已停用'})}], description: '审核待发布门店。发布前必须完善时区、位置、联系方式与营业时间。', allowReview: true, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '门店名称' }, { key: 'status', label: '审核状态' }, { key: 'publicationChecklist', label: '发布资料检查', kind: 'checklist' }, { key: 'reviewComment', label: '审核说明' }, { key: 'createdAt', label: '申请时间',kind:'date' }] },
  'post-sales': { resource: 'after-sales', title: '退款订单记录', description: '按门店当地预约日期查询实际退款金额。申请与沟通请使用售后工单。', columns: orderColumns, filters: orderFilters, details: orderDetails, searchPlaceholder: '输入订单号' },
  'withdrawal-list': { resource: 'withdrawals', title: '提现记录', defaultCurrency: 'USD', description: '查询提现账目与处理状态。本页不执行付款。', searchable:false, columns: [{ key: 'id', label: 'ID' }, { key: 'profileId', label: '商户资料 ID' }, { key: 'amount', label: '记账金额（USD）', kind: 'cents' }, {key:'fee',label:'手续费（USD）',kind:'cents'},{key:'net',label:'净额（USD）',kind:'cents'},{ key: 'status', label: '状态' }, { key: 'createdAt', label: '创建时间',kind:'date' }] },
  'platform-settings': { resource: 'settings', title: '平台设置', description: '仅编辑服务器允许公开的站点名称与客服联系方式。', searchable:false, allowEdit:true, columns: [{ key: 'key', label: '配置项' }, { key: 'label', label: '说明' }, { key: 'value', label: '当前值' }], fields:[{key:'value',label:'配置值',maxLength:255}] },
  'gift-card-management': { resource: 'gift-cards', title: '礼品卡产品配置', defaultCurrency: 'USD', filters:[{key:'status',label:'配置状态',options:options({DRAFT:'草稿',ACTIVE:'已启用配置',PAUSED:'已停用配置'})}], description: '配置产品价格、次数与有效期。已启用产品支持免费赠送与次数核销；线上销售暂未开放。已发权益的价格、次数和有效期需新建产品调整。', allowCreate:true,allowEdit:true,allowDelete:true, columns: [{ key: 'id', label: 'ID' }, { key: 'title', label: '产品名称' }, { key: 'shopId', label: '门店 ID' }, { key: 'priceCents', label: '价格（USD）', kind: 'cents' }, { key: 'useTimes', label: '可用次数' }, {key:'expireDays',label:'有效天数'},{ key: 'status', label: '配置状态' }], fields:[shop,{key:'title',label:'产品名称',required:true,maxLength:200},description,price,{key:'useTimes',label:'可用次数',type:'number',required:true,min:1,max:10000},{key:'expireDays',label:'有效天数',type:'number',required:true,min:1,max:3650},{key:'status',label:'配置状态',type:'select',required:true,defaultValue:'DRAFT',options:[{value:'DRAFT',label:'草稿'},{value:'ACTIVE',label:'已启用配置'},{value:'PAUSED',label:'已停用配置'}]}] },
  'gift-card-orders': { resource: 'gift-card-orders', title: '礼品卡订单', description: '查询礼品卡购买订单与实际付款状态。', columns: [{ key: 'id', label: 'ID' }, { key: 'orderNo', label: '订单号' }, { key: 'productId', label: '产品 ID' }, { key: 'amountCents', label: '金额', kind: 'cents' }, {key:'paidCents',label:'已付金额',kind:'cents'},{ key: 'status', label: '状态' }, { key: 'createdAt', label: '创建时间',kind:'date' }] },
  'admin-list': { resource: 'admins', title: '管理员账户', filters: accountFilters, searchPlaceholder: '输入姓名、邮箱或电话', description: '管理平台管理员账户。禁用将撤销该账户的登录会话。', allowCreate: true, allowEdit: true, fields: accountFields, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '姓名' }, { key: 'email', label: '邮箱' }, { key: 'role', label: '角色' }, { key: 'status', label: '状态' }] },
  'merchant-list': { resource: 'merchants', title: '商家账户', filters: accountFilters, searchPlaceholder: '输入姓名、登录邮箱或电话', description: '商家使用邮箱登录，内部账户标识自动生成。默认随机生成 8 位初始密码，可手动修改为至少 6 位。创建后由公司绑定门店，保留历史经营归属与账本。', allowCreate: true, allowEdit: true, fields: merchantAccountFields, columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: '姓名' }, { key: 'email', label: '登录邮箱' }, { key: 'status', label: '状态' }] },
};

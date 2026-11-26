// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appTitle => 'Massajoy';

  @override
  String get subtitle => '传统中式按摩 · 自在预约';

  @override
  String get phoneNumber => '手机号码';

  @override
  String get sendCode => '发送验证码';

  @override
  String get btnContinue => '继续';

  @override
  String get verify => '验证';

  @override
  String get verifyPhone => '验证手机';

  @override
  String get enterVerificationCode => '输入验证码';

  @override
  String codeSentTo(Object phone) {
    return '6位验证码已发送至\n$phone';
  }

  @override
  String get verificationCode => '验证码';

  @override
  String get invalidCode => '验证码无效，请重试。';

  @override
  String get failedToSendCode => '发送失败，请重试。';

  @override
  String get loginWithApple => '使用 Apple 登录';

  @override
  String get loginWithGoogle => '使用 Google 登录';

  @override
  String get appleLoginUnavailable => 'Apple 登录仅支持移动端应用';

  @override
  String get termsPrivacy => '继续前往表示同意服务条款和隐私政策';

  @override
  String get searchShops => '搜索按摩门店...';

  @override
  String get noShopsFound => '没有找到门店';

  @override
  String get noShopsMatch => '没有符合条件的门店';

  @override
  String get failedToLoadShops => '加载门店失败';

  @override
  String get retry => '重试';

  @override
  String get categoryAll => '全部';

  @override
  String get categoryTuiNa => '推拿';

  @override
  String get categoryFootMassage => '足疗';

  @override
  String get categoryCupping => '拔罐';

  @override
  String get categoryScraping => '刮痧';

  @override
  String get myBookings => '我的预约';

  @override
  String get favorites => '我的收藏';

  @override
  String get profile => '我的';

  @override
  String get filters => '筛选';

  @override
  String get logout => '退出登录';

  @override
  String get tabShops => '门店';

  @override
  String get tabBookings => '预约';

  @override
  String get tabFavorites => '收藏';

  @override
  String get tabProfile => '我的';

  @override
  String get noFavoritesYet => '还没有收藏的门店';

  @override
  String get addFavoritesHint => '添加一些门店到收藏';

  @override
  String get unableToLoadShop => '无法加载门店详情';

  @override
  String get bookNow => '立即预约';

  @override
  String get services => '服务项目';

  @override
  String get therapists => '技师';

  @override
  String get reviews => '用户评价';

  @override
  String get noReviewsYet => '暂无评价';

  @override
  String get reset => '重置';

  @override
  String get selectService => '选择服务';

  @override
  String get therapistOptional => '选择技师（可选）';

  @override
  String get selectDate => '选择日期';

  @override
  String get availableTime => '可预约时段';

  @override
  String get bookingSummary => '预约摘要';

  @override
  String get confirmBooking => '确认预约';

  @override
  String get creatingBooking => '创建中...';

  @override
  String get total => '合计';

  @override
  String min(Object count) {
    return '$count分钟';
  }

  @override
  String get bookingConfirmed => '已确认';

  @override
  String failedToCreateBooking(Object error) {
    return '预约失败：$error';
  }

  @override
  String get failedToLoadBookings => '加载预约失败';

  @override
  String get noBookingsYet => '还没有预约';

  @override
  String get bookMassageHint => '预约一次按摩来开始吧';

  @override
  String get writeReview => '写评价';

  @override
  String get cancel => '取消';

  @override
  String get cancelBooking => '取消预约';

  @override
  String get cancelBookingConfirm => '确定要取消这个预约吗？';

  @override
  String get keep => '保留';

  @override
  String get delete => '删除';

  @override
  String get deleteBooking => '删除预约';

  @override
  String get deleteBookingConfirm => '确定要永久删除这个预约吗？此操作不可撤销。';

  @override
  String get deletePermanently => '永久删除';

  @override
  String get bookingCancelled => '已取消';

  @override
  String get bookingDeleted => '预约已删除';

  @override
  String failedToCancel(Object error) {
    return '取消失败：$error';
  }

  @override
  String failedToDelete(Object error) {
    return '删除失败：$error';
  }

  @override
  String get editProfile => '编辑资料';

  @override
  String get notifications => '通知设置';

  @override
  String get paymentMethods => '付款方式';

  @override
  String get bookingHistory => '预约记录';

  @override
  String get myFavorites => '我的收藏';

  @override
  String get myReviews => '我的评价';

  @override
  String get settings => '设置';

  @override
  String comingSoon(Object feature) {
    return '$feature — 即将开放';
  }

  @override
  String get logoutConfirm => '确定要退出登录吗？';

  @override
  String get editNamePhoneEmail => '姓名和邮箱';

  @override
  String get bookingRemindersPromotions => '预约提醒、促销信息';

  @override
  String get addManageCards => '添加或管理卡片';

  @override
  String get viewPastBookings => '查看历史预约';

  @override
  String get savedShops => '已收藏的门店';

  @override
  String get viewYourReviews => '查看你的评价';

  @override
  String get language => '语言';

  @override
  String get switchToFavorites => '切换到收藏标签查看已保存的门店';

  @override
  String get writeAReview => '写评价';

  @override
  String get editReview => '编辑评价';

  @override
  String get rateYourExperience => '评价你的体验';

  @override
  String get updateYourRating => '更新评分';

  @override
  String get tapStarToRate => '点击星星进行评分';

  @override
  String get shareExperienceOptional => '分享你的体验（选填）';

  @override
  String get submitReview => '提交评价';

  @override
  String get updateReviewBtn => '更新评价';

  @override
  String get pleaseSelectRating => '请选择评分';

  @override
  String get reviewSubmitted => '评价提交成功';

  @override
  String get reviewUpdated => '评价已更新';

  @override
  String get reviewDeleted => '评价已删除';

  @override
  String failedToSubmitReview(Object error) {
    return '提交失败：$error';
  }

  @override
  String failedToUpdateReview(Object error) {
    return '更新失败：$error';
  }

  @override
  String failedToDeleteReview(Object error) {
    return '删除失败：$error';
  }

  @override
  String get failedToLoadReviews => '加载评价失败';

  @override
  String get noReviewsYetHint => '完成一次预约后可写评价';

  @override
  String get deleteReview => '删除评价';

  @override
  String get deleteReviewConfirm => '确定要删除这条评价吗？';

  @override
  String get edit => '编辑';

  @override
  String get name => '姓名';

  @override
  String get email => '邮箱';

  @override
  String get save => '保存';

  @override
  String get profileUpdated => '个人资料已更新';

  @override
  String failedToUpdateProfile(Object error) {
    return '更新失败：$error';
  }

  @override
  String get ratingPoor => '差';

  @override
  String get ratingFair => '一般';

  @override
  String get ratingGood => '良好';

  @override
  String get ratingVeryGood => '很好';

  @override
  String get ratingExcellent => '优秀';

  @override
  String get minutes => '分钟';

  @override
  String get from => '起';

  @override
  String reviewsCount(Object count) {
    return '$count条评价';
  }

  @override
  String bookingsCount(Object count) {
    return '$count次预约';
  }

  @override
  String get separator => '·';

  @override
  String get noTherapist => '不指定技师';

  @override
  String get loading => '加载中...';

  @override
  String get errorOccurred => '出错了';

  @override
  String get merchantPortal => '商户中心';

  @override
  String get becomeMerchant => '成为商户';

  @override
  String get merchantApply => '申请成为商户';

  @override
  String get merchantApplication => '商户申请';

  @override
  String get applySuccess => '申请已提交！等待审核。';

  @override
  String get applicationPending => '您的申请正在审核中，通过后将通知您。';

  @override
  String get applicationRejected => '申请未通过，请联系客服。';

  @override
  String get shopManagement => '门店管理';

  @override
  String get serviceManagement => '服务管理';

  @override
  String get therapistManagement => '技师管理';

  @override
  String get bookingManagement => '预约管理';

  @override
  String get dashboard => '数据看板';

  @override
  String get shopInfo => '门店信息';

  @override
  String get businessHours => '营业时间';

  @override
  String get shopImages => '门店图片';

  @override
  String get shopCertificates => '资质证书';

  @override
  String get addService => '添加服务';

  @override
  String get editService => '编辑服务';

  @override
  String get addTherapist => '添加技师';

  @override
  String get editTherapist => '编辑技师';

  @override
  String get categoryMassage => '按摩';

  @override
  String get categoryHeadTherapy => '头疗';

  @override
  String get categoryOther => '其他';

  @override
  String get durationMin => '时长（分钟）';

  @override
  String get price => '价格';

  @override
  String get priceCents => '价格（分）';

  @override
  String get bio => '简介';

  @override
  String get yearsExp => '工龄（年）';

  @override
  String get gender => '性别';

  @override
  String get male => '男';

  @override
  String get female => '女';

  @override
  String get avgRating => '平均评分';

  @override
  String get totalRevenue => '总收入';

  @override
  String get netRevenue => '净收入';

  @override
  String get totalBookings => '总预约数';

  @override
  String get bookingPending => '待确认';

  @override
  String get bookingCompleted => '已完成';

  @override
  String get confirm => '确认';

  @override
  String get complete => '完成';

  @override
  String get close => '关闭';

  @override
  String get openTime => '营业中';

  @override
  String get closed => '休息';

  @override
  String get address => '地址';

  @override
  String get city => '城市';

  @override
  String get state => '州';

  @override
  String get zipCode => '邮编';

  @override
  String get latitude => '纬度';

  @override
  String get longitude => '经度';

  @override
  String get category => '分类';

  @override
  String get description => '描述';

  @override
  String get shopName => '门店名称';

  @override
  String get shopPhone => '门店电话';

  @override
  String get imageUrl => '图片链接';

  @override
  String get licenseUrl => '执照链接';

  @override
  String get businessLicenseUrl => '营业执照链接';

  @override
  String get mon => '周一';

  @override
  String get tue => '周二';

  @override
  String get wed => '周三';

  @override
  String get thu => '周四';

  @override
  String get fri => '周五';

  @override
  String get sat => '周六';

  @override
  String get sun => '周日';

  @override
  String get dailyRevenue => '每日收入';

  @override
  String get bookingDistribution => '预约分布';

  @override
  String get shopNameEn => '门店英文名';

  @override
  String get noServices => '暂无服务项目';

  @override
  String get noTherapists => '暂无技师';

  @override
  String get tabMerchant => '商户';

  @override
  String get merchantApplyTitle => '申请成为商户';

  @override
  String get merchantApplyDesc => '填写门店详情以开始接受预约';

  @override
  String get mapView => '地图视图';

  @override
  String get mapViewTitle => '地图';

  @override
  String get viewShop => '查看门店';

  @override
  String get getDirections => '导航到店';

  @override
  String get gettingLocation => '正在获取位置...';

  @override
  String get noShopsOnMap => '地图上没有门店显示';

  @override
  String get recenter => '重新定位';

  @override
  String get locationUnavailable => '定位不可用，请稍后重试';

  @override
  String get paymentTitle => '付款';

  @override
  String get paymentOrderSummary => '订单摘要';

  @override
  String get paymentPriceBreakdown => '价格明细';

  @override
  String get paymentCardDetails => '卡片信息';

  @override
  String get paymentShop => '门店';

  @override
  String get paymentService => '服务';

  @override
  String get paymentDate => '日期';

  @override
  String get paymentTime => '时间';

  @override
  String get paymentDuration => '时长';

  @override
  String get paymentSubtotal => '小计';

  @override
  String get paymentCouponDiscount => '优惠券抵扣';

  @override
  String get paymentPlatformFee => '平台服务费';

  @override
  String get paymentCardName => '持卡人姓名';

  @override
  String get paymentCardNumber => '卡号';

  @override
  String get paymentExpiry => '有效期';

  @override
  String get paymentCvc => 'CVC';

  @override
  String get paymentPay => '支付';

  @override
  String get paymentProcessing => '处理中...';

  @override
  String get paymentTryAgain => '重试';

  @override
  String get paymentSuccessTitle => '支付成功！';

  @override
  String get paymentSuccessMessage => '预约已确认。\n正在跳转到我的预约...';

  @override
  String get transactions => '交易记录';

  @override
  String get transactionList => '交易历史';

  @override
  String get transactionDate => '日期';

  @override
  String get transactionType => '类型';

  @override
  String get transactionAmount => '金额';

  @override
  String get transactionFee => '手续费';

  @override
  String get transactionNet => '净额';

  @override
  String get transactionStatus => '状态';

  @override
  String get transactionDescription => '描述';

  @override
  String get transactionBooking => '预订';

  @override
  String get transactionPayment => '付款';

  @override
  String get transactionPayout => '提现';

  @override
  String get transactionRefund => '退款';

  @override
  String get filterByDate => '按日期筛选';

  @override
  String get startDate => '开始日期';

  @override
  String get endDate => '结束日期';

  @override
  String get exportCsv => '导出 CSV';

  @override
  String get taxReport => '税务报表';

  @override
  String get taxYear => '纳税年度';

  @override
  String get totalGross => '总收入';

  @override
  String get totalFees => '总手续费';

  @override
  String get totalNet => '净收入';

  @override
  String get totalRefunds => '总退款';

  @override
  String get totalPayouts => '总提现';

  @override
  String get netEarnings => '净利润';

  @override
  String get noTransactions => '暂无交易记录';

  @override
  String get loadingTransactions => '加载交易记录中...';

  @override
  String get requestRefund => '申请退款';

  @override
  String get requestRefundConfirm => '您确定要退款此预约吗？';

  @override
  String get refundYes => '确认退款';

  @override
  String get refundSuccess => '退款成功';

  @override
  String get failedToRefund => '退款失败';

  @override
  String get announcementTitle => '公告';

  @override
  String get announcementTypeInfo => '信息';

  @override
  String get announcementTypeImportant => '重要';

  @override
  String get announcementTypeUrgent => '紧急';

  @override
  String get announcementEmpty => '暂无公告';

  @override
  String get readMore => '查看详情';

  @override
  String get categoryMixed => '综合';

  @override
  String get mapLegend => '图例';

  @override
  String get labelEnglish => 'English';

  @override
  String get labelChinese => '中文';

  @override
  String get dateAndTime => '日期与时间';

  @override
  String get chooseTherapist => '选择技师';

  @override
  String get chooseDateTime => '选择日期与时间';

  @override
  String get nextStep => '下一步';

  @override
  String get selected => '已选择';

  @override
  String get assignTherapist => '由门店安排技师';

  @override
  String get noLinkedTherapists => '此服务暂无可指定的技师。可选择“不指定技师”，由门店安排。';

  @override
  String yearsExperience(int count) {
    return '$count 年经验';
  }

  @override
  String get selectDateFirst => '请先选择日期';

  @override
  String get today => '今天';

  @override
  String get noAvailableSlots => '当天暂无可预约时段';

  @override
  String selectedMinutes(int count) {
    return '已选择 $count 分钟';
  }

  @override
  String get selectTimeBlocks => '选择一个可约开始时间，时长由服务规格决定';

  @override
  String get morning => '上午';

  @override
  String get afternoon => '下午';

  @override
  String get evening => '晚上';

  @override
  String get estimatedServicePrice => '预估服务价格';

  @override
  String get reviewTotalBeforeConfirming => '确认预约前请核对当前总价。订单由门店线下处理，确认不代表已付款。';

  @override
  String get coupon => '优惠券';

  @override
  String get select => '选择';

  @override
  String get selectCoupon => '选择优惠券';

  @override
  String get noApplicableCoupons => '此预约暂无可用优惠券';

  @override
  String get bookingUnavailable => '此门店尚未开放线上预约。';

  @override
  String get bookingFailedRetry => '创建预约失败，请重试。';

  @override
  String get chooseTherapistWhenBooking => '请在预约时选择技师。';

  @override
  String get aboutShop => '门店简介';

  @override
  String get showLess => '收起';

  @override
  String get bookService => '预约';

  @override
  String get shopInfoCopied => '门店信息已复制';

  @override
  String get bookingUnavailableHint => '此门店尚未开放线上预约，仍可浏览服务与价格。';

  @override
  String get reviewsUnavailableHint => '此门店暂不接受新增或修改评价，仍可查看已有评价。';

  @override
  String get onlineBookingUnavailable => '暂未开放线上预约';

  @override
  String get favoriteShop => '收藏门店';

  @override
  String get unfavoriteShop => '取消收藏';

  @override
  String get copyShopInfo => '复制门店信息';

  @override
  String get clearSearch => '清除搜索';

  @override
  String viewAllReviews(int count) {
    return '查看全部 $count 条评价';
  }
}

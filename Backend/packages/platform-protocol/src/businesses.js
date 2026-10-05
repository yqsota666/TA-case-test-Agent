const COMMON_APPLICATION = [
  'AppSheetSerialNo','FundCode','TransactionDate','TransactionAccountID',
  'DistributorCode','BusinessCode','TAAccountID'
];

const TIMED_APPLICATION = [...COMMON_APPLICATION,'BranchCode','TransactionTime'];
const COMMON_CONFIRMATION = [
  'AppSheetSerialNo','TransactionCfmDate','FundCode','TransactionDate','ReturnCode',
  'TransactionAccountID','DistributorCode','BusinessCode','TAAccountID','TASerialNO','DownLoaddate'
];

export const TRANSACTION_BUSINESSES = {
  '020': {
    name: '认购', confirmationCode: '120',
    required03: [...TIMED_APPLICATION,'CurrencyType','ApplicationAmount','ShareClass'],
    required04: [...COMMON_CONFIRMATION,'CurrencyType','ConfirmedAmount','ApplicationAmount','NAV','BranchCode','TransactionTime','ShareClass'],
    optional03: ['DepositAcct','RegionCode','ApplicationVol','IndividualOrInstitution','ValidPeriod','FutureSubscribeDate'],
    inputs: ['FundCode','ApplicationAmount']
  },
  '022': {
    name: '申购', confirmationCode: '122',
    required03: [...TIMED_APPLICATION,'CurrencyType','ApplicationAmount','ShareClass','ChargeType'],
    required04: [...COMMON_CONFIRMATION,'CurrencyType','ConfirmedVol','ConfirmedAmount','ApplicationAmount','Charge','AgencyFee','NAV','BranchCode','TransactionTime','TransferFee','ShareClass'],
    optional03: ['DiscountRateOfCommission','DepositAcct','RegionCode','DateOfPeriodicSubs','OriginalAppSheetNo','IndividualOrInstitution','TASerialNO','ValidPeriod','TermOfPeriodicSubs','FutureBuyDate','LargeBuyFlag','VarietyCodeOfPeriodicSubs','SerialNoOfPeriodicSubs','SpecifyRateFee','SpecifyFee'],
    inputs: ['FundCode','ApplicationAmount']
  },
  '024': {
    name: '赎回', confirmationCode: '124',
    required03: [...TIMED_APPLICATION,'LargeRedemptionFlag','ApplicationVol','ShareClass','ChargeType'],
    required04: [...COMMON_CONFIRMATION,'CurrencyType','ConfirmedVol','ConfirmedAmount','LargeRedemptionFlag','ApplicationVol','BusinessFinishFlag','Charge','AgencyFee','NAV','BranchCode','TransactionTime','OtherFee1','TransferFee','ShareClass','BreachFee','BreachFeeBackToFund','PunishFee','AchievementPay','AchievementCompen'],
    optional03: ['DepositAcct','RegionCode','CurrencyType','OriginalSerialNo','OriginalAppSheetNo','OriginalSubsDate','IndividualOrInstitution','RedemptionDateInAdvance','ValidPeriod','OriginalCfmDate','TakeIncomeFlag','SpecifyRateFee','SpecifyFee'],
    inputs: ['FundCode','ApplicationVol','LargeRedemptionFlag']
  },
  '026': {
    name: '转托管', confirmationCode: '126',
    required03: [...TIMED_APPLICATION,'TargetDistributorCode','ApplicationVol','TargetTransactionAccountID','ShareClass'],
    required04: [...COMMON_CONFIRMATION,'ConfirmedVol','TargetDistributorCode','ApplicationVol','BranchCode','TransactionTime','TransferFee','ShareClass'],
    optional03: ['DepositAcct','RegionCode','Charge','OriginalSerialNo','OriginalAppSheetNo','IndividualOrInstitution','TargetBranchCode','TargetRegionCode','OriginalCfmDate'],
    inputs: ['FundCode','ApplicationVol','TargetDistributorCode','TargetTransactionAccountID']
  },
  '029': {
    name: '设置分红方式', confirmationCode: '129',
    required03: [...TIMED_APPLICATION,'DefDividendMethod','ShareClass'],
    required04: [...COMMON_CONFIRMATION,'DefDividendMethod','BranchCode','TransactionTime','ShareClass'],
    optional03: ['RegionCode','IndividualOrInstitution','DividendRatio'],
    inputs: ['FundCode','DefDividendMethod']
  },
  '031': {
    name: '基金份额冻结', confirmationCode: '131',
    required03: [...TIMED_APPLICATION,'FrozenCause','ApplicationVol','ShareClass'],
    required04: [...COMMON_CONFIRMATION,'ConfirmedVol','ApplicationVol','BranchCode','TransactionTime','ShareClass'],
    optional03: ['RegionCode','FreezingDeadline','IndividualOrInstitution','Specification','OriginalCfmDate','DetailFlag'],
    inputs: ['FundCode','ApplicationVol','FrozenCause']
  },
  '032': {
    name: '基金份额解冻', confirmationCode: '132',
    required03: [...TIMED_APPLICATION,'ApplicationVol','ShareClass'],
    required04: [...COMMON_CONFIRMATION,'ConfirmedVol','OriginalSerialNo','ApplicationVol','BranchCode','TransactionTime','ShareClass'],
    optional03: ['RegionCode','OriginalSerialNo','IndividualOrInstitution','Specification','OriginalCfmDate','DetailFlag','OriginalAppSheetNo'],
    inputs: ['FundCode','ApplicationVol']
  },
  '036': {
    name: '基金转换', confirmationCode: '136',
    required03: [...TIMED_APPLICATION,'DiscountRateOfCommission','CodeOfTargetFund','LargeRedemptionFlag','ApplicationVol','ShareClass','BackenloadDiscount','TargetShareType','ChargeType'],
    required04: [...COMMON_CONFIRMATION,'CodeOfTargetFund','ConfirmedVol','LargeRedemptionFlag','ApplicationVol','CfmVolOfTargetFund','Charge','AgencyFee','NAV','BranchCode','TransactionTime','TargetNAV','TransferFee','ShareClass','TargetShareType','ChangeFee','RecuperateFee'],
    optional03: ['RegionCode','OriginalSerialNo','OriginalAppSheetNo','IndividualOrInstitution','TotalBackendLoad','OriginalCfmDate','DetailFlag','TargetTAAccountID','TargetRegistrarCode','TakeIncomeFlag','SpecifyRateFee','SpecifyFee'],
    inputs: ['FundCode','CodeOfTargetFund','ApplicationVol','LargeRedemptionFlag']
  },
  '040': {
    name: '退款', confirmationCode: '140',
    required03: [...TIMED_APPLICATION,'CurrencyType','ApplicationAmount'],
    required04: [...COMMON_CONFIRMATION,'CurrencyType','ConfirmedAmount','ApplicationAmount','BranchCode','TransactionTime'],
    optional03: [],
    inputs: ['FundCode','ApplicationAmount']
  },
  '041': {
    name: '补款', confirmationCode: '141',
    required03: [...TIMED_APPLICATION,'CurrencyType','ApplicationAmount'],
    required04: [...COMMON_CONFIRMATION,'CurrencyType','ConfirmedAmount','ApplicationAmount','BranchCode','TransactionTime'],
    optional03: [],
    inputs: ['FundCode','ApplicationAmount']
  },
  '052': {
    name: '撤单', confirmationCode: '152',
    required03: COMMON_APPLICATION.concat('OriginalAppSheetNo'),
    required04: COMMON_CONFIRMATION.concat('OriginalAppSheetNo'),
    optional03: ['ApplicationVol','ApplicationAmount','OriginalAppDate'],
    inputs: ['OriginalAppSheetNo']
  },
  '058': {
    name: '变更交易账号', confirmationCode: '158',
    required03: ['AppSheetSerialNo','TransactionDate','TargetTransactionAccountID','TransactionAccountID','DistributorCode','BusinessCode','TAAccountID','BranchCode','TransactionTime'],
    required04: ['AppSheetSerialNo','TransactionCfmDate','TransactionDate','ReturnCode','TargetTransactionAccountID','TransactionAccountID','DistributorCode','BusinessCode','TAAccountID','BranchCode','TransactionTime'],
    optional03: ['RegionCode'],
    inputs: ['TargetTransactionAccountID']
  },
  '070': {
    name: '地区编号变更通知', confirmationCode: null,
    required03: ['AppSheetSerialNo','TAAccountID','TransactionAccountID','TransactionDate','BusinessCode','RegionCode','TargetRegionCode'],
    required04: [],
    optional03: [],
    inputs: ['TargetRegionCode']
  }
};

export const TRANSACTION_FIELD_INPUTS = {
  FundCode: { label:'基金', type:'fund' },
  CodeOfTargetFund: { label:'目标基金', type:'targetFund' },
  ApplicationAmount: { label:'申请金额', type:'number', min:'0.01', step:'0.01' },
  ApplicationVol: { label:'申请基金份额', type:'number', min:'0.01', step:'0.01' },
  LargeRedemptionFlag: { label:'巨额赎回处理', type:'select', options:[['0','取消'],['1','顺延']] },
  DefDividendMethod: { label:'默认分红方式', type:'select', options:[['0','红利转投'],['1','现金分红']] },
  FrozenCause: { label:'冻结原因', type:'select', options:[['0','司法冻结'],['1','柜台冻结'],['2','质押冻结'],['3','质押、司法双重冻结'],['4','柜台、司法双重冻结']] },
  OriginalAppSheetNo: { label:'原申请单编号', type:'order' },
  TargetDistributorCode: { label:'转入销售机构', type:'distributor' },
  TargetTransactionAccountID: { label:'目标交易账号', type:'text', maxLength:17, numeric:true },
  TargetRegionCode: { label:'变更后的地区编号', type:'text', maxLength:4, numeric:true }
};

export const confirmationCodeFor = code => TRANSACTION_BUSINESSES[code]?.confirmationCode || null;

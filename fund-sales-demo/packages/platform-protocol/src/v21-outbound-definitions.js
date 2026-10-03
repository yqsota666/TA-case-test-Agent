// Transcribed from 表69 (01) and 表71 (03) in 中央数据交换平台开放式基金业务数据交换协议V2.1-20171130.docx.
export const V21_OUTBOUND_DEFINITIONS = {
  "01": [
    {
      "name": "Address",
      "type": "C",
      "length": 120
    },
    {
      "name": "InstReprIDCode",
      "type": "C",
      "length": 30
    },
    {
      "name": "InstReprIDType",
      "type": "C",
      "length": 1
    },
    {
      "name": "InstReprName",
      "type": "C",
      "length": 20
    },
    {
      "name": "AppSheetSerialNo",
      "type": "A",
      "length": 24
    },
    {
      "name": "CertificateType",
      "type": "C",
      "length": 1
    },
    {
      "name": "CertificateNo",
      "type": "C",
      "length": 30
    },
    {
      "name": "InvestorName",
      "type": "C",
      "length": 120
    },
    {
      "name": "TransactionDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "TransactionTime",
      "type": "A",
      "length": 6
    },
    {
      "name": "IndividualOrInstitution",
      "type": "A",
      "length": 1
    },
    {
      "name": "PostCode",
      "type": "A",
      "length": 6
    },
    {
      "name": "TransactorCertNo",
      "type": "C",
      "length": 30
    },
    {
      "name": "TransactorCertType",
      "type": "C",
      "length": 1
    },
    {
      "name": "TransactorName",
      "type": "C",
      "length": 20
    },
    {
      "name": "TransactionAccountID",
      "type": "A",
      "length": 17
    },
    {
      "name": "DistributorCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "BusinessCode",
      "type": "A",
      "length": 3
    },
    {
      "name": "AcctNoOfFMInClearingAgency",
      "type": "C",
      "length": 28
    },
    {
      "name": "AcctNameOfFMInClearingAgency",
      "type": "C",
      "length": 60
    },
    {
      "name": "ClearingAgencyCode",
      "type": "A",
      "length": 9
    },
    {
      "name": "InvestorsBirthday",
      "type": "A",
      "length": 8
    },
    {
      "name": "DepositAcct",
      "type": "C",
      "length": 19
    },
    {
      "name": "RegionCode",
      "type": "A",
      "length": 4
    },
    {
      "name": "EducationLevel",
      "type": "C",
      "length": 3
    },
    {
      "name": "EmailAddress",
      "type": "C",
      "length": 40
    },
    {
      "name": "FaxNo",
      "type": "C",
      "length": 24
    },
    {
      "name": "VocationCode",
      "type": "C",
      "length": 3
    },
    {
      "name": "HomeTelNo",
      "type": "C",
      "length": 22
    },
    {
      "name": "AnnualIncome",
      "type": "N",
      "length": 8,
      "scale": 0
    },
    {
      "name": "MobileTelNo",
      "type": "C",
      "length": 24
    },
    {
      "name": "BranchCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "OfficeTelNo",
      "type": "C",
      "length": 22
    },
    {
      "name": "AccountAbbr",
      "type": "C",
      "length": 12
    },
    {
      "name": "ConfidentialDocumentCode",
      "type": "C",
      "length": 8
    },
    {
      "name": "Sex",
      "type": "A",
      "length": 1
    },
    {
      "name": "SHSecuritiesAccountID",
      "type": "C",
      "length": 10
    },
    {
      "name": "SZSecuritiesAccountID",
      "type": "C",
      "length": 10
    },
    {
      "name": "TAAccountID",
      "type": "A",
      "length": 12
    },
    {
      "name": "TelNo",
      "type": "C",
      "length": 22
    },
    {
      "name": "TradingMethod",
      "type": "C",
      "length": 8
    },
    {
      "name": "MinorFlag",
      "type": "C",
      "length": 1
    },
    {
      "name": "DeliverType",
      "type": "C",
      "length": 1
    },
    {
      "name": "TransactorIDType",
      "type": "C",
      "length": 1
    },
    {
      "name": "AccountCardID",
      "type": "C",
      "length": 8
    },
    {
      "name": "MultiAcctFlag",
      "type": "A",
      "length": 1
    },
    {
      "name": "TargetTransactionAccountID",
      "type": "A",
      "length": 17
    },
    {
      "name": "AcctNameOfInvestorInClearingAgency",
      "type": "C",
      "length": 60
    },
    {
      "name": "AcctNoOfInvestorInClearingAgency",
      "type": "C",
      "length": 28
    },
    {
      "name": "ClearingAgency",
      "type": "A",
      "length": 9
    },
    {
      "name": "DeliverWay",
      "type": "C",
      "length": 8
    },
    {
      "name": "Nationality",
      "type": "C",
      "length": 3
    },
    {
      "name": "NetNo",
      "type": "C",
      "length": 9
    },
    {
      "name": "Broker",
      "type": "C",
      "length": 12
    },
    {
      "name": "CorpName",
      "type": "C",
      "length": 40
    },
    {
      "name": "CertValidDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "InstTranCertValidDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "InstReprCertValidDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "ClientRiskRate",
      "type": "C",
      "length": 1
    },
    {
      "name": "InstReprManageRange",
      "type": "C",
      "length": 2
    },
    {
      "name": "ControlHolder",
      "type": "C",
      "length": 80
    },
    {
      "name": "ActualController",
      "type": "C",
      "length": 80
    },
    {
      "name": "MarriageStatus",
      "type": "C",
      "length": 1
    },
    {
      "name": "FamilyNum",
      "type": "N",
      "length": 2,
      "scale": 0
    },
    {
      "name": "Penates",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "MediaHobby",
      "type": "C",
      "length": 1
    },
    {
      "name": "InstitutionType",
      "type": "C",
      "length": 1
    },
    {
      "name": "EnglishFirstName",
      "type": "C",
      "length": 20
    },
    {
      "name": "EnglishFamliyName",
      "type": "C",
      "length": 20
    },
    {
      "name": "Vocation",
      "type": "C",
      "length": 4
    },
    {
      "name": "CorpoProperty",
      "type": "C",
      "length": 2
    },
    {
      "name": "StaffNum",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "Hobbytype",
      "type": "C",
      "length": 2
    },
    {
      "name": "Province",
      "type": "C",
      "length": 6
    },
    {
      "name": "City",
      "type": "C",
      "length": 6
    },
    {
      "name": "County",
      "type": "C",
      "length": 6
    },
    {
      "name": "CommendPerson",
      "type": "C",
      "length": 40
    },
    {
      "name": "CommendPersonType",
      "type": "C",
      "length": 1
    },
    {
      "name": "AcceptMethod",
      "type": "C",
      "length": 1
    },
    {
      "name": "FrozenCause",
      "type": "A",
      "length": 1
    },
    {
      "name": "FreezingDeadline",
      "type": "A",
      "length": 8
    },
    {
      "name": "OriginalSerialNo",
      "type": "A",
      "length": 20
    },
    {
      "name": "OriginalAppSheetNo",
      "type": "A",
      "length": 24
    },
    {
      "name": "Specification",
      "type": "C",
      "length": 60
    }
  ],
  "03": [
    {
      "name": "AppSheetSerialNo",
      "type": "A",
      "length": 24
    },
    {
      "name": "FundCode",
      "type": "C",
      "length": 6
    },
    {
      "name": "LargeRedemptionFlag",
      "type": "A",
      "length": 1
    },
    {
      "name": "TransactionDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "TransactionTime",
      "type": "A",
      "length": 6
    },
    {
      "name": "TransactionAccountID",
      "type": "A",
      "length": 17
    },
    {
      "name": "DistributorCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "ApplicationVol",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "ApplicationAmount",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "BusinessCode",
      "type": "A",
      "length": 3
    },
    {
      "name": "TAAccountID",
      "type": "A",
      "length": 12
    },
    {
      "name": "DiscountRateOfCommission",
      "type": "N",
      "length": 5,
      "scale": 4
    },
    {
      "name": "DepositAcct",
      "type": "C",
      "length": 19
    },
    {
      "name": "RegionCode",
      "type": "A",
      "length": 4
    },
    {
      "name": "CurrencyType",
      "type": "A",
      "length": 3
    },
    {
      "name": "BranchCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "OriginalAppSheetNo",
      "type": "A",
      "length": 24
    },
    {
      "name": "OriginalSubsDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "IndividualOrInstitution",
      "type": "A",
      "length": 1
    },
    {
      "name": "ValidPeriod",
      "type": "N",
      "length": 2,
      "scale": 0
    },
    {
      "name": "DaysRedemptionInAdvance",
      "type": "N",
      "length": 5,
      "scale": 0
    },
    {
      "name": "RedemptionDateInAdvance",
      "type": "A",
      "length": 8
    },
    {
      "name": "OriginalSerialNo",
      "type": "A",
      "length": 20
    },
    {
      "name": "DateOfPeriodicSubs",
      "type": "A",
      "length": 8
    },
    {
      "name": "TASerialNO",
      "type": "A",
      "length": 20
    },
    {
      "name": "TermOfPeriodicSubs",
      "type": "N",
      "length": 5,
      "scale": 0
    },
    {
      "name": "FutureBuyDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "TargetDistributorCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "Charge",
      "type": "N",
      "length": 10,
      "scale": 2
    },
    {
      "name": "TargetBranchCode",
      "type": "C",
      "length": 9
    },
    {
      "name": "TargetTransactionAccountID",
      "type": "A",
      "length": 17
    },
    {
      "name": "TargetRegionCode",
      "type": "A",
      "length": 4
    },
    {
      "name": "DividendRatio",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "Specification",
      "type": "C",
      "length": 60
    },
    {
      "name": "CodeOfTargetFund",
      "type": "A",
      "length": 6
    },
    {
      "name": "TotalBackendLoad",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "ShareClass",
      "type": "C",
      "length": 1
    },
    {
      "name": "OriginalCfmDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "DetailFlag",
      "type": "C",
      "length": 1
    },
    {
      "name": "OriginalAppDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "DefDividendMethod",
      "type": "A",
      "length": 1
    },
    {
      "name": "FrozenCause",
      "type": "A",
      "length": 1
    },
    {
      "name": "FreezingDeadline",
      "type": "A",
      "length": 8
    },
    {
      "name": "VarietyCodeOfPeriodicSubs",
      "type": "C",
      "length": 5
    },
    {
      "name": "SerialNoOfPeriodicSubs",
      "type": "C",
      "length": 5
    },
    {
      "name": "RationType",
      "type": "C",
      "length": 1
    },
    {
      "name": "TargetTAAccountID",
      "type": "C",
      "length": 12
    },
    {
      "name": "TargetRegistrarCode",
      "type": "C",
      "length": 2
    },
    {
      "name": "NetNo",
      "type": "C",
      "length": 9
    },
    {
      "name": "CustomerNo",
      "type": "C",
      "length": 12
    },
    {
      "name": "TargetShareType",
      "type": "C",
      "length": 1
    },
    {
      "name": "RationProtocolNo",
      "type": "C",
      "length": 20
    },
    {
      "name": "BeginDateOfPeriodicSubs",
      "type": "A",
      "length": 8
    },
    {
      "name": "EndDateOfPeriodicSubs",
      "type": "A",
      "length": 8
    },
    {
      "name": "SendDayOfPeriodicSubs",
      "type": "N",
      "length": 2,
      "scale": 0
    },
    {
      "name": "Broker",
      "type": "C",
      "length": 12
    },
    {
      "name": "SalesPromotion",
      "type": "C",
      "length": 3
    },
    {
      "name": "AcceptMethod",
      "type": "C",
      "length": 1
    },
    {
      "name": "ForceRedemptionType",
      "type": "C",
      "length": 1
    },
    {
      "name": "TakeIncomeFlag",
      "type": "C",
      "length": 1
    },
    {
      "name": "PurposeOfPeSubs",
      "type": "C",
      "length": 40
    },
    {
      "name": "FrequencyOfPeSubs",
      "type": "N",
      "length": 5,
      "scale": 0
    },
    {
      "name": "PeriodSubTimeUnit",
      "type": "C",
      "length": 1
    },
    {
      "name": "BatchNumOfPeSubs",
      "type": "N",
      "length": 16,
      "scale": 2
    },
    {
      "name": "CapitalMode",
      "type": "C",
      "length": 2
    },
    {
      "name": "DetailCapticalMode",
      "type": "C",
      "length": 2
    },
    {
      "name": "BackenloadDiscount",
      "type": "N",
      "length": 5,
      "scale": 4
    },
    {
      "name": "CombineNum",
      "type": "C",
      "length": 6
    },
    {
      "name": "FutureSubscribeDate",
      "type": "A",
      "length": 8
    },
    {
      "name": "TradingMethod",
      "type": "C",
      "length": 8
    },
    {
      "name": "LargeBuyFlag",
      "type": "A",
      "length": 1
    },
    {
      "name": "ChargeType",
      "type": "C",
      "length": 1
    },
    {
      "name": "SpecifyRateFee",
      "type": "N",
      "length": 9,
      "scale": 8
    },
    {
      "name": "SpecifyFee",
      "type": "N",
      "length": 16,
      "scale": 2
    }
  ]
};

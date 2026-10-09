import crypto from 'node:crypto';
import {buildDataFile, buildIndexFile, dataFileName, parseDataFile, parseIndexFile} from './codec.js';
import {fieldsForFile,profileForVersion,canonicalProtocolVersion} from './profiles.js';
import {zipProtocolFiles} from './application-package.js';

const allowed = ['aml', 'includeEmptyR1', 'dataSequence', 'summaryNo', 'sender', 'recipient',
  'fieldNamesCase', 'trailingCrlf', 'directoryLayout', 'indexSuffixes'];
export function normalizeDeliveryProfile(input = {}, version = '22') {
  version = canonicalProtocolVersion(version);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) {
    throw new Error('交付配置字段无效');
  }
  const defaults = profileForVersion(version).deliveryDefaults;
  const profile = {...defaults,...input,indexSuffixes:{...defaults.indexSuffixes,...input.indexSuffixes}};
  for (const k of ['aml', 'includeEmptyR1', 'dataSequence', 'trailingCrlf']) {
    if (typeof profile[k] !== 'boolean') throw new Error('交付配置开关无效');
  }
  if (!['21', '22'].includes(version) || (version !== '22' && (profile.aml || profile.includeEmptyR1))) {
    throw new Error('当前协议版本不支持该配套文件配置');
  }
  if (!['upper', 'canonical'].includes(profile.fieldNamesCase) ||
      !['flat', 'date', 'distributor/date'].includes(profile.directoryLayout) ||
      (profile.summaryNo !== undefined && (!Number.isInteger(profile.summaryNo) || profile.summaryNo < 1 || profile.summaryNo > 999))) {
    throw new Error('交付配置格式无效');
  }
  for (const k of ['sender', 'recipient']) {
    if (typeof profile[k] !== 'string' || !/^[A-Za-z0-9 ]{0,8}$/.test(profile[k])) throw new Error('交付配置收发方无效');
  }
  if (input.indexSuffixes !== undefined && (!input.indexSuffixes || typeof input.indexSuffixes !== 'object' ||
      Array.isArray(input.indexSuffixes) || Object.keys(input.indexSuffixes).some(k => !['OFI', 'OFX'].includes(k)))) {
    throw new Error('索引后缀配置无效');
  }
  if (Object.values(profile.indexSuffixes).some(s => typeof s !== 'string' || !/^(?:-[A-Za-z0-9]{1,16})?$/.test(s))) {
    throw new Error('索引后缀配置无效');
  }
  return profile;
}

export function deliveryDataFileName(wire, profile, sequence = 1) {
  return dataFileName({...wire, sequence: profile.dataSequence ? sequence : undefined});
}

function amlRecords(openings, fileType) {
  const investorType = fileType === 'X1' ? '1' : '0';
  const fields = fieldsForFile('22', fileType);
  return openings.filter(r => r.BusinessCode === '001' && r.IndividualOrInstitution === investorType).map(source => {
    const required = fileType === 'X1' ? ['InvestorName', 'CertificateType', 'CertificateNo'] : ['InvestorName'];
    if (required.some(k => !source[k]?.trim())) throw new Error('开户资料不足以生成反洗钱配套文件，请补齐客户资料');
    const record = Object.fromEntries(fields.map(f => [f.name, source[f.name] ?? null]));
    record.AppSheetSerialNo = 'AML' + crypto.createHash('sha256').update(`${fileType}:${source.DistributorCode}:${source.AppSheetSerialNo}`).digest('hex').slice(0, 21);
    record.OriginalAppSheetNo = source.AppSheetSerialNo;
    record.OriginalAppDate = source.TransactionDate;
    record.AddFlag = '0';
    // Only copy known customer fields. Tax declarations and compliance conclusions are never inferred.
    return record;
  });
}

export function buildDeliveryPackage(files, inputProfile = {}) {
  if (!files.length) throw new Error('尚未生成申请文件');
  const applications = files.map(f => ({...f, parsed: parseDataFile(f.rawBytes)}))
    .sort((a, b) => a.parsed.fileType.localeCompare(b.parsed.fileType) || a.fileName.localeCompare(b.fileName));
  const first = applications[0].parsed;
  const profile = normalizeDeliveryProfile(inputProfile, first.version);
  const names = new Set();
  for (const f of applications) {
    if (!['01', '03'].includes(f.parsed.fileType) || ['creator', 'receiver', 'date', 'version'].some(k => f.parsed[k] !== first[k])) {
      throw new Error('不同机构、业务日期或版本的申请不能放入同一交付包');
    }
    const prefix = `OFD_${first.creator}_${first.receiver}_${first.date}_${f.parsed.fileType}`;
    if (!new RegExp(`^${prefix}(?:_[0-9]{3,4})?\\.TXT$`).test(f.fileName) || names.has(f.fileName)) throw new Error('申请文件名无效或重复');
    names.add(f.fileName);
    if (f.sha256 && crypto.createHash('sha256').update(f.rawBytes).digest('hex') !== f.sha256) throw new Error('申请原件校验失败');
    if (f.parsed.records.some(r => r.DistributorCode !== first.creator || r.TransactionDate !== first.date)) throw new Error('申请记录机构或日期与文件头不一致');
  }
  const openings = applications.filter(f => f.parsed.fileType === '01').flatMap(f => f.parsed.records);
  const openingByAccount = new Map();
  for (const r of openings) {
    if (r.BusinessCode !== '001') continue;
    if (openingByAccount.has(r.TransactionAccountID)) throw new Error('同账户开户申请重复');
    openingByAccount.set(r.TransactionAccountID, r);
    if (profile.aml && !['0', '1'].includes(r.IndividualOrInstitution)) throw new Error('当前客户类型缺少反洗钱资料映射，请补齐交付配置');
  }
  for (const f of applications.filter(f => f.parsed.fileType === '03')) for (const r of f.parsed.records) {
    const opening = openingByAccount.get(r.TransactionAccountID);
    if (opening && (r.OriginalAppSheetNo !== opening.AppSheetSerialNo || r.OriginalAppDate !== opening.TransactionDate)) {
      throw new Error('交易申请未精确引用同账户开户申请');
    }
    if (!opening && !r.TAAccountID?.trim()) throw new Error('交易申请缺少正式TA账号或同包开户申请');
  }
  const wire = {creator: first.creator, receiver: first.receiver, date: first.date, version: first.version};
  const data = applications.map(({fileName, rawBytes, parsed}) => ({fileName, rawBytes, fileType: parsed.fileType, recordCount: parsed.records.length}));
  function supplement(fileType, records) {
    const fileName = deliveryDataFileName({...wire, fileType}, profile);
    const rawBytes = buildDataFile({...wire, fileType, records, summaryNo: profile.summaryNo ?? 1,
      sender: profile.sender, recipient: profile.recipient, fieldNamesCase: profile.fieldNamesCase, trailingCrlf: profile.trailingCrlf});
    const parsed = parseDataFile(rawBytes);
    if (parsed.records.length !== records.length) throw new Error('配套文件记录数不一致');
    data.push({fileName, rawBytes, fileType, recordCount: records.length});
  }
  if (profile.includeEmptyR1) supplement('R1', []);
  if (profile.aml) { supplement('X1', amlRecords(openings, 'X1')); supplement('X3', amlRecords(openings, 'X3')); }
  const indexes = [];
  for (const [kind, types] of [['OFI', ['01', '03', 'R1']], ...(profile.aml ? [['OFX', ['X1', 'X3']]] : [])]) {
    const members = types.flatMap(type => data.filter(f => f.fileType === type).map(f => f.fileName));
    let rawBytes = buildIndexFile({...wire, fileNames: members});
    if (profile.trailingCrlf) rawBytes = Buffer.concat([rawBytes, Buffer.from('\r\n')]);
    const parsed = parseIndexFile(rawBytes);
    if (parsed.fileNames.some(n => !data.some(f => f.fileName === n))) throw new Error('交付索引引用了缺失文件');
    indexes.push({fileName: `${kind}_${wire.creator}_${wire.receiver}_${wire.date}${profile.indexSuffixes[kind]}.TXT`, rawBytes, fileType: kind, recordCount: members.length});
  }
  const members = [...indexes, ...data];
  const directory = profile.directoryLayout === 'flat' ? '' : profile.directoryLayout === 'date' ? `${wire.date}/` : `${wire.creator}/${wire.date}/`;
  const zipped = members.map(f => ({...f, fileName: directory + f.fileName}));
  const rawBytes = zipProtocolFiles(zipped);
  return {fileName: `${wire.date}.zip`, rawBytes, profile, fileNames: zipped.map(f => f.fileName),
    manifest: members.map(f => ({fileName: directory + f.fileName, fileType: f.fileType, recordCount: f.recordCount,
      sha256: crypto.createHash('sha256').update(f.rawBytes).digest('hex')}))};
}

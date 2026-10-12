// Empty 43/OFG envelopes follow the accepted channel sample, whose short headers
// differ from the ordinary V2.2 files. Nonempty contract applications are unsupported.
const fields = [
  'FUNDCODE', 'TAACCOUNTID', 'TRANSACTIONACCOUNTID', 'BUSINESSCODE', 'CONTRACTTYPE',
  'SERIALNO', 'VERSION', 'SIGNTYPE', 'DISTRIBUTORCODE', 'INVESTORNAME',
  'INDIVIDUALORINSTITUTION', 'CERTIFICATETYPE', 'CERTIFICATENO', 'TRANSACTIONDATE',
  'TRANSACTIONTIME', 'ACCEPTMETHOD', 'ACCEPTPLACE', 'NETNO', 'NOTES', 'SIGNRISKNOTICE',
  'RISKMATCHING', 'CLIENTRISKRATE', 'ALTERNATIONDATE', 'CARDNO', 'TELNO', 'MOBILETELNO',
  'EMAILADDRESS', 'POSTCODE', 'ADDRESS', 'RESERVEDFIELD1', 'RESERVEDFIELD2',
  'RESERVEDFIELD3', 'RESERVEDFIELD4', 'RESERVEDFIELD5',
];
const text = (value, width) => {
  if (!/^[A-Za-z0-9]*$/.test(value) || value.length > width) throw new Error('合同配套文件头格式无效');
  return value.padEnd(width, ' ');
};
const encode = lines => Buffer.from(lines.join('\r\n') + '\r\n', 'ascii');

export function buildEmptyContractCompanions({creator, receiver, date, version}, profile) {
  if (version !== '22') throw new Error('当前协议版本不支持合同配套文件');
  const header = [text(version, 4), text(creator, 9), text(receiver, 9), text(date, 8)];
  const fileName = `OFD_${creator}_${receiver}_${date}_43${profile.dataSequence ? '_001' : ''}.TXT`;
  const rawBytes = encode(['OFDCFDAT', ...header, '001', '43', text(creator, 8),
    text(receiver, 8), String(fields.length).padStart(3, '0'), ...fields, '00000000', 'OFDCFEND']);
  const indexName = `OFG_${creator}_${receiver}_${date}${profile.indexSuffixes.OFG}.TXT`;
  return {
    data: {fileName, rawBytes, fileType: '43', recordCount: 0},
    index: {fileName: indexName, rawBytes: encode(['OFDCFIDX', ...header, '001', fileName, 'OFDCFEND']),
      fileType: 'OFG', recordCount: 1},
  };
}

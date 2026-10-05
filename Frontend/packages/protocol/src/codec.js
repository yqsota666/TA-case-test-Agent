import { FILE_DEFINITIONS, LEGACY_FILE_DEFINITIONS } from './definitions.js';
import { V21_FILE_DEFINITIONS } from './v21-definitions.js';
import { indexKindFor } from './exchange-streams.js';
import iconv from 'iconv-lite';

const ENCODING = 'gb18030';
const CRLF = Buffer.from('\r\n', 'ascii');

function bytes(value) {
  return iconv.encode(String(value ?? ''), ENCODING);
}

function assertFits(value, length, name) {
  const b = bytes(value);
  if (b.length > length) throw new Error(`${name} exceeds ${length} bytes: ${b.length}`);
  return b;
}

function scaledDigits(value, scale, name) {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`${name} is not numeric: ${raw}`);
  const negative = raw.startsWith('-');
  const [wholeRaw, originalFraction = ''] = raw.replace('-', '').split('.');
  const extraFraction = originalFraction.slice(scale);
  if (extraFraction && /[1-9]/.test(extraFraction)) throw new Error(`${name} has more than ${scale} decimals`);
  const fractionRaw = originalFraction.slice(0, scale);
  const digits = `${wholeRaw}${fractionRaw.padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0';
  return negative ? `-${digits}` : digits;
}

export function encodeField(field, value) {
  if (value === null || value === undefined || value === '') return Buffer.alloc(field.length, 0x20);
  if (field.type === 'N') {
    const raw = scaledDigits(value, field.scale, field.name);
    const sign = raw.startsWith('-') ? '-' : '';
    const digits = sign ? raw.slice(1) : raw;
    if (digits.length + sign.length > field.length) throw new Error(`${field.name} exceeds ${field.length} digits`);
    return Buffer.from(`${sign}${digits.padStart(field.length - sign.length, '0')}`, 'ascii');
  }
  if (field.type === 'A' && !/^\d+$/.test(String(value))) {
    throw new Error(`${field.name} must contain digits only`);
  }
  const b = assertFits(value, field.length, field.name);
  const out = Buffer.alloc(field.length, 0x20);
  b.copy(out);
  return out;
}

export function decodeField(field, source) {
  const raw = iconv.decode(source, ENCODING).trim();
  if (!raw) return null;
  if (field.type !== 'N') return raw;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0';
  const scale = field.scale || 0;
  const padded = digits.padStart(scale + 1, '0');
  const value = scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}` : padded;
  return negative ? `-${value}` : value;
}

export function encodeRecord(fileType, record) {
  const fields = FILE_DEFINITIONS[fileType];
  if (!fields) throw new Error(`Unsupported file type ${fileType}`);
  return Buffer.concat(fields.map((field) => encodeField(field, record[field.name])));
}

export function decodeRecord(fileType, line) {
  const fields = FILE_DEFINITIONS[fileType];
  return decodeRecordWithFields(fields, line);
}

function decodeRecordWithFields(fields, line) {
  const expected = fields.reduce((sum, field) => sum + field.length, 0);
  if (line.length !== expected) throw new Error(`Record length ${line.length}, expected ${expected}`);
  let offset = 0;
  const result = {};
  for (const field of fields) {
    result[field.name] = decodeField(field, line.subarray(offset, offset + field.length));
    offset += field.length;
  }
  return result;
}

const line = (value, length, numeric = false) => {
  const text = String(value ?? '');
  if (iconv.encode(text, ENCODING).length > length) throw new Error(`Header value exceeds ${length}: ${text}`);
  return iconv.encode(numeric ? text.padStart(length, '0') : text.padEnd(length, ' '), ENCODING);
};

export function dataFileName({ creator, receiver, date, fileType, sequence }) {
  return `OFD_${creator}_${receiver}_${date}_${fileType}${sequence ? `_${String(sequence).padStart(3, '0')}` : ''}.TXT`;
}

export function indexFileName({ creator, receiver, date, fileType, streamId, indexKind }) {
  const prefix = indexKind || indexKindFor({ streamId, fileType });
  return `${prefix}_${creator}_${receiver}_${date}.TXT`;
}

export function buildDataFile({ creator, receiver, date, summaryNo = 1, fileType, sender = 'SYSTEM', recipient = 'SYSTEM', records }) {
  const fields = FILE_DEFINITIONS[fileType];
  if (!fields) throw new Error(`Unsupported file type ${fileType}`);
  const lines = [
    line('OFDCFDAT', 8), line('22', 8), line(creator, 20), line(receiver, 20),
    line(date, 8), line(summaryNo, 8, true), line(fileType, 8), line(sender, 8),
    line(recipient, 8), line(fields.length, 8, true),
    ...fields.map((field) => bytes(field.name)),
    line(records.length, 16, true), ...records.map((record) => encodeRecord(fileType, record)),
    line('OFDCFEND', 8)
  ];
  return Buffer.concat(lines.flatMap((item, i) => i === lines.length - 1 ? [item] : [item, CRLF]));
}

export function buildIndexFile({ creator, receiver, date, fileNames }) {
  const lines = [
    line('OFDCFIDX', 8), line('22', 8), line(creator, 20), line(receiver, 20),
    line(date, 8), line(fileNames.length, 8, true), ...fileNames.map(bytes), line('OFDCFEND', 8)
  ];
  return Buffer.concat(lines.flatMap((item, i) => i === lines.length - 1 ? [item] : [item, CRLF]));
}

function splitCrlf(buffer) {
  const result = [];
  let start = 0;
  for (let i = 0; i < buffer.length - 1; i += 1) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) {
      result.push(buffer.subarray(start, i));
      start = i + 2;
      i += 1;
    }
  }
  result.push(buffer.subarray(start));
  // Many production TA systems terminate the footer with CRLF.  Files built by
  // this demo historically did not, so accept either representation without
  // treating the final line terminator as an extra empty record.
  if (result.length > 1 && result.at(-1).length === 0) result.pop();
  return result;
}

export function parseDataFile(buffer) {
  const lines = splitCrlf(buffer);
  if (lines.length < 13 || lines[0].toString('ascii') !== 'OFDCFDAT') throw new Error('Invalid data file header');
  if (lines.at(-1).toString('ascii') !== 'OFDCFEND') throw new Error('Invalid data file footer');
  const fileType = iconv.decode(lines[6], ENCODING).trim();
  const currentFields = FILE_DEFINITIONS[fileType];
  const version = lines[1].toString('ascii').trim();
  const v21Fields = version === '21' ? V21_FILE_DEFINITIONS[fileType] : null;
  if (!currentFields && !v21Fields) throw new Error(`Unsupported file type ${fileType} for protocol ${version}`);
  const fieldCount = Number(lines[9].toString('ascii'));
  const names = lines.slice(10, 10 + fieldCount).map((v) => iconv.decode(v, ENCODING));
  const legacyFields = LEGACY_FILE_DEFINITIONS[fileType];
  const legacy01Fields = fileType === '01' ? legacyFields.filter((field) => field.name !== 'TAAccountID') : null;
  const candidates = [v21Fields, currentFields, legacyFields, legacy01Fields].filter(Boolean);
  const fields = candidates.find((candidate) => candidate.length === fieldCount);
  if (!fields) throw new Error(`Field count ${fieldCount}, expected one of ${candidates.map((candidate) => candidate.length).join(', ')}`);
  const expectedNames = fields.map((v) => v.name);
  if (names.some((name, i) => name.trim().toUpperCase() !== expectedNames[i].trim().toUpperCase())) {
    throw new Error('Field names or order do not match protocol profile');
  }
  const countIndex = 10 + fieldCount;
  const recordCount = Number(lines[countIndex].toString('ascii'));
  const recordLines = lines.slice(countIndex + 1, -1);
  if (recordCount !== recordLines.length) throw new Error(`Record count ${recordCount}, actual ${recordLines.length}`);
  return {
    fileType,
    version, creator: iconv.decode(lines[2], ENCODING).trim(),
    receiver: iconv.decode(lines[3], ENCODING).trim(), date: lines[4].toString('ascii'),
    summaryNo: Number(lines[5].toString('ascii')),
    sender: iconv.decode(lines[7], ENCODING).trim(), recipient: iconv.decode(lines[8], ENCODING).trim(),
    fields, records: recordLines.map((v) => decodeRecordWithFields(fields, v))
  };
}

export function parseIndexFile(buffer) {
  const lines = splitCrlf(buffer);
  if (lines[0].toString('ascii') !== 'OFDCFIDX' || lines.at(-1).toString('ascii') !== 'OFDCFEND') {
    throw new Error('Invalid index file');
  }
  const fileCount = Number(lines[5].toString('ascii'));
  const fileNames = lines.slice(6, -1).map((v) => iconv.decode(v, ENCODING));
  if (fileCount !== fileNames.length) throw new Error(`Index file count ${fileCount}, actual ${fileNames.length}`);
  return {
    version: lines[1].toString('ascii').trim(),
    creator: iconv.decode(lines[2], ENCODING).trim(), receiver: iconv.decode(lines[3], ENCODING).trim(),
    date: lines[4].toString('ascii'), fileNames
  };
}

export function inspectDataFile(buffer) {
  const parsed = parseDataFile(buffer);
  const lines = splitCrlf(buffer);
  const fields = parsed.fields;
  const countIndex = 10 + fields.length;
  let offset = 1;
  const positionedFields = fields.map((field) => {
    const item = { ...field, start: offset, end: offset + field.length - 1 };
    offset += field.length;
    return item;
  });
  return {
    kind: 'data',
    rawText: iconv.decode(buffer, ENCODING),
    header: {
      marker: lines[0].toString('ascii'), version: parsed.version, creator: parsed.creator,
      receiver: parsed.receiver, date: parsed.date, summaryNo: parsed.summaryNo,
      fileType: parsed.fileType, sender: iconv.decode(lines[7], ENCODING).trim(),
      recipient: iconv.decode(lines[8], ENCODING).trim(), fieldCount: fields.length
    },
    fields: positionedFields,
    recordCount: parsed.records.length,
    records: parsed.records.map((values, index) => ({
      index: index + 1,
      raw: iconv.decode(lines[countIndex + 1 + index], ENCODING),
      values
    })),
    footer: lines.at(-1).toString('ascii')
  };
}

export function inspectIndexFile(buffer) {
  const parsed = parseIndexFile(buffer);
  return {
    kind: 'index',
    rawText: iconv.decode(buffer, ENCODING),
    header: { marker: 'OFDCFIDX', version: parsed.version, creator: parsed.creator, receiver: parsed.receiver, date: parsed.date },
    fileCount: parsed.fileNames.length,
    fileNames: parsed.fileNames,
    footer: 'OFDCFEND'
  };
}

export function normalizeExchangeFile(buffer) {
  const marker = buffer.subarray(0, 8).toString('ascii');
  if (marker === 'OFDCFDAT') {
    const parsed = parseDataFile(buffer);
    const isCurrent = parsed.version === '22' && parsed.fields.length === FILE_DEFINITIONS[parsed.fileType].length;
    if (isCurrent) return buffer;
    return buildDataFile({
      creator: parsed.creator,
      receiver: parsed.receiver,
      date: parsed.date,
      summaryNo: parsed.summaryNo,
      fileType: parsed.fileType,
      sender: parsed.sender,
      recipient: parsed.recipient,
      records: parsed.records
    });
  }
  if (marker === 'OFDCFIDX') {
    const parsed = parseIndexFile(buffer);
    if (parsed.version === '22') return buffer;
    return buildIndexFile(parsed);
  }
  throw new Error(`Unsupported exchange file marker ${marker}`);
}

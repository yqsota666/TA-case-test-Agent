import crypto from 'node:crypto';
import iconv from 'iconv-lite';
import { parseDataFile, parseIndexFile, indexFileName } from './codec.js';

export const MAX_RETURN_BYTES = 8 * 1024 * 1024;
export const returnParsingError = (code, message, status = 400) =>
  Object.assign(new Error(message), { code, status });
const fail = (code, message) => { throw returnParsingError(code, message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

export function parseReturnFiles(files, { expectedType, channel, allowMixed = false }) {
  if (!['02', '04', '05'].includes(expectedType) && !(allowMixed && expectedType === 'MIXED')) fail('UNSUPPORTED_RETURN_TYPE', '仅支持分别解析 02、04 和 05');
  if (!Array.isArray(files) || files.length < 1 || files.length > 17) {
    fail('INVALID_RETURN_PACKAGE', '请上传回传 TXT 文件，可同时附带原始 OFI 索引；最多 17 份');
  }
  let size = 0;
  const names = new Set();
  const rawFiles = files.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file) ||
        Object.keys(file).length !== 2 || typeof file.fileName !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,120}$/.test(file.fileName) || names.has(file.fileName) ||
        typeof file.base64 !== 'string' || !file.base64.length || file.base64.length % 4) {
      fail('INVALID_RETURN_PACKAGE', '文件名、Base64 内容无效或文件名重复');
    }
    names.add(file.fileName);
    size += Math.floor(file.base64.length / 4) * 3 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0);
    if (size > MAX_RETURN_BYTES) throw returnParsingError('REQUEST_TOO_LARGE', '文件总大小不能超过 8 MiB', 413);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) fail('INVALID_RETURN_PACKAGE', 'Base64 内容无效');
    const rawBytes = Buffer.from(file.base64, 'base64');
    if (rawBytes.toString('base64') !== file.base64) fail('INVALID_RETURN_PACKAGE', 'Base64 内容不是标准编码');
    if (!iconv.encode(iconv.decode(rawBytes, 'gb18030'), 'gb18030').equals(rawBytes)) {
      fail('INVALID_RETURN_ENCODING', `${file.fileName} 含有无法完整解码的 GB18030 字节`);
    }
    return { fileName: file.fileName, rawBytes, sha256: hash(rawBytes) };
  });
  const indexes = rawFiles.filter(file => file.fileName.startsWith('OFI_'));
  if (indexes.length > 1) fail('RETURN_INDEX_MISMATCH', '一次只能上传一份 OFI 索引');
  const dataFiles = rawFiles.filter(file => !indexes.includes(file));
  if (!dataFiles.length) fail('RETURN_DATA_REQUIRED', '请同时上传数据文件，不能只上传索引');
  let recordCount = 0;
  const data = dataFiles.map(file => {
    let parsed;
    try { parsed = parseDataFile(file.rawBytes); }
    catch { fail('INVALID_RETURN_FILE', `${file.fileName} 的文件头、字段、字节长度、数字或记录数无效`); }
    if (!['02','04','05'].includes(parsed.fileType)) fail('UNSUPPORTED_RETURN_TYPE', '统一回传仅支持02、04、05');
    if (!allowMixed && parsed.fileType !== expectedType) fail('RETURN_TYPE_MISMATCH', `此入口等待 ${expectedType}，上传内容是 ${parsed.fileType}`);
    if (!validDate(parsed.date)) fail('INVALID_RETURN_DATE', `${file.fileName} 的文件日期无效`);
    const prefix = `OFD_${parsed.creator}_${parsed.receiver}_${parsed.date}_${parsed.fileType}`;
    if (!file.fileName.startsWith(prefix) || !/^(?:_\d{3})?\.TXT$/.test(file.fileName.slice(prefix.length))) {
      fail('RETURN_NAME_MISMATCH', '数据文件名与文件头的机构、日期或类型不一致');
    }
    if (parsed.creator !== channel.taCode || parsed.receiver !== channel.distributorCode ||
        parsed.version !== channel.protocolVersion) {
      fail('FILE_CHANNEL_MISMATCH', '回传机构或协议版本与生成申请使用的通道不一致');
    }
    recordCount += parsed.records.length;
    if (recordCount > 2000) fail('RETURN_RECORD_LIMIT', '一次最多解析 2000 条记录，请按 TA 原始分片分次上传');
    return { fileName: file.fileName, sha256: file.sha256, ...parsed };
  });
  if (data.some(file => ['creator', 'receiver', 'date', 'version'].some(key => file[key] !== data[0][key]))) {
    fail('RETURN_PACKAGE_MISMATCH', '一次上传的数据文件须属于同一机构、日期和协议版本');
  }
  let index = null;
  if (indexes.length) {
    let parsed;
    try { parsed = parseIndexFile(indexes[0].rawBytes); }
    catch { fail('INVALID_RETURN_INDEX', 'OFI 索引结构或声明数量无效'); }
    if (indexes[0].fileName !== indexFileName({ ...parsed, indexKind: 'OFI' }) ||
        new Set(parsed.fileNames).size !== parsed.fileNames.length ||
        parsed.fileNames.length !== data.length || data.some(file => !parsed.fileNames.includes(file.fileName)) ||
        ['creator', 'receiver', 'date', 'version'].some(key => parsed[key] !== data[0][key])) {
      fail('RETURN_INDEX_MISMATCH', 'OFI 索引与上传的完整文件清单、机构、日期或版本不一致');
    }
    index = { fileName: indexes[0].fileName, sha256: indexes[0].sha256, ...parsed };
  }
  const sha256 = hash(Buffer.from(JSON.stringify(rawFiles.map(file => [file.fileName, file.sha256])
    .sort((a, b) => a[0].localeCompare(b[0])))));
  const selected = expectedType === 'MIXED' ? data : data.filter(file => file.fileType === expectedType);
  if (!selected.length) fail('RETURN_TYPE_MISMATCH', `上传批次没有${expectedType}文件`);
  return { rawFiles, result: { expectedType, sha256, index, files: selected,
    ...(allowMixed ? { mixedPackage: true, packageFiles: data.map(file => ({fileName:file.fileName,fileType:file.fileType,sha256:file.sha256})) } : {}),
    recordCount: selected.reduce((sum, file) => sum + file.records.length, 0),
    indexChecked: Boolean(index), businessApplied: false, applicationsMatched: false } };
}

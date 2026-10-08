import crypto from 'node:crypto';
import {buildIndexFile,indexFileName,parseDataFile,parseIndexFile} from './codec.js';

const crcTable=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}

export function zipProtocolFiles(files) {
  if(!files.length || files.length>1000)throw new Error('申请包文件数量无效');
  const names=new Set(),locals=[],central=[];let offset=0;
  for(const file of files){
    if(!/^[A-Za-z0-9_.-]{1,120}$/.test(file.fileName)||names.has(file.fileName)||!Buffer.isBuffer(file.rawBytes))throw new Error('申请包文件名或原件无效');
    names.add(file.fileName);
    const name=Buffer.from(file.fileName),data=file.rawBytes,crc=crc32(data);
    if(offset+data.length>64*1024*1024)throw new Error('申请包超过大小限制');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x21,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    locals.push(local,name,data);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x21,14);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,name);offset+=30+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}

export function buildApplicationPackage(files) {
  if(!files.length)throw new Error('尚未生成完整申请文件');
  const ordered=files.map(file=>({...file,parsed:parseDataFile(file.rawBytes)})).sort((a,b)=>a.parsed.fileType.localeCompare(b.parsed.fileType)||a.fileName.localeCompare(b.fileName));
  const first=ordered[0].parsed;
  for(const file of ordered){
    if(!['01','03'].includes(file.parsed.fileType)||['creator','receiver','date','version'].some(k=>file.parsed[k]!==first[k]))throw new Error('不同机构、业务日期或版本的申请不能放入同一索引');
    const prefix=`OFD_${first.creator}_${first.receiver}_${first.date}_${file.parsed.fileType}`;
    if(!new RegExp(`^${prefix}(?:_[0-9]{3,4})?\\.TXT$`).test(file.fileName))throw new Error('申请文件名与文件头不一致');
    if(file.sha256 && crypto.createHash('sha256').update(file.rawBytes).digest('hex')!==file.sha256)throw new Error('申请原件校验失败');
  }
  const index={fileName:indexFileName({...first,indexKind:'OFI'}),rawBytes:buildIndexFile({...first,fileNames:ordered.map(f=>f.fileName)})};
  const checked=parseIndexFile(index.rawBytes);
  if(checked.fileNames.join(',')!==ordered.map(f=>f.fileName).join(','))throw new Error('申请索引清单不一致');
  return {fileName:`${first.creator}_${first.receiver}_${first.date}_applications.zip`,rawBytes:zipProtocolFiles([index,...ordered]),fileNames:[index.fileName,...ordered.map(f=>f.fileName)]};
}

import React from 'react';
import {X} from 'lucide-react';
import './message-images.css';

export async function readMessageImages(files,existing=[]) {
  const items=Array.from(files);
  if(existing.length+items.length>4)throw new Error('每条消息最多添加 4 张图片');
  if(items.some(file=>!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)))throw new Error('支持 PNG、JPEG、WebP、GIF 图片');
  if(items.some(file=>file.size>2*1024*1024))throw new Error('每张图片不能超过 2 MB');
  const oldSize=existing.reduce((sum,image)=>sum+Math.floor(image.dataUrl.split(',')[1].length*3/4),0);
  if(oldSize+items.reduce((sum,file)=>sum+file.size,0)>4*1024*1024)throw new Error('图片总大小不能超过 4 MB');
  return Promise.all(items.map(file=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({name:file.name||'图片.png',dataUrl:reader.result});
    reader.onerror=()=>reject(new Error('图片读取失败，请重新添加'));
    reader.readAsDataURL(file);
  })));
}

export function MessageImages({images=[],onRemove,onOpen,disabled=false}) {
  if(!images.length)return null;
  return <div className={`cw-message-images${onRemove?' is-draft':''}`} aria-label={onRemove?'待发送图片':'消息中的图片'}>
    {images.map((image,index)=><div className="cw-image-item" key={`${index}-${image.name}`}>
      <button type="button" className="cw-image-preview" onClick={()=>onOpen(image)} aria-label={`查看图片：${image.name}`}><img src={image.dataUrl} alt={image.name}/></button>
      {onRemove&&<button type="button" className="cw-image-remove" onClick={()=>onRemove(index)} aria-label={`移除图片：${image.name}`} disabled={disabled}><X size={13}/></button>}
    </div>)}
  </div>;
}

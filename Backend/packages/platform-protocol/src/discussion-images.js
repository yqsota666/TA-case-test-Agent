export const IMAGE_ONLY_INPUT='请解析图片内容。';
export const IMAGE_BYTES=2*1024*1024;
export const TOTAL_IMAGE_BYTES=4*1024*1024;

const invalid=message=>Object.assign(new Error(message),{code:'INVALID_DISCUSSION_IMAGES',status:400});
export function validateDiscussionImages(images=[]) {
  if(!Array.isArray(images)||images.length>4)throw invalid('每条消息最多添加 4 张图片');
  let total=0;
  return images.map(image=>{
    if(!image||typeof image!=='object'||Array.isArray(image)||Object.keys(image).some(key=>!['name','dataUrl'].includes(key))||typeof image.name!=='string'||!image.name.trim()||image.name.length>180||typeof image.dataUrl!=='string')throw invalid('图片格式有误，请重新添加');
    const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if(!match||match[2].length>Math.ceil(IMAGE_BYTES/3)*4)throw invalid('支持 PNG、JPEG、WebP、GIF，每张不超过 2 MB');
    const bytes=Buffer.from(match[2],'base64');
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))?'image/gif':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
    total+=bytes.length;
    if(bytes.length>IMAGE_BYTES||total>TOTAL_IMAGE_BYTES)throw invalid('图片总大小不能超过 4 MB');
    if(!mime||mime!==match[1]||bytes.toString('base64')!==match[2])throw invalid('图片内容与格式不符，请重新添加');
    return {name:image.name.trim(),dataUrl:image.dataUrl};
  });
}

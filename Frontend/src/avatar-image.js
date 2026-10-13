export async function avatarImage(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPG 或 WebP 图片');
  if(file.size>5*1024*1024)throw new Error('图片不能超过 5 MB');
  const image=await createImageBitmap(file).catch(()=>{throw new Error('无法读取图片，请换一张图片');});
  try {
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;
    const context=canvas.getContext('2d');
    const side=Math.min(image.width,image.height);
    context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,240,240);
    return canvas.toDataURL('image/png');
  } finally {image.close();}
}

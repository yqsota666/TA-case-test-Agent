export function editableDeliveryProfile(profile){return {...profile,summaryNo:profile.summaryNo??1,indexSuffixes:{...profile.indexSuffixes}};}
export function deliveryFormatSummary(profile){
 if(!profile)return '尚未配置';
 const application=['01','03',...(profile.includeEmptyR1?['R1']:[])].join('/');
 return `${application}${profile.aml?' + OFX/X1/X3':''} · ${profile.dataSequence?'带序号':'无序号'}`;
}
export function deliveryFilePreview(value,profile){
 if(!profile||!value.distributor_code||!value.ta_code)return [];
 const date='{业务日期}',base=`${value.distributor_code}_${value.ta_code}_${date}`;
 const directory=profile.directoryLayout==='flat'?'':profile.directoryLayout==='date'?date+'/':value.distributor_code+'/'+date+'/';
 return [['OFI',`OFI_${base}${profile.indexSuffixes.OFI}.TXT`],...(profile.aml?[['OFX',`OFX_${base}${profile.indexSuffixes.OFX}.TXT`]]:[]),
 ...['01','03',...(profile.includeEmptyR1?['R1']:[]),...(profile.aml?['X1','X3']:[])].map(type=>[type,`OFD_${base}_${type}${profile.dataSequence?'_001':''}.TXT`])].map(([type,fileName])=>({type,fileName:directory+fileName}));
}

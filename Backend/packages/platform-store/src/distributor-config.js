import {authenticateSession,storeError} from './index.js';
import {channelDeliveryProfile} from './delivery-profile.js';
import {canonicalProtocolVersion} from '../../platform-protocol/src/profiles.js';
import {normalizeDeliveryProfile} from '../../platform-protocol/src/delivery-package.js';

const keys=['channel_name','distributor_code','ta_code','protocol_version','ta_environment'];
export function distributorInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>![...keys,'delivery_profile'].includes(key))||keys.some(key=>typeof input[key]!=='string'))
    throw storeError('INVALID_DISTRIBUTOR',400,'请填写完整的销售商配置');
  const value=Object.fromEntries(keys.map(key=>[key,input[key].trim()]));
  try{value.protocol_version=canonicalProtocolVersion(value.protocol_version);}catch{throw storeError('INVALID_DISTRIBUTOR',400,'文件格式版本不支持，请选择 2.1 或 2.2');}
  if(!value.channel_name||value.channel_name.length>120||!value.ta_environment||value.ta_environment.length>80||
    /[\u0000-\u001f\u007f]/.test(value.channel_name+value.ta_environment)||
    !/^[0-9A-Za-z]{1,9}$/.test(value.distributor_code)||!/^[0-9A-Za-z]{1,9}$/.test(value.ta_code)||!['21','22'].includes(value.protocol_version))
    throw storeError('INVALID_DISTRIBUTOR',400,'名称或环境无效；销售商和 TA 代码须为 1–9 位字母或数字，协议版本为 21 或 22');
  return value;
}

export function createDistributorConfig({transaction}){
  return {async deliveryDefaults(token,input){
    const value=distributorInput({channel_name:'默认格式',ta_environment:'LOCAL',distributor_code:input.distributorCode,ta_code:input.taCode,protocol_version:input.protocolVersion});
    return transaction(async db=>{await authenticateSession(db,token);return {profile:channelDeliveryProfile(value)};});
  },async saveDistributor(token,{id,input}){
    const value=distributorInput(input);
    let profile;
    if(Object.hasOwn(input,'delivery_profile')){
      try{profile=normalizeDeliveryProfile(input.delivery_profile,value.protocol_version);}
      catch(error){throw storeError('INVALID_DELIVERY_PROFILE',422,error.message);}
    }
    if(id!==undefined&&!/^[1-9]\d{0,18}$/.test(String(id)))throw storeError('INVALID_ID',400,'销售商标识无效');
    return transaction(async db=>{
      const auth=await authenticateSession(db,token);
      let channelId=id;
      try{
        if(id!==undefined){
          const [[current]]=await db.execute('SELECT channel_name,distributor_code,ta_code,protocol_version,ta_environment FROM exchange_channels WHERE workspace_id=? AND id=? FOR UPDATE',[auth.workspace_id,id]);
          if(!current)throw storeError('CHANNEL_NOT_FOUND',404,'销售商不存在');
          if(keys.filter(key=>key!=='channel_name').some(key=>current[key]!==value[key]))
            throw storeError('CHANNEL_IDENTITY_IMMUTABLE',409,'代码、TA、协议和环境保存后固定，请新增配置');
          await db.execute('UPDATE exchange_channels SET channel_name=? WHERE workspace_id=? AND id=?',[value.channel_name,auth.workspace_id,id]);
        }else{
          const [result]=await db.execute('INSERT INTO exchange_channels(workspace_id,channel_name,distributor_code,ta_code,protocol_version,ta_environment) VALUES (?,?,?,?,?,?)',[auth.workspace_id,...keys.map(key=>value[key])]);
          channelId=String(result.insertId);
          profile??=channelDeliveryProfile(value);
        }
        if(profile)await db.execute(`INSERT INTO exchange_delivery_profiles(workspace_id,channel_id,profile_json)
          VALUES (?,?,?) ON DUPLICATE KEY UPDATE profile_json=VALUES(profile_json)`,[auth.workspace_id,channelId,JSON.stringify(profile)]);
      }catch(error){
        if(error.code==='ER_DUP_ENTRY')throw storeError('DISTRIBUTOR_EXISTS',409,'该环境下的销售商与 TA 组合已存在');
        throw error;
      }
      return {id:String(channelId),...value,...(profile?{delivery_profile:profile}:{})};
    });
  }};
}

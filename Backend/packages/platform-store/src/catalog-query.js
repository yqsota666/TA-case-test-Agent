import {storeError} from './index.js';
import {FILE_DEFINITIONS} from '../../platform-protocol/src/definitions.js';
import {V21_OUTBOUND_DEFINITIONS} from '../../platform-protocol/src/v21-outbound-definitions.js';
import {protocolColumnLabels} from './protocol-column-labels.js';

const fail = message => {throw storeError('INVALID_CATALOG_QUERY',400,message);};
const operators = {
  text: ['contains','eq','ne','startsWith','notContains','in','notIn','empty','notEmpty'],
  enum: ['eq','ne','in','notIn','empty','notEmpty'],
  decimal: ['eq','ne','gt','gte','lt','lte','between','empty','notEmpty'],
  date: ['eq','ne','gt','gte','lt','lte','between','empty','notEmpty'],
  datetime: ['eq','ne','gt','gte','lt','lte','between','empty','notEmpty'],
};
const labels = {name:'客户名称',customer_name:'客户名称',investor_type:'客户类型',simulated_balance:'模拟余额',account_no:'交易账号',ta_account_id:'TA账号',branch_code:'网点代码',certificate_type:'证件类型',certificate_no:'证件号码',fund_code:'基金代码',fund_name:'基金名称',share_class:'份额类别',nav:'单位净值',total_volume:'总份额',available_volume:'可用份额',frozen_volume:'冻结份额',snapshot_date:'余额日期',business_date:'业务日期',file_type:'文件类型',business_code:'业务代码',app_no:'申请编号',status:'申请状态',created_at:'生成时间',project:'项目',caseTitle:'Case',chatId:'项目标识',caseId:'Case标识',channel_name:'销售商',distributor_code:'销售商代码',ta_code:'TA代码',protocol_version:'文件格式',ta_environment:'环境'};
const aliases = {name:'InvestorName',customer_name:'InvestorName',investor_type:'IndividualOrInstitution',account_no:'TransactionAccountID',ta_account_id:'TAAccountID',branch_code:'BranchCode',certificate_type:'CertificateType',certificate_no:'CertificateNo',app_no:'AppSheetSerialNo',business_code:'BusinessCode',business_date:'TransactionDate'};
const enumValues = {investor_type:[['1','个人'],['0','机构']],IndividualOrInstitution:[['1','个人'],['0','机构']],status:[['READY','待生成'],['BATCHED','已合批'],['GENERATED','已生成'],['DELIVERED','已发送'],['WAITING_RETURN','等待回传'],['CONFIRMED','已确认'],['FAILED','失败'],['CANCELED','已取消']],protocol_version:[['21','TA 2.1'],['22','TA 2.2']],direction:[['OUTBOUND','申请文件'],['INBOUND','TA回传']]};
const decimals = new Set(['simulated_balance','nav','total_volume','available_volume','frozen_volume','byteLength','recordCount']);
const jsonText = key => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(v.record_json,'$.${key}')),'null')`;
function field(key,label,type='text',sql=`v.\`${key}\``) {
  return {key,label,type,sql,operators:operators[type],...(enumValues[key]?{options:enumValues[key].map(([value,label])=>({value,label}))}:{})};
}
export function dataQueryFields(table,projected) {
  const hasRecord = projected.has('record_json');
  const fields = [...projected].filter(key=>labels[key]||key==='batchId').map(key=>{
    const type = decimals.has(key)?'decimal':key.endsWith('_date')?'date':key==='created_at'?'datetime':enumValues[key]?'enum':'text';
    // Relational business dates remain authoritative; other aliases match the displayed protocol value.
    const sql = hasRecord && aliases[key] && type!=='date' ? `COALESCE(NULLIF(${jsonText(aliases[key])},''),v.\`${key}\`)` : `v.\`${key}\``;
    return field(key,labels[key]||'关联批次',type,sql);
  });
  if(hasRecord) {
    const types = table==='applications'?['01','03']:['01'];
    const protocol = new Map(types.flatMap(type=>[...(FILE_DEFINITIONS[type]||[]),...(V21_OUTBOUND_DEFINITIONS[type]||[])]).map(def=>[def.name,def]));
    const represented = new Set(fields.map(f=>aliases[f.key]).filter(Boolean));
    for(const [key,def] of protocol) {
      if(represented.has(key))continue;
      const type=def.type==='N'?'decimal':(/Date$|Birthday$/.test(key)&&def.length===8)?'date':enumValues[key]?'enum':'text';
      fields.push(field(key,({DistributorCode:'销售商代码',TransactionAccountID:'交易账号'}[key])||protocolColumnLabels[key]||key,type,jsonText(key)));
    }
  }
  return fields;
}
export const fileQueryFields = () => [
  ['fileName','文件名'],['fileType','文件类型'],['direction','方向','enum'],['project','项目'],['caseTitle','Case'],['channelName','销售商'],['distributorCode','销售商代码'],['taCode','TA代码'],['businessDate','业务日期','date'],['createdAt','生成／接收时间','datetime'],['byteLength','文件大小（字节）','decimal'],['recordCount','记录条数','decimal'],['chatId','项目标识'],['caseId','Case标识'],['batchId','关联批次'],
].map(args=>field(...args)).map(f=>f.key==='caseId'?{...f,sql:'v.caseIds',collection:true,operators:['eq','ne','in','notIn','empty','notEmpty']}:f.key==='caseTitle'?{...f,sql:'v.caseTitles',collection:true,textCollection:true}:f);
export function publicQueryFields(fields) {return fields.map(({sql,...value})=>value);}
export function extraCatalogOptions(input) {
  if(input.timezoneOffset!==undefined&&input.timezoneOffset!==null&&(!Number.isInteger(Number(input.timezoneOffset))||Math.abs(Number(input.timezoneOffset))>840))fail('查询时区无效');
  if(input.timeZone!==undefined&&input.timeZone!==null){try{if(typeof input.timeZone!=='string'||input.timeZone.length>80)throw new Error();new Intl.DateTimeFormat('en',{timeZone:input.timeZone});}catch{fail('查询时区无效');}}
  return Object.fromEntries(['filters','sort','optionsField','timezoneOffset','timeZone'].filter(key=>input[key]!==undefined&&input[key]!==null).map(key=>[key,input[key]]));
}
export async function catalogSuggestions(db,query,values,fields,key) {
  const f=fields.find(f=>f.key===key&&(!f.collection||f.textCollection)&&['text','enum'].includes(f.type));
  if(!f)fail('不支持该字段的候选查询');
  const source=f.textCollection?`${queryTable(f.sql)}`:'';
  const expr=f.textCollection?'labels.item':f.sql;
  const [rows]=await db.execute(`SELECT ${expr} AS value,COUNT(*) AS count FROM (${query}) v ${source} WHERE ${expr} IS NOT NULL AND ${expr}<>'' GROUP BY ${expr} ORDER BY count DESC,value LIMIT 50`,values);
  return {options:rows.map(row=>({value:String(row.value),count:Number(row.count)}))};
}
export function readQueryJson(value,fallback) {
  if(value===undefined || value===null || value==='')return fallback;
  if(typeof value!=='string')return value;
  if(value.length>12000)fail('查询条件过长，请减少条件');
  try{return JSON.parse(value);}catch{fail('查询条件格式无效');}
}
function scalar(value,field) {
  if(typeof value!=='string' && typeof value!=='number')fail(`${field.label}的值无效`);
  const text=String(value).trim();
  if(!text || text.length>200)fail(`${field.label}的值为空或过长`);
  if(field.type==='decimal') {
    if(typeof value==='number' && !Number.isSafeInteger(value))fail('小数查询值请使用字符串');
    if(!/^-?\d{1,20}(\.\d{1,8})?$/.test(text))fail(`${field.label}需要有效数字，最多8位小数`);
  } else if(field.type==='date'||field.type==='datetime') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||text<'1000-01-01'||text>'9998-12-31'||!Number.isFinite(Date.parse(text+'T00:00:00Z'))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)fail(`${field.label}需要1000至9998年间的有效日期`);
  }
  if(field.options && !field.options.some(option=>option.value===text))fail(`${field.label}的选项无效`);
  return text;
}
const escapeLike = text => text.replace(/[\\%_]/g,'\\$&');
function expression(field) {
  if(field.type==='decimal')return `CAST(${field.sql.includes('JSON_EXTRACT')?`NULLIF(${field.sql},'')`:field.sql} AS DECIMAL(28,8))`;
  if(field.type==='date')return field.sql.includes('JSON_EXTRACT')?`STR_TO_DATE(${field.sql},'%Y%m%d')`:field.sql;
  return field.sql;
}
export function compileCatalogQuery(input,fields,{defaultOrder='v._rowKey',quickFields=fields.filter(f=>f.type==='text'||f.type==='enum')}={}) {
  extraCatalogOptions(input);
  const byKey=new Map(fields.map(f=>[f.key,f]));
  const values=[];let count=0;
  function rule(node,depth=0) {
    if(!node || typeof node!=='object' || Array.isArray(node)||depth>3||++count>40)fail('筛选条件过多或分组过深');
    if(Object.hasOwn(node,'rules')) {
      if(!['and','or'].includes(node.combinator)||!Array.isArray(node.rules)||node.rules.length>30)fail('条件分组无效');
      if(!node.rules.length){if(depth)fail('请填写分组条件或移除空分组');return '1=1';}
      return '('+node.rules.map(child=>rule(child,depth+1)).join(node.combinator==='and'?' AND ':' OR ')+')';
    }
    const f=byKey.get(node.field);
    if(!f||!f.operators.includes(node.operator))fail('筛选字段或运算符不支持');
    const expr=expression(f),op=node.operator;
    if(f.textCollection) {
      if(op==='empty'||op==='notEmpty')return `COALESCE(JSON_LENGTH(${f.sql}),0)${op==='empty'?'=':'>'}0`;
      const list=['in','notIn'].includes(op);
      if(list&&(!Array.isArray(node.value)||!node.value.length||node.value.length>100))fail('多选值无效');
      const vals=(list?node.value:[node.value]).map(value=>scalar(value,f));
      const contains=['contains','notContains','startsWith'].includes(op);
      values.push(...vals.map(value=>contains?(op==='startsWith'?'':'%')+escapeLike(value)+'%':escapeLike(value)));
      return `(${['ne','notContains','notIn'].includes(op)?'NOT ':''}(${vals.map(()=>`JSON_SEARCH(${f.sql},'one',?) IS NOT NULL`).join(' OR ')}))`;
    }
    if(f.collection) {
      if(op==='empty'||op==='notEmpty')return `COALESCE(JSON_LENGTH(${f.sql}),0)${op==='empty'?'=':'>'}0`;
      const list=['in','notIn'].includes(op);
      if(list&&(!Array.isArray(node.value)||!node.value.length||node.value.length>100))fail('多选值无效');
      const vals=(list?node.value:[node.value]).map(v=>scalar(v,f));
      values.push(...vals);
      return `(${['ne','notIn'].includes(op)?'NOT ':''}(${vals.map(()=>`JSON_CONTAINS(${f.sql},JSON_QUOTE(?))`).join(' OR ')}))`;
    }
    if(op==='empty'||op==='notEmpty') {
      if(['decimal','date','datetime'].includes(f.type)&&!f.sql.includes('JSON_EXTRACT'))return `${f.sql} IS ${op==='empty'?'':'NOT '}NULL`;
      return `(${f.sql} IS ${op==='empty'?'':'NOT '}NULL ${op==='empty'?'OR':'AND'} ${f.sql}${op==='empty'?'=':'<>'}'')`;
    }
    const list=['in','notIn','between'].includes(op);
    if(list&&(!Array.isArray(node.value)||!node.value.length||node.value.length>100||(op==='between'&&node.value.length!==2)))fail('多选或区间值无效');
    const val=list?node.value.map(value=>scalar(value,f)):scalar(node.value,f);
    if(op==='between') {
      const compare=f.type==='decimal'?decimalCompare(val[0],val[1]):val[0].localeCompare(val[1]);
      if(compare>0)fail('区间起点不能大于终点');
    }
    if(f.type==='datetime') {
      const boundary = (date,next=false) => dateBoundary(date,next,input);
      if(op==='between'){values.push(boundary(val[0]),boundary(val[1],true));return `(${expr}>=? AND ${expr}<?)`;}
      if(op==='eq'||op==='ne'){values.push(boundary(val),boundary(val,true));return `(${op==='ne'?'NOT ':''}(${expr}>=? AND ${expr}<?))`;}
      values.push(boundary(val,['gt','lte'].includes(op)));
      return `${expr}${{gt:'>=',gte:'>=',lt:'<',lte:'<'}[op]}?`;
    }
    if(['contains','notContains','startsWith'].includes(op)){values.push((op==='startsWith'?'':'%')+escapeLike(val)+'%');return `${expr} ${op==='notContains'?'NOT LIKE':'LIKE'} ?`;}
    if(op==='in'||op==='notIn'){values.push(...val);return `${expr} ${op==='notIn'?'NOT IN':'IN'} (${val.map(()=>'?').join(',')})`;}
    const parameter=f.type==='decimal'?'CAST(? AS DECIMAL(28,8))':'?';
    if(op==='between'){values.push(...val);return `${expr} BETWEEN ${parameter} AND ${parameter}`;}
    values.push(val);return `${expr}${{eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[op]}${parameter}`;
  }
  const clauses=[];
  if(input.q){const pattern='%'+escapeLike(input.q)+'%';clauses.push('('+quickFields.map(f=>{values.push(pattern);return `CAST(${f.sql} AS CHAR) LIKE ?`;}).join(' OR ')+')');}
  const filters=readQueryJson(input.filters,null);
  if(filters)clauses.push(rule(filters));
  const sort=readQueryJson(input.sort,[]);
  if(!Array.isArray(sort)||sort.length>3)fail('排序条件无效');
  const order=sort.map(item=>{const f=byKey.get(item?.field);if(!f||f.collection||!['asc','desc'].includes(item.direction))fail('排序字段无效');return expression(f)+' '+item.direction.toUpperCase();});
  order.push(defaultOrder);
  return {sql:clauses.length?' AND '+clauses.join(' AND '):'',values,order:order.join(',')};
}
function decimalCompare(a,b) {
  const scaled=value=>{const [integer,decimal='']=value.split('.');return BigInt(integer+decimal.padEnd(8,'0'));};
  const x=scaled(a),y=scaled(b);return x<y?-1:x>y?1:0;
}
function queryTable(sql) {return `JOIN JSON_TABLE(CAST(${sql} AS JSON),'$[*]' COLUMNS (item VARCHAR(1000) PATH '$')) AS labels`;}
function dateBoundary(date,next,input) {
  const target=Date.parse(date+'T00:00:00Z')+(next?86400000:0);
  let utc=target+Number(input.timezoneOffset||0)*60000;
  if(input.timeZone) {
    const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:input.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    for(let i=0;i<3;i++) {
      const parts=Object.fromEntries(formatter.formatToParts(new Date(utc)).map(part=>[part.type,part.value]));
      const wall=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      const delta=target-wall;utc+=delta;if(!delta)break;
    }
  }
  return new Date(utc).toISOString().slice(0,19).replace('T',' ');
}

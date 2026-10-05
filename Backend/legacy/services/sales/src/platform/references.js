import { scopeError } from './scope.js';

const definitions = [
  {field:'OriginalAppSheetNo',type:'ORIGINAL_APPLICATION',table:'applications',column:'app_no',target:'referenced_application_id'},
  {field:'OriginalSerialNo',type:'ORIGINAL_CONFIRMATION',table:'confirmations',column:'ta_serial_no',target:'referenced_confirmation_id'},
  {field:'TargetTransactionAccountID',type:'TARGET_TRADING',table:'trading_accounts',column:'transaction_account_no',target:'referenced_trading_account_id'},
  {field:'TargetTAAccountID',type:'TARGET_TA_ACCOUNT',table:'ta_accounts',column:'ta_account_no',target:'referenced_ta_account_id'}
];

export async function resolveProtocolReferences(db,scope,fields) {
  if (fields.TargetDistributorCode && fields.TargetDistributorCode!==scope.distributor_code) {
    throw scopeError('跨机构目标账号尚未在当前执行中登记',409,'UNSCOPED_REFERENCE');
  }
  const keys=[scope.workspace_id,scope.chat_id,scope.run_id],references=[];
  for (const definition of definitions) {
    const value=fields[definition.field];
    if (value==null || value==='') continue;
    if (typeof value!=='string' || value.length>40) throw scopeError('协议引用格式无效',400,'INVALID_INPUT');
    // Table and column names come only from the fixed internal definitions above.
    const [rows]=await db.execute(`SELECT id FROM ${definition.table}
      WHERE workspace_id=? AND chat_id=? AND run_id=? AND ${definition.column}=? LIMIT 2`,[...keys,value]);
    if (rows.length!==1) throw scopeError('协议引用不属于当前 chat 和执行，或无法唯一确定',409,'UNSCOPED_REFERENCE');
    references.push({type:definition.type,target:definition.target,id:rows[0].id});
  }
  return references;
}

export async function persistProtocolReferences(db,scope,applicationId,references) {
  for (const reference of references) {
    const definition=definitions.find(item=>item.type===reference.type);
    if (!definition) throw scopeError('协议引用类型无效',400,'INVALID_INPUT');
    await db.execute(`INSERT INTO application_references
      (workspace_id,chat_id,run_id,application_id,reference_type,${definition.target}) VALUES (?,?,?,?,?,?)`,
    [scope.workspace_id,scope.chat_id,scope.run_id,applicationId,reference.type,reference.id]);
  }
}

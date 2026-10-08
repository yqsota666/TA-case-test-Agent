import {storeError} from './index.js';
import {volumeUnits} from '../../platform-protocol/src/holdings-return.js';

export async function applyConfirmedHolding(db,{keys,channelId,accountId,effect}) {
  const h=effect.holdingEffect,t=effect.transactionEffect,date=t.confirmationDate.replaceAll('-','');
  const hk=[keys[0],channelId,accountId,h.fundCode,h.shareClass];
  if(t.businessCode==='024'){
    const [[holding]]=await db.execute(`SELECT total_volume,available_volume,DATE_FORMAT(snapshot_date,'%Y%m%d') AS snapshot_date
      FROM sales_confirmed_holdings WHERE workspace_id=? AND channel_id=? AND account_id=? AND fund_code=? AND share_class=? FOR UPDATE`,hk);
    if(!holding)throw storeError('HOLDING_VOLUME_INSUFFICIENT',409,'赎回账户尚无对应正式持仓');
    if(holding.snapshot_date && holding.snapshot_date>=date)return;
    const units=volumeUnits(t.confirmedVolume);
    if(volumeUnits(holding.total_volume)<units || holding.available_volume!==null && volumeUnits(holding.available_volume)<units)
      throw storeError('HOLDING_VOLUME_INSUFFICIENT',409,'已确认持仓不足以同步本笔赎回');
    await db.execute(`UPDATE sales_confirmed_holdings SET total_volume=total_volume-?,available_volume=NULL,frozen_volume=NULL
      WHERE workspace_id=? AND channel_id=? AND account_id=? AND fund_code=? AND share_class=?`,[t.confirmedVolume,...hk]);
    return;
  }
  await db.execute(`INSERT INTO sales_confirmed_holdings
    (workspace_id,channel_id,account_id,fund_code,share_class,total_volume) VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE total_volume=total_volume+IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),?,0),
      available_volume=IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),NULL,available_volume),
      frozen_volume=IF(snapshot_date IS NULL OR snapshot_date<STR_TO_DATE(?,'%Y%m%d'),NULL,frozen_volume)`,
  [...hk,h.volumeDelta,date,h.volumeDelta,date,date]);
}

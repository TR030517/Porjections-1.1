export interface SavedBookingAddOn { id:string;bookingItemId:string;sourceAddOnId:string;participantIndex:number;sequence:number;name:string;unitPriceCents:number;quantity:1;lineTotalCents:number;currency:'usd'; }
/** Historical amounts come only from the saved order, never the live catalog. */
export function savedBookingAddOns(raw:unknown):SavedBookingAddOn[]{
  if(raw===undefined)return[];
  if(!Array.isArray(raw)||raw.length>120)throw Error('附加项目快照无法核对，请刷新预约。');
  const ids=new Set<string>();return raw.map(row=>{
    if(!row||!['id','bookingItemId','sourceAddOnId'].every(key=>typeof row[key]==='string'&&/^[1-9]\d{0,18}$/.test(row[key]))||ids.has(row.id)
      ||!Number.isInteger(row.participantIndex)||row.participantIndex<1||row.participantIndex>6||!Number.isInteger(row.sequence)||row.sequence<1||row.sequence>4
      ||typeof row.name!=='string'||!row.name.trim()||row.name.length>100||row.quantity!==1||row.currency!=='usd'
      ||!Number.isSafeInteger(row.unitPriceCents)||row.unitPriceCents<0||row.unitPriceCents>10000000||row.lineTotalCents!==row.unitPriceCents)throw Error('附加项目快照无法核对，请刷新预约。');
    ids.add(row.id);return{id:row.id,bookingItemId:row.bookingItemId,sourceAddOnId:row.sourceAddOnId,participantIndex:row.participantIndex,sequence:row.sequence,name:row.name,unitPriceCents:row.unitPriceCents,quantity:1,lineTotalCents:row.lineTotalCents,currency:'usd'};
  });
}

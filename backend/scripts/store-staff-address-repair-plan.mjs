import { Prisma } from '@prisma/client';
import * as timezoneModule from '../src/common/store-timezone.ts';
import { canonical, completionSelect } from './provisional-store-completion-plan.mjs';
const { usStateCode } = timezoneModule.default ?? timezoneModule;
export { completionSelect };
export const REPAIR_POLICY = 'local-minimum-two-staff-and-street-cleanup-2026-11-07';
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** Strip only a complete locality matching the store's own structured fields.
 * Never infer a numbered street from city/ZIP alone. */
export function splitKnownStreet(shop) {
  let address = shop.address?.trim() ?? '';
  const city = shop.city?.trim(), state = shop.state?.trim(), zip = shop.zipCode?.trim();
  if (!address || !city || !state || !/^\d{5}(?:-\d{4})?$/.test(zip ?? '') || zip === '00000') return null;
  const prefix = address.split(',')[0].trim();
  if (/^\d/.test(prefix) && prefix.length >= 8 && /(?:USA|United States)/i.test(address)) {
    const repeated = address.toLowerCase().lastIndexOf(prefix.toLowerCase());
    if (repeated >= prefix.length && address.slice(repeated).toLowerCase() === prefix.toLowerCase()) address = address.slice(0,repeated).trim();
  }
  const code = usStateCode(state), statePattern = code ? '(?:' + escaped(state) + '|' + escaped(code) + ')' : escaped(state);
  const suffix = new RegExp('(?:^|[\\s,.]+)' + escaped(city) + '[\\s,.]+' + statePattern + '[\\s,.]*' + escaped(zip)
    + '(?:[\\s,.]+(?:USA|US|United States(?: of America)?))?[\\s,.]*$', 'i');
  const match = suffix.exec(address);
  if (!match) return null;
  const street = address.slice(0,match.index).replace(/[\s,.]+$/g,'');
  return { address: street || 'Address pending update', provisional: !street, reason: street ? 'matching-locality-suffix' : 'locality-only-no-street' };
}

export function staffAddressRepairPlan(shops) {
  const changes = [];
  for (const before of shops) {
    const active = before.therapists.filter(person=>person.isActive).length, createTherapists = [];
    const names = new Set(before.therapists.map(person=>person.name.toLowerCase()));
    let ordinal=1, sortOrder=Math.max(-1,...before.therapists.map(person=>person.sortOrder));
    for(let count=active;count<2;count++) {
      while(names.has(('Therapist '+ordinal).toLowerCase())) ordinal++;
      const name='Therapist '+ordinal++; names.add(name.toLowerCase());
      createTherapists.push({name,isActive:true,scheduleMode:'SHOP',sortOrder:Math.min(10000,++sortOrder)});
    }
    let split=splitKnownStreet(before);
    // The original city is a metro label; the complete source street explicitly
    // identifies Bloomington. This correction requires its entire exact preimage.
    if(String(before.id)==='1166' && before.address==='1319 N veterans pkwy. 2B. Bloomington IL61704'
      && before.city==='Bloomington-normal' && before.state==='Illinois' && before.zipCode==='61704') {
      split={address:'1319 N veterans pkwy. 2B',city:'Bloomington',provisional:false,reason:'exact-source-locality-correction'};
    }
    const data={};
    if(split && split.address!==before.address) data.address=split.address;
    if(split?.city) data.city=split.city;
    if(!createTherapists.length && !Object.keys(data).length) continue;
    const marker={policy:REPAIR_POLICY};
    if(createTherapists.length) marker.staff={beforeActiveCount:active,addedNames:createTherapists.map(p=>p.name),targetMinimum:2,needsReview:true};
    if(split) marker.address={before:before.address,after:split.address,reason:split.reason,provisional:split.provisional,needsReview:true};
    data.studioProfile={...(before.studioProfile??{}),qaRepair20261107:marker};
    changes.push({before,data,createTherapists});
  }
  return {policy:REPAIR_POLICY,changes,staffAdded:changes.reduce((n,c)=>n+c.createTherapists.length,0),
    addressChanged:changes.filter(c=>c.data.address!==undefined).length,
    provisionalStreets:changes.filter(c=>c.data.address==='Address pending update').length};
}

export async function applyStaffAddressRepair(target,plan) {
  for(const change of plan.changes) {
    const expected=staffAddressRepairPlan([change.before]).changes[0];
    if(plan.policy!==REPAIR_POLICY || !expected || !same(expected,change)) throw Error('Unexpected repair payload');
  }
  return target.$transaction(async tx=>{
    if(await tx.shop.count()!==1335 || await tx.shop.count({where:{status:'APPROVED',deletedAt:null}})!==1335) throw Error('Unexpected local store set');
    const created=[];
    for(const {before,data,createTherapists} of plan.changes) {
      await tx.$queryRaw`SELECT id FROM shops WHERE id = ${before.id} FOR UPDATE`;
      const current=await tx.shop.findUnique({where:{id:before.id},select:completionSelect});
      if(!same(current,before)) throw Error('Store/personnel changed after planning; rolled back: '+before.id);
      const result=await tx.shop.updateMany({where:{id:before.id,updatedAt:before.updatedAt,status:'APPROVED',deletedAt:null,
        studioProfile:{equals:before.studioProfile===null?Prisma.DbNull:before.studioProfile}},data});
      if(result.count!==1) throw Error('Store compare-and-set failed: '+before.id);
      // Addition only: existing staff, shifts, time off and booking locks are
      // untouched. SHOP automatically grants all store services and opening hours.
      for(const person of createTherapists) {
        const row=await tx.therapist.create({data:{...person,shopId:before.id}});
        created.push({id:String(row.id),shopId:String(before.id)});
      }
    }
    return {updatedStores:plan.changes.length,createdTherapists:created};
  },{maxWait:30000,timeout:600000,isolationLevel:'ReadCommitted'});
}

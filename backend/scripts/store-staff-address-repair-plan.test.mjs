import test from 'node:test';
import assert from 'node:assert/strict';
import {splitKnownStreet,staffAddressRepairPlan,applyStaffAddressRepair} from './store-staff-address-repair-plan.mjs';
const shop=(overrides={})=>({id:1n,address:'123 Main St, Seattle, WA 98144, USA',city:'Seattle',state:'Washington',zipCode:'98144',studioProfile:{brandColor:'teal'},therapists:[{id:1n,name:'Therapist 1',sortOrder:0,isActive:true,scheduleMode:'SHOP'}],...overrides});
test('separates only the known complete locality and retains unit',()=>{
 assert.equal(splitKnownStreet(shop({address:'123 Main St #2 Seattle WA98144'})).address,'123 Main St #2');
 assert.equal(splitKnownStreet(shop({address:'123 Main St, Tacoma, WA 98144'})),null);
 assert.equal(splitKnownStreet(shop({address:'123 Washington Ave'})),null);
});
test('cleans exact duplicated street after country without dropping original unit',()=>{
 assert.equal(splitKnownStreet(shop({address:'240 Auburn Way S, Auburn, WA 98002, USA240 Auburn Way S',city:'Auburn',zipCode:'98002'})).address,'240 Auburn Way S');
});
test('locality-only address becomes an explicit provisional street',()=>{
 assert.deepEqual(splitKnownStreet(shop({address:'Seattle, WA 98144, USA'})),{address:'Address pending update',provisional:true,reason:'locality-only-no-street'});
});
test('adds only missing active capacity, keeps inactive personnel and larger teams',()=>{
 const one=shop({therapists:[...shop().therapists,{id:2n,name:'Therapist 2',sortOrder:1,isActive:false,scheduleMode:'SHIFTED'}]});
 const plan=staffAddressRepairPlan([one]);
 assert.equal(plan.staffAdded,1);assert.equal(plan.changes[0].createTherapists[0].name,'Therapist 3');
 assert.equal(plan.changes[0].createTherapists[0].scheduleMode,'SHOP');
 assert.equal(plan.changes[0].before.therapists[1].isActive,false);
 const two=shop({address:'123 Main St',therapists:[...shop().therapists,{id:3n,name:'Other',sortOrder:2,isActive:true}]});
 assert.equal(staffAddressRepairPlan([two]).changes.length,0);
});
test('repair leaves unrelated settings unchanged and rejects forged writes before transaction',async()=>{
 const plan=staffAddressRepairPlan([shop()]);
 assert.equal(plan.changes[0].data.studioProfile.brandColor,'teal');
 plan.changes[0].data.timezone='America/Chicago';
 await assert.rejects(applyStaffAddressRepair({$transaction:()=>{throw Error('must not enter');}},plan),/Unexpected repair payload/);
});

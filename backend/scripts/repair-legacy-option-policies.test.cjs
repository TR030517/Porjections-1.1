const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPlan}=require('./repair-legacy-option-policies.cjs');
const sql="CREATE TABLE `pro_project` (`id` int,\n`mch_id` int,\n`name` text,\n`cid` text,\n`status` int,\n`delete_time` int) ENGINE=X;\n"+
"INSERT INTO `pro_project` VALUES (10,1,'Services','1',1,0);\n"+
"CREATE TABLE `pro_price` (`id` int,\n`pid` int,\n`name` text,\n`minute` int,\n`price` decimal) ENGINE=X;\n"+
"INSERT INTO `pro_price` VALUES (20,10,'60Min Body Massage',60,70),(21,10,'60Min Couple Massage',60,120),(22,10,'Gift Card 60Min Massage',60,60);\n"+
"CREATE TABLE `pro_cate` (`id` int,\n`name` text) ENGINE=X;\nINSERT INTO `pro_cate` VALUES (1,'Body Massage');";
function fixture(){
 const stamp=new Date('2026-11-06T00:00:00Z');
 const variants=['60Min Body Massage','60Min Couple Massage','Gift Card 60Min Massage'].map((name,index)=>({id:BigInt(index+30),serviceId:40n,name,durationMin:60,priceCents:[7000,12000,6000][index],priceBasis:'PER_BOOKING',currency:'usd',isActive:true,sortOrder:index,updatedAt:stamp}));
 const service={id:40n,shopId:1n,name:'Services',nameEn:null,category:'BODY',durationKind:'TIMED',durationMin:60,priceCents:7000,priceBasis:'PER_BOOKING',participantCount:1,requiredStaffCount:1,requiredRoomType:null,staffBufferMin:0,roomBufferMin:0,description:null,isActive:true,sortOrder:0,updatedAt:stamp,variants,_count:{bookings:0,bookingItems:0,addOns:0}};
 const shops=Array.from({length:1335},(_,index)=>({id:BigInt(index+1),updatedAt:stamp,studioProfile:{legacyImport:{sourceShopId:String(index+1),bookingRepair:{version:'legacy-booking-repair-v1'}},priceMenu:[]},shopServices:[]}));
 shops[0].shopServices=[service];shops[0].studioProfile.priceMenu=[{category:'Our Services',items:variants.map((v,i)=>({id:'legacy-price-'+(20+i),name:v.name,priceText:'Original price',booking:{serviceId:'40',variantId:String(v.id)}}))}];
 return{shops,service,db:{shop:{findMany:async()=>shops}}};
}
test('mixed imports split allocation while retaining exact variant identity, total prices and menu content',async()=>{
 const f=fixture(),before=JSON.stringify(f.shops[0].studioProfile),plan=await buildPlan(f.db,sql),groups=plan.plans[0].actions[0].groups;
 assert.deepEqual(groups.map(g=>g.key),['SINGLE','COUPLE','DISPLAY_ONLY']);
 assert.equal(groups[1].data.requiredStaffCount,2);assert.equal(groups[1].data.participantCount,2);
 assert.equal(groups[1].data.priceCents,12000);assert.equal(groups[1].variants[0].id,31n);
 assert.equal(groups[2].variants[0].after.isActive,false);assert.equal(JSON.stringify(f.shops[0].studioProfile),before);
 assert.equal(plan.summary.newServices,2);assert.equal(plan.summary.displayOnlyOptions,1);
});
test('history and administrator changes prevent service regrouping',async()=>{
 for(const edit of [s=>s._count.bookings=1,s=>s._count.bookingItems=1,s=>s._count.addOns=1,s=>s.isActive=false,s=>s.variants[1].isActive=false,s=>s.requiredStaffCount=3,s=>s.requiredRoomType='COUPLE',s=>s.staffBufferMin=15,s=>s.priceCents=12345]){
  const f=fixture();edit(f.service);const plan=await buildPlan(f.db,sql);assert.equal(plan.plans.length,0);assert.equal(plan.skipped.length,1);
 }
});
test('paused source options stay paused and completed repairs are idempotent',async()=>{
 const f=fixture();f.service.isActive=false;f.service.variants.forEach(v=>v.isActive=false);
 const plan=await buildPlan(f.db,sql.replace("'1',1,0","'1',0,0"));
 assert.equal(plan.plans.length,1);assert.ok(plan.plans[0].actions[0].groups.every(g=>!g.data.isActive));
 f.shops[0].studioProfile.legacyImport.optionPolicyRepair={version:'legacy-option-policy-v2'};
 assert.equal((await buildPlan(f.db,sql)).plans.length,0);
});
test('identical source names, prices and durations are matched by existing menu identities',async()=>{
 const f=fixture();f.service.variants[2].name='60Min Body Massage';f.service.variants[2].priceCents=7000;
 const duplicate=sql.replace("'Gift Card 60Min Massage',60,60","'60Min Body Massage',60,70");
 const plan=await buildPlan(f.db,duplicate),groups=plan.plans[0].actions[0].groups;
 assert.equal(groups[0].variants.length,2);assert.deepEqual(groups[0].variants.map(v=>v.sourceId),['20','22']);
 assert.equal(groups[1].variants[0].sourceId,'21');assert.equal(plan.summary.changedAllocations,1);
});

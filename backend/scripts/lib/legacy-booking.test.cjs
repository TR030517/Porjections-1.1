const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseClock,parseDay,recoverHours,bookingPolicy,optionBookingPolicy,validOption}=require('./legacy-booking.cjs');
test('legacy 24-hour PM suffixes recover without reinterpreting contradictions or midnight',()=>{
  assert.equal(parseClock('22:00 PM'),'22:00');assert.equal(parseClock('12:00 AM'),'00:00');assert.equal(parseClock('12:00 PM'),'12:00');
  assert.equal(parseClock('14:00 AM'),null);assert.equal(parseClock('24:00 PM'),null);
  assert.deepEqual(parseDay(1,'[["09:00 AM","22:00 PM"]]').value,{open:'09:00',close:'22:00',closed:false});
  assert.equal(parseDay(1,'[["22:00 PM","09:00 AM"]]').value,null);
});
test('recover only missing days, preserving administrator times and explicit closures',()=>{
  const result=recoverHours({monday:{closed:true},tuesday:{open:'10:00',close:'18:00'}},{monday:{state:1,time:'[["09:00 AM","22:00 PM"]]'},wednesday:{state:1,time:'[["09:00 AM","22:00 PM"]]'}});
  assert.deepEqual(result.hours.monday,{closed:true});assert.equal(result.hours.tuesday.open,'10:00');assert.equal(result.hours.wednesday.close,'22:00');assert.equal(result.repaired,1);
});
test('couples and four hands reserve distinct correct guest counts and combined menus require review',()=>{
  assert.deepEqual(bookingPolicy("COUPLE'S MASSAGE"),{mode:'COUPLE',participantCount:2,requiredStaffCount:2});
  assert.deepEqual(bookingPolicy('Body Massage (4 hands)'),{mode:'FOUR_HANDS',participantCount:1,requiredStaffCount:2});
  assert.equal(bookingPolicy('Body & Foot & 4 Hands & Couple'),null);
  assert.equal(bookingPolicy('Foot Massage').requiredStaffCount,1);
});
test('short bookable services retain exact prices and durations; outliers stay display-only',()=>{
  assert.equal(validOption({durationMin:15,priceCents:2500}),true);assert.equal(validOption({durationMin:4,priceCents:100}),false);
  assert.equal(validOption({durationMin:300,priceCents:20000}),false);assert.equal(validOption({durationMin:30,priceCents:0}),false);
});
test('specific price options control resource counts inside generic or combined categories',()=>{
  assert.equal(optionBookingPolicy('60Min 4 Hand Massage','Services').mode,'FOUR_HANDS');
  assert.equal(optionBookingPolicy('60Min4 Hands Body Massage','Body Massage').mode,'FOUR_HANDS');
  assert.equal(optionBookingPolicy('60Min Couple Massage','Services').participantCount,2);
  assert.equal(optionBookingPolicy('60Min Swedish Massage','Couple & 4 Hands & Swedish').mode,'SINGLE');
  assert.equal(optionBookingPolicy('60 min','Couple & 4 Hands & Swedish'),null);
  assert.equal(optionBookingPolicy('60 min','Couple Massage').mode,'COUPLE');
  assert.equal(optionBookingPolicy('Anniversary Package A (2 People)','Packages').mode,'COUPLE');
  assert.equal(optionBookingPolicy('small Honeymoon Package(2peoples)','Packages').requiredStaffCount,2);
  assert.equal(optionBookingPolicy('60mins HEAD TREATMENT / 2 Person Set','Head Treatment').participantCount,2);
  assert.equal(optionBookingPolicy('ENJOY A 4, 6, 8 HAND MASSAGE','Body Massage'),null);
});
test('gift and multi-use products stay display-only without disabling ordinary combo packages',()=>{
  for(const name of ['Gift Card - 60Min Couple Massage Package Only','60Min Swedish Massage Buy 4 Get 1','Package of 5 massages','5 sessions package'])assert.equal(optionBookingPolicy(name,'Services'),null);
  assert.equal(optionBookingPolicy('60Min Combo Package','Services').mode,'SINGLE');
  assert.equal(optionBookingPolicy('Package 1 Thai Combination','PACKAGE').mode,'SINGLE');
  assert.equal(optionBookingPolicy('Only $20 for 15Min Add-ons','Services'),null);
});

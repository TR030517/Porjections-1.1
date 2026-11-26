import { publicShopProfile } from './shop-public-profile';
import { resolvePriceMenu } from './shop-price-menu-catalog-view';
const service={id:20n,shopId:10n,name:'Couple massage',durationKind:'TIMED',durationMin:60,priceCents:12000,currency:'usd',priceBasis:'PER_BOOKING',isActive:true,participantCount:2,requiredStaffCount:2,variants:[],addOns:[]};
const menu=[{category:'Massage',items:[{name:'Couple massage',priceText:'',booking:{serviceId:'20'}}]}];
test('public two-staff price entry stays visible but cannot be booked with one active therapist',()=>{
 const row=publicShopProfile({id:10n,studioProfile:{priceMenu:menu},shopServices:[service]},[],{activeStaffCount:1}).priceMenu![0].items[0];
 expect(row).toMatchObject({bookingEnabled:true,bookingAvailable:false,bookingUnavailableReason:'CONFIGURATION_REQUIRED',bookingMode:'COUPLE'});
 expect(row.pricing?.priceCents).toBe(12000);
 expect(resolvePriceMenu(menu,[service],10n,{activeStaffCount:2})[0].items[0].bookingAvailable).toBe(true);
 expect(resolvePriceMenu(menu,[service],10n,{activeStaffCount:1,hasConfiguredBookingSchedule:false})[0].items[0].bookingUnavailableReason).toBe('CONFIGURATION_REQUIRED');
});
test('four-hands also needs two people and editor projection does not alter saved enable flags',()=>{
 const four={...service,participantCount:1};
 expect(resolvePriceMenu(menu,[four],10n,{activeStaffCount:1})[0].items[0]).toMatchObject({bookingMode:'FOUR_HANDS',bookingEnabled:true,bookingAvailable:false});
 expect(resolvePriceMenu(menu,[four],10n)[0].items[0].bookingAvailable).toBe(true);
 expect(resolvePriceMenu(menu,[{...four,requiredStaffCount:1}],10n,{activeStaffCount:1})[0].items[0].bookingAvailable).toBe(true);
});

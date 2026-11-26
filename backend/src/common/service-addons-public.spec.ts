import {publicServiceView} from './shop-public-profile';
test('public primary services expose only their own enabled USD add-ons and no internal fields',()=>{
  const service:any={id:20n,shopId:10n,name:'Main',durationMin:60,priceCents:8000,isActive:true,addOns:[
    {id:1n,serviceId:20n,name:'Oil',priceCents:1000,currency:'usd',isActive:true,sortOrder:0,privateAccount:'never-public'},
    {id:2n,serviceId:30n,name:'Other parent',priceCents:1000,currency:'usd',isActive:true},
    {id:3n,serviceId:20n,name:'Disabled',priceCents:1000,currency:'usd',isActive:false},
    {id:4n,serviceId:20n,name:'Wrong currency',priceCents:1000,currency:'eur',isActive:true},
    {id:5n,serviceId:20n,name:'<b>Unsafe</b>',priceCents:1000,currency:'usd',isActive:true},
  ]};
  expect(publicServiceView(service).addOns).toEqual([{id:'1',serviceId:'20',name:'Oil',description:null,priceCents:1000,currency:'usd',isActive:true,sortOrder:0}]);
  expect(publicServiceView({...service,isActive:false}).addOns).toEqual([]);
});

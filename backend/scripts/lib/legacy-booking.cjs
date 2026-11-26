'use strict';
const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
function parseClock(value) {
  const match=String(value??'').trim().match(/^(\d{1,2}):(\d{2})(?::00)?\s*(AM|PM)?$/i);
  if(!match)return null;
  let hour=Number(match[1]);const minute=Number(match[2]),suffix=match[3]?.toUpperCase();
  if(hour>23||minute>59)return null;
  // Legacy UI sometimes appends PM to already-24-hour values, e.g. 22:00 PM.
  // AM with 13–23 is contradictory and must not be guessed.
  if(suffix==='AM'&&hour>12)return null;
  if(suffix&&hour<=12)hour=hour%12+(suffix==='PM'?12:0);
  return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
function parseDay(state,time) {
  if(state===null||state===undefined||String(state).trim()==='')return {value:null,warning:true};
  if(Number(state)===0)return {value:{closed:true},warning:false};
  if(Number(state)!==1)return {value:null,warning:true};
  let decoded;try{decoded=typeof time==='string'?JSON.parse(time):time;}catch{return {value:null,warning:true};}
  const rows=Array.isArray(decoded)?decoded:decoded&&typeof decoded==='object'?[decoded]:[];
  const intervals=[];
  for(const row of rows) {
    const open=parseClock(Array.isArray(row)?row[0]:row?.open??row?.start),close=parseClock(Array.isArray(row)?row[1]:row?.close??row?.end);
    if(!open||!close||open>=close)return {value:null,warning:true};
    intervals.push({open,close,closed:false});
  }
  intervals.sort((a,b)=>a.open.localeCompare(b.open));
  if(!intervals.length||intervals.length>4||intervals.some((row,i)=>i>0&&row.open<intervals[i-1].close))return {value:null,warning:true};
  return {value:intervals.length===1?intervals[0]:intervals,warning:false};
}
function recoverHours(current,raw) {
  const result={...(current||{})};let repaired=0;const missing=[];
  for(const day of DAYS) {
    // Only missing days are recoverable; an explicit saved closure stays closed.
    if(result[day]!==undefined)continue;
    const recovered=parseDay(raw?.[day]?.state,raw?.[day]?.time);
    if(recovered.value!==null){result[day]=recovered.value;repaired++;}else missing.push(day);
  }
  return {hours:result,repaired,missing};
}
function bookingPolicy(name) {
  const normalized=String(name).normalize('NFKC').toLowerCase();
  const couple=/\bcouples?(?:['’]s)?\b|情侣|双人/.test(normalized);
  const four=/\b(?:four|4)[\s-]*hands?\b|四手/.test(normalized);
  // Combined catalogs describe several service types; their shared price cannot
  // identify one exact staff/guest allocation and remain display-only.
  if(couple&&four)return null;
  if(couple)return {mode:'COUPLE',participantCount:2,requiredStaffCount:2};
  if(four)return {mode:'FOUR_HANDS',participantCount:1,requiredStaffCount:2};
  return {mode:'SINGLE',participantCount:1,requiredStaffCount:1};
}
const validOption=row=>Number.isInteger(row.durationMin)&&row.durationMin>=5&&row.durationMin<=240&&Number.isInteger(row.priceCents)&&row.priceCents>0&&row.priceCents<=10000000;
function optionBookingPolicy(optionName,parentName) {
  const option=String(optionName||'').normalize('NFKC').toLowerCase()
    .replace(/(\d+\s*(?:mins?|minutes?))(?=(?:4|four|6|six|8|eight)[\s-]*hands?\b)/g,'$1 ');
  const parent=String(parentName||'').normalize('NFKC').toLowerCase();
  // A gift/prepaid entitlement is not one appointment, even if its advertised
  // duration happens to fit the appointment limit. Combo packages remain valid.
  const entitlement=/\bgift[\s-]*(?:cards?|certificates?)\b|\bbuy\s*\d+\s*(?:get|\+)\s*\d+\b|\b(?:package|pack|bundle)\s+of\s*\d+\b|\b\d+\s*(?:sessions?|visits?|treatments?)\s*(?:package|pack|bundle)\b|礼卡|次卡|疗程卡/;
  if(entitlement.test(option)||entitlement.test(parent))return null;
  if(/\badd[\s-]?ons?\s*$/.test(option))return null;
  if(/\b(?:six|6|eight|8)[\s-]*hands?\b/.test(option))return null;
  const specific=bookingPolicy(option);
  if(/\b(?:two|2)[\s-]*(?:peoples?|persons?|guests?)\b/.test(option))return specific?.mode==='FOUR_HANDS'?null:{mode:'COUPLE',participantCount:2,requiredStaffCount:2};
  if(!specific||specific.mode!=='SINGLE')return specific;
  const inherited=bookingPolicy(parent);
  if(inherited)return inherited;
  // An ordinary named massage inside a mixed catalog identifies one service.
  // Bare durations such as "60 min" inside that catalog remain ambiguous.
  if(/\b(?:swedish|reflexology|deep\s*tissue|hot\s*stone|body|foot|chair|combo|shiatsu|thai|sports?|prenatal|cupping|scalp)\b|足疗|全身|椅背|拔罐/.test(option))return specific;
  return null;
}
module.exports={DAYS,parseClock,parseDay,recoverHours,bookingPolicy,optionBookingPolicy,validOption};

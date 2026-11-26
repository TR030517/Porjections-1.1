import { allocate, AllocationContext } from './availability';
import { coveredByShifts, effectiveWeeklyShifts, readScheduleMode, recurringScheduleCheck, workIntervals } from './work-schedule';

const date = '2035-01-01', timezone = 'UTC';
const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][weekday];
const hours = { [day]: [{ open:'09:00',close:'12:00' },{ open:'13:00',close:'18:00' }] };
const at = (clock:string) => new Date(`${date}T${clock}:00Z`);
const window = (start:string,end:string) => ({startAtUtc:at(start),endAtUtc:at(end)});

describe('store hours and personal schedule semantics',()=>{
  test('SHOP follows current store periods with no employee shifts and keeps the lunch closure',()=>{
    const shifts=effectiveWeeklyShifts('SHOP',hours,[]);
    expect(coveredByShifts(window('09:00','10:10'),timezone,shifts)).toBe(true);
    expect(coveredByShifts(window('11:30','12:30'),timezone,shifts)).toBe(false);
    expect(coveredByShifts(window('17:00','18:10'),timezone,shifts)).toBe(false);
    expect(coveredByShifts(window('17:00','18:00'),timezone,shifts)).toBe(true);
  });
  test('CUSTOM never inherits a closed/missing weekday or deliberately disabled old shift',()=>{
    const saved=[{weekday,startMin:540,endMin:600,isActive:true},{weekday,startMin:600,endMin:1080,isActive:false}];
    const shifts=effectiveWeeklyShifts('CUSTOM',hours,saved);
    expect(coveredByShifts(window('09:00','10:00'),timezone,shifts)).toBe(true);
    expect(coveredByShifts(window('09:00','10:10'),timezone,shifts)).toBe(false);
    expect(effectiveWeeklyShifts('CUSTOM',hours,[])).toEqual([]);
    expect(effectiveWeeklyShifts(undefined,hours,[])).toEqual([]);
    expect(readScheduleMode(undefined)).toBe('CUSTOM');expect(()=>readScheduleMode('AUTO')).toThrow();
  });
  test('recurring setup follows current opening hours and handles inactive, empty and legacy personal shifts', () => {
    const active = { weekday, startMin: 540, endMin: 600, isActive: true };
    const hasRecurringShift = recurringScheduleCheck(hours);
    expect([].some(hasRecurringShift)).toBe(false);
    expect(recurringScheduleCheck({})({ scheduleMode: 'SHOP', shifts: [] })).toBe(false);
    expect(recurringScheduleCheck(JSON.stringify(hours))({ scheduleMode: 'SHOP', shifts: [] })).toBe(true);
    expect(hasRecurringShift({ scheduleMode: 'CUSTOM', shifts: [] })).toBe(false);
    expect(hasRecurringShift({ scheduleMode: 'CUSTOM', shifts: [{ ...active, isActive: false }] })).toBe(false);
    expect(hasRecurringShift({ scheduleMode: 'CUSTOM', shifts: [{ ...active, startMin: 720, endMin: 780 }] })).toBe(false);
    expect(hasRecurringShift({ scheduleMode: 'CUSTOM', shifts: [{ ...active, startMin: 780, endMin: 780 }] })).toBe(false);
    expect(hasRecurringShift({ scheduleMode: null, shifts: [active] })).toBe(true);
  });
  test.each(['SHOP','CUSTOM'])('leave and resource locks still block inherited or personal employees (%s)',mode=>{
    const shifts=workIntervals(date,timezone,effectiveWeeklyShifts(mode,hours,[{weekday,startMin:540,endMin:1080,isActive:true}]));
    const context:AllocationContext={count:1,staffCount:2,duration:60,staffBuffer:10,roomBuffer:0,needsRoom:false,rooms:[],locks:[],legacy:[],
      therapists:['1','2'].map(id=>({id,shifts,timeOff:[]}))};
    expect(allocate(context,at('09:00'),[])?.therapistIds).toEqual(['1','2']);
    context.therapists[1].timeOff=[{start:at('10:00'),end:at('11:00')}];
    expect(allocate(context,at('09:00'),[])).toBeNull();
    context.therapists[1].timeOff=[];context.locks=[{type:'THERAPIST',id:'2',start:at('10:00'),end:at('11:00')}];
    expect(allocate(context,at('09:00'),[])).toBeNull();
    context.locks=[];context.therapists.pop();expect(allocate(context,at('09:00'),[])).toBeNull();
  });
});

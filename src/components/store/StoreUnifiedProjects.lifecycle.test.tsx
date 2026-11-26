import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuthStore } from '../../stores/authStore';
import { clearSession } from '../../api/session';
import type { BusinessLifecycle } from './businessScope';

register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, nextLoad) { if (url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true}; return nextLoad(url, context); }"), import.meta.url);
const { default: StoreUnifiedProjects } = await import('./StoreUnifiedProjects');
type Node = React.ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (node: Node) => boolean): Node | undefined {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!React.isValidElement(tree)) return;
  const node=tree as Node;
  return predicate(node) ? node : find(node.props.children,predicate);
}
function text(tree: unknown): string {
  if(Array.isArray(tree))return tree.map(text).join(' ');
  if(React.isValidElement(tree))return text((tree as Node).props.children);
  return typeof tree==='string' || typeof tree==='number' ? String(tree) : '';
}
const clean: BusinessLifecycle={dirty:false,busy:false,unknown:false};
const row=(id:string)=>({ id,shopId:'5',name:'Synthetic service '+id,nameEn:null,description:'Saved common metadata',category:'MASSAGE',isActive:true,
  durationKind:'TIMED',durationMin:60,priceCents:8000,priceBasis:'PER_BOOKING',participantCount:1,requiredStaffCount:1,requiredRoomType:null,
  staffBufferMin:0,roomBufferMin:0,sortOrder:0,hasVariants:false,variantCount:0,addOnCount:0,selectionRevision:'a'.repeat(64),preview:null,variants:[],addOns:[] });

test('continuous service editors keep drafts and unknown recovery isolated while selecting only the exact service', async()=>{
  const keys=['window','document','IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key)), previousFetch=globalThis.fetch;
  const doc:Record<string,unknown>={nodeType:9,activeElement:null,addEventListener(){},removeEventListener(){}};
  const win={document:doc,HTMLIFrameElement:class{},event:undefined,addEventListener(){},removeEventListener(){},sessionStorage:{getItem(){return null;},removeItem(){},setItem(){}}};doc.defaultView=win;
  for(const [key,value] of Object.entries({window:win,document:doc,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,value});
  const container={nodeType:1,nodeName:'DIV',tagName:'DIV',ownerDocument:doc,addEventListener(){},removeEventListener(){},textContent:''};
  const actor={id:'7',role:'ADMIN',name:'Synthetic service admin'};
  const reads:string[]=[],selected:string[]=[];
  globalThis.fetch=async(input,options)=>{
    const path=String(input);
    if(path.endsWith('/auth/refresh') || path.endsWith('/auth/admin/refresh'))return Response.json({accessToken:'test-only',user:actor});
    if(path.endsWith('/auth/me'))return Response.json(actor);
    assert.ok(!options?.method || options.method==='GET');
    const url=new URL(path,'http://local.invalid');assert.match(url.pathname,/\/reservation-admin\/shops\/5\/project-catalog$/);
    const serviceId=url.searchParams.get('serviceId')!;reads.push(serviceId);
    return Response.json({shopId:'5',search:'',status:'all',page:1,pageSize:1,serviceId,total:1,hasMore:false,canManageCatalog:true,canConfigurePolicy:true,items:[row(serviceId)]});
  };
  let tree:unknown,lifecycle=clean,refreshes=0,failRefresh=false;
  function Probe(){tree=StoreUnifiedProjects({shopId:'5',onlineBookingEnabled:true,menu:[],priceMenuRevision:'a'.repeat(64),menuAvailability:{status:'known'},revision:0,selectedServiceId:'7',disabled:false,
    variantFocus:{serviceId:'7',variantId:'72',revision:3},beforeWrite:()=>true,onSelectService:id=>{selected.push(id);},onLocateMenu(){},onLifecycleChange:next=>{lifecycle=next;},onChanged:async()=>{refreshes++;if(failRefresh)throw Error('Synthetic readback unavailable');}});return null;}
  function SignedIn(){return useAuthStore().user ? <Probe/> : null;}
  clearSession();const root=createRoot(container as unknown as HTMLElement);
  const component=(name:string)=>{const node=find(tree,node=>typeof node.type==='function'&&node.type.name===name);assert.ok(node,'expected '+name);return node;};
  try{
    await act(async()=>{root.render(<StrictMode><AuthProvider><SignedIn/></AuthProvider></StrictMode>);});
    assert.equal(component('StoreProjectMetadata').props.project.id,'7');
    assert.equal(component('ReservationSettings').props.initialServiceId,'7');
    assert.equal(component('ReservationSettings').props.initialVariantId,'72');
    assert.equal(component('ReservationSettings').props.variantFocusRevision,3);
    assert.equal(component('ReservationSettings').props.variantFocusPending,true);
    component('ReservationSettings').props.onVariantFocused();
    await act(async()=>{await component('StoreProjectMetadata').props.onSaved();});
    assert.equal(component('ReservationSettings').props.variantFocusPending,false,'a directory reload cannot replay a consumed focus request when its child remounts');
    assert.equal(component('StoreProjectAddOns').props.serviceId,'7');
    assert.ok(find(tree,node=>node.type==='section'&&node.props['aria-label']==='所选服务与价格'));
    assert.equal(find(tree,node=>node.type==='div'&&node.props.hidden===true),undefined,'the selected editor is continuous, not hidden behind old panes');
    await act(async()=>{component('ReservationSettings').props.onLifecycleChange({...clean,dirty:true});});
    assert.equal(component('StoreProjectMetadata').props.disabled,true);
    assert.equal(component('StoreProjectAddOns').props.disabled,true);
    assert.equal(component('ReservationSettings').props.disabled,false,'the owner can still finish its own draft');
    await act(async()=>{assert.equal(component('StoreProjectMetadata').props.beforeWrite(),false);assert.equal(component('ReservationSettings').props.beforeWrite(),true);});
    await act(async()=>{component('StoreProjectInventory').props.onSelect('8');});
    assert.equal(selected.length,0);assert.equal(component('StoreProjectMetadata').props.project.id,'7');
    await act(async()=>{component('ReservationSettings').props.onLifecycleChange({...clean,unknown:true});});
    assert.equal(lifecycle.unknown,true);
    assert.equal(component('ReservationSettings').props.disabled,false,'unknown-result recovery stays reachable in its own editor');
    assert.equal(component('StoreProjectMetadata').props.disabled,true);
    await act(async()=>{component('ReservationSettings').props.onLifecycleChange(clean);component('StoreProjectMetadata').props.onLifecycleChange({...clean,dirty:true});});
    assert.equal(component('ReservationSettings').props.disabled,true);
    assert.equal(component('StoreProjectMetadata').props.disabled,false);
    await act(async()=>{component('StoreProjectMetadata').props.onLifecycleChange(clean);});
    await act(async()=>{component('StoreProjectInventory').props.onSelect('8');});
    assert.deepEqual(selected,['8']);assert.equal(component('StoreProjectMetadata').props.project.id,'8');assert.equal(reads.at(-1),'8');
    assert.equal(component('ReservationSettings').props.initialVariantId,undefined,'a source-row request cannot leak into another service');
    failRefresh=true;
    await act(async()=>{await assert.rejects(component('StoreProjectMetadata').props.onSaved(),/Synthetic readback unavailable/);});
    assert.equal(refreshes,2);assert.equal(lifecycle.unknown,true);
    assert.equal(component('StoreProjectMetadata').props.disabled,true);
    assert.ok(find(tree,node=>node.type==='button'&&text(node)==='只读重新载入并核对'));
  }finally{
    await act(async()=>{root.unmount();});clearSession();globalThis.fetch=previousFetch;
    keys.forEach((key,index)=>{const descriptor=descriptors[index];if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);});
  }
});

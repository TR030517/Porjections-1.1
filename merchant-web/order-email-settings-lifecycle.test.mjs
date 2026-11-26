import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import path from 'node:path';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const find = (tree, predicate) => Array.isArray(tree) ? tree.map(node => find(node, predicate)).find(Boolean) : React.isValidElement(tree) ? predicate(tree) ? tree : find(tree.props.children, predicate) : undefined;
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : React.isValidElement(tree) ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const base = (id='5') => ({ shopId: id, revision: 0, state: 'LEGACY_UNVERIFIED', recipient: null, verifiedAt: null, legacyCandidate: `public${id}@example.test`, pending: null, delivery: { configured: true, mode: 'PROVIDER', workerEnabled: true, reasonCode: null } });
async function harness(run) {
  const keys = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'], previous = keys.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const document = { nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {} }, window = { document, HTMLIFrameElement: class {}, event: undefined };
  document.defaultView = window;
  for (const [key,value] of Object.entries({window,document,navigator:{},IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{configurable:true,value});
  const container = { nodeType:1, nodeName:'DIV', tagName:'DIV', ownerDocument:document, addEventListener(){},removeEventListener(){},textContent:'' };
  const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  let root, tree, state=base(), scope='a:5', shopId='5', active=true, lifecycle, hooks;
  const calls = {read:0,request:[],verify:[],disable:[]};
  let read = async () => structuredClone(state);
  let request = async input => { state={...state,revision:state.revision+1,pending:{challengeId:input.requestId,email:input.email,expiresAt:'2099-11-18T00:10:00Z',deliveryState:'SENT',attemptsRemaining:5}};return structuredClone(state); };
  let verify = async input => { state={...state,revision:state.revision+1,state:'VERIFIED',recipient:state.pending.email,verifiedAt:'2026-11-18T00:00:00Z',pending:null};return structuredClone(state); };
  const api = {read:async signal=>{calls.read++;return read(signal);},request:async input=>{calls.request.push(input);return request(input);},verify:async input=>{calls.verify.push(input);return verify(input);},disable:async input=>{calls.disable.push(input);state={...state,revision:state.revision+1,state:'DISABLED',recipient:null,verifiedAt:null,pending:null};return structuredClone(state);}};
  try {
    const Component = (await server.ssrLoadModule(path.resolve('../src/components/store/StoreOrderEmailSettings.tsx'))).default;
    function Probe(){ tree = Component({shopId,scopeKey:scope,api,isCurrent:()=>active,onLifecycleChange:value=>{lifecycle=value;},confirmEndReview:async()=>true});return null; }
    root=createRoot(container); const render=()=>act(async()=>{root.render(React.createElement(StrictMode,null,React.createElement(Probe)));});
    const control=predicate=>{const value=find(tree,predicate);assert.ok(value,'expected control exists');return value;};
    const button=label=>control(node=>node.type==='button'&&text(node).trim()===label);
    const input=kind=>control(node=>node.type==='input'&&node.props.id===`order-email-${kind}-${shopId}`);
    await render();
    await run({calls,tree:()=>tree,lifecycle:()=>lifecycle,state:()=>state,setState:value=>{state=value;},setRead:value=>{read=value;},setRequest:value=>{request=value;},setVerify:value=>{verify=value;},readDefault:()=>{read=async()=>structuredClone(state);},
      click:label=>act(async()=>{await button(label).props.onClick();}), button,input,
      change:(kind,value)=>act(async()=>{input(kind).props.onChange({target:{value}});}),
      applyRequest:input=>{state={...state,revision:input.expectedRevision+1,pending:{challengeId:input.requestId,email:input.email,expiresAt:'2099-11-18T00:10:00Z',deliveryState:'SENT',attemptsRemaining:5}};},
      applyVerify:()=>{state={...state,revision:state.revision+1,state:'VERIFIED',recipient:state.pending.email,verifiedAt:'2026-11-18T00:00:00Z',pending:null};},
      switch:async(id,identity)=>{shopId=id;scope=identity;await render();},setActive:value=>{active=value;},render});
  } finally {if(root)await act(async()=>root.unmount());await server.close();previous.forEach(([key,value])=>value?Object.defineProperty(globalThis,key,value):Reflect.deleteProperty(globalThis,key));}
}

test('private recipient requires actual code confirmation while the active address stays in effect; wrong attempts reread without resend',()=>harness(async h=>{
  assert.match(text(h.tree()),/尚未验证/);assert.match(text(h.tree()),/仅格式有效/);assert.equal(h.calls.request.length,0);
  await h.change('recipient','Private@example.test');await h.click('向此地址发送验证码');
  assert.equal(h.calls.request.length,1);assert.equal(h.calls.request[0].email,'private@example.test');assert.equal(h.state().recipient,null);assert.equal(h.input('recipient').props.value,'private@example.test');
  await h.change('code','12345');await h.click('验证并启用新收件地址');assert.equal(h.calls.verify.length,0);
  h.setVerify(async()=>{h.setState({...h.state(),pending:{...h.state().pending,attemptsRemaining:4}});throw Object.assign(new Error('验证码无效'),{status:400});});
  await h.change('code','123456');await h.click('验证并启用新收件地址');assert.equal(h.calls.verify.length,1);assert.match(text(h.tree()),/剩余尝试\s+4\s+次/);assert.equal(h.calls.request.length,1);
  h.setVerify(async()=>{h.applyVerify();return h.state();});await h.click('验证并启用新收件地址');assert.equal(h.state().recipient,'private@example.test');assert.match(text(h.tree()),/收件地址已验证/);
  await h.change('recipient','next@example.test');await h.click('向此地址发送验证码');assert.equal(h.state().recipient,'private@example.test');assert.match(text(h.tree()),/当前已验证地址继续用于新事件/);
  await h.click('停用预约通知收件地址');assert.equal(h.state().state,'DISABLED');assert.match(text(h.tree()),/订单仍保存在后台/);
}));

test('an uncertain code request keeps its fence at the old revision; reconciliation is read-only and accepts the original UUID',()=>harness(async h=>{
  h.setRequest(async()=>{throw new TypeError('Synthetic lost response');});await h.change('recipient','private@example.test');await h.click('向此地址发送验证码');
  assert.equal(h.lifecycle().unknown,true);assert.equal(h.input('recipient').props.disabled,true);const request=structuredClone(h.calls.request[0]);
  await h.click('重新读取通知设置');assert.equal(h.lifecycle().unknown,true);assert.equal(h.calls.request.length,1);assert.match(text(h.tree()),/原请求仍可能稍后生效/);
  h.applyRequest(request);await h.click('重新读取通知设置');assert.equal(h.lifecycle().unknown,false);assert.equal(h.calls.request.length,1);assert.equal(h.input('recipient').props.value,'private@example.test');
  assert.equal(h.state().pending.challengeId,request.requestId);
}));

test('an uncertain verification never replays the code and later CAS changes retain the draft for explicit review',()=>harness(async h=>{
  await h.change('recipient','private@example.test');await h.click('向此地址发送验证码');await h.change('code','123456');
  h.setVerify(async()=>{throw new TypeError('Synthetic lost verification');});await h.click('验证并启用新收件地址');assert.equal(h.lifecycle().unknown,true);
  h.setState({...h.state(),revision:3,state:'VERIFIED',recipient:'other@example.test',verifiedAt:'2026-11-18T00:00:00Z',pending:null});
  await h.click('重新读取通知设置');assert.equal(h.lifecycle().unknown,false);assert.equal(h.calls.verify.length,1);assert.equal(h.input('recipient').props.value,'private@example.test');assert.match(text(h.tree()),/后续操作更新/);
  await h.click('放弃通知邮箱草稿');assert.equal(h.input('recipient').props.value,'other@example.test');assert.equal(h.lifecycle().dirty,false);
}));

test('duplicate click callbacks cannot create duplicate requests before React commits the busy state',()=>harness(async h=>{
  const request=deferred();h.setRequest(()=>request.promise);await h.change('recipient','private@example.test');
  const click=h.button('向此地址发送验证码').props.onClick;
  await act(async()=>{click();click();});assert.equal(h.calls.request.length,1);
  h.applyRequest(h.calls.request[0]);await act(async()=>{request.resolve(h.state());});assert.equal(h.lifecycle().busy,false);assert.equal(h.lifecycle().unknown,false);
}));

test('late writes and reads from a previous shop or login scope never leak into the current recipient editor',()=>harness(async h=>{
  const old=deferred();h.setRequest(()=>old.promise);await h.change('recipient','old-private@example.test');await h.click('向此地址发送验证码');
  h.setState(base('6'));await h.switch('6','b:6');assert.match(text(h.tree()),/public6@example.test/);assert.doesNotMatch(text(h.tree()),/old-private/);
  await act(async()=>{old.resolve({...base('5'),revision:1,pending:{challengeId:h.calls.request[0].requestId,email:'old-private@example.test',expiresAt:'2099-11-18T00:10:00Z',deliveryState:'SENT',attemptsRemaining:5}});});
  assert.equal(h.input('recipient').props.value,'public6@example.test');assert.equal(h.lifecycle().unknown,false);
  const lateRead=deferred();h.setRead(()=>lateRead.promise);let refreshing;await act(async()=>{refreshing=h.button('重新读取通知设置').props.onClick();});
  h.setState(base('7'));h.readDefault();await h.switch('7','c:7');await act(async()=>{lateRead.resolve(base('6'));await refreshing;});
  assert.equal(h.input('recipient').props.value,'public7@example.test');assert.doesNotMatch(text(h.tree()),/public6/);
}));

test('a definite version conflict refreshes without retrying and local capture remains visibly separate from real delivery',()=>harness(async h=>{
  h.setRequest(async()=>{h.setState({...base(),revision:2,state:'VERIFIED',recipient:'current@example.test',verifiedAt:'2026-11-18T00:00:00Z',delivery:{configured:true,mode:'LOCAL_CAPTURE',workerEnabled:true,reasonCode:null}});throw Object.assign(new Error('版本已变化'),{status:409});});
  await h.change('recipient','draft@example.test');await h.click('向此地址发送验证码');assert.equal(h.calls.request.length,1);assert.equal(h.lifecycle().unknown,false);assert.equal(h.input('recipient').props.value,'draft@example.test');
  assert.match(text(h.tree()),/不会发送到真实邮箱/);assert.match(text(h.tree()),/current@example.test/);
}));

test('actual received proof can be submitted while delivery finalization is still SENDING without requesting another code',()=>harness(async h=>{
  h.setState({...h.state(),revision:1,pending:{challengeId:'04ee65f8-062e-44db-889b-660bec285c91',email:'private@example.test',expiresAt:'2099-11-18T00:10:00Z',deliveryState:'SENDING',attemptsRemaining:5}});
  await h.click('重新读取通知设置');assert.match(text(h.tree()),/若目标邮箱已收到验证码/);assert.equal(h.input('code').props.disabled,false);
  await h.change('code','123456');await h.click('验证并启用新收件地址');assert.equal(h.calls.verify.length,1);assert.equal(h.calls.request.length,0);assert.equal(h.state().recipient,'private@example.test');
}));

test('login scope A to B to A retires the first scope events and responses permanently',()=>harness(async h=>{
  const oldEvent=h.button('向此地址发送验证码').props.onClick, late=deferred();h.setRead(()=>late.promise);
  let pendingRead;await act(async()=>{pendingRead=h.button('重新读取通知设置').props.onClick();});
  h.readDefault();await h.switch('6','b:6');h.setState(base());await h.switch('5','a:5');
  await act(async()=>{oldEvent();late.resolve({...base(),state:'VERIFIED',recipient:'old@example.test',verifiedAt:'2026-11-18T00:00:00Z'});await pendingRead;});
  assert.equal(h.calls.request.length,0);assert.doesNotMatch(text(h.tree()),/old@example.test/);assert.equal(h.input('recipient').props.value,'public5@example.test');
}));

test('a 403 read removes stale private status and forbids later writes without silently falling back to a public email',()=>harness(async h=>{
  h.setState({...base(),revision:2,state:'VERIFIED',recipient:'private@example.test',verifiedAt:'2026-11-18T00:00:00Z'});await h.click('重新读取通知设置');assert.match(text(h.tree()),/private@example.test/);
  h.setRead(async()=>{throw Object.assign(new Error('无权读取本店通知设置'),{status:403});});await h.click('重新读取通知设置');
  assert.doesNotMatch(text(h.tree()),/private@example.test|public5@example.test/);assert.match(text(h.tree()),/状态尚未核对/);assert.equal(h.calls.request.length,0);
}));

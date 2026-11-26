import { BadRequestException } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import { merchantAccountInput, merchantLoginReady, merchantRoutedLoginReady } from './merchant-account';

const input = {loginName:'  ANGEL-foot ',name:' Synthetic shop login ',password:'Synthetic-safe-pass-123',email:' NAME@example.invalid ',phone:''};
const passwordHash = hashSync(input.password,4);
describe('shared merchant input and credential readiness (offline)',()=>{
  test('required login email normalizes consistently and phone remains optional',()=>{
    expect(merchantAccountInput(input)).toEqual({loginName:'angel-foot',name:'Synthetic shop login',password:input.password,email:'name@example.invalid',phone:null});
    expect(()=>merchantAccountInput({...input,email:''})).toThrow(BadRequestException);
    expect(merchantAccountInput({...input,password:'123456'}).password).toBe('123456');
    expect(merchantAccountInput({...input,email:' NAME@example.invalid ',phone:' +15550001234 '})).toMatchObject({email:'name@example.invalid',phone:'+15550001234'});
  });
  test.each([{loginName:'bad/path'},{loginName:'xx'},{name:''},{email:'bad-mail'},{phone:'12345'},{password:'short'},{password:' ' + input.password},{password:'密'.repeat(25)},{password:'Synthetic\nnewline-pass'}])('rejects invalid merchant input %#',change=>{
    expect(()=>merchantAccountInput({...input,...change})).toThrow(BadRequestException);
  });
  test('readiness requires current merchant state, a routed identifier and a bcrypt envelope',()=>{
    const user={role:'MERCHANT',status:'ACTIVE',deletedAt:null,loginName:'angel-foot',passwordHash};
    expect(merchantLoginReady(user)).toBe(true);
    for(const change of [{passwordHash:null},{passwordHash:'legacy-placeholder'},{passwordHash:'$2b$12$too-short'},{loginName:null},{status:'SUSPENDED'},{role:'STAFF'},{deletedAt:new Date()}]) expect(merchantLoginReady({...user,...change})).toBe(false);
    expect(merchantLoginReady({...user,loginName:null,email:'login@example.invalid'})).toBe(true);
    expect(merchantLoginReady({...user,loginName:null,phone:'+15550001234'})).toBe(true);
  });
  test('shared routed readiness preserves numeric namespace ambiguity and avoids unnecessary queries', async () => {
    const user = { id: 7n, role:'MERCHANT',status:'ACTIVE',deletedAt:null,loginName:'12345',passwordHash };
    const db = { user: { findMany: jest.fn(async () => [{ id:7n }]) } };
    expect(await merchantRoutedLoginReady(db,user)).toBe(true);
    expect(db.user.findMany).toHaveBeenCalledWith({where:{OR:[{loginName:'12345'},{phone:'12345'}]},take:2,select:{id:true}});
    db.user.findMany.mockResolvedValueOnce([{id:7n},{id:8n}]); expect(await merchantRoutedLoginReady(db,user)).toBe(false);
    db.user.findMany.mockResolvedValueOnce([{id:8n}]); expect(await merchantRoutedLoginReady(db,user)).toBe(false);
    db.user.findMany.mockResolvedValueOnce([]); expect(await merchantRoutedLoginReady(db,user)).toBe(false);
    db.user.findMany.mockClear();
    expect(await merchantRoutedLoginReady(db,{...user,loginName:'named-account'})).toBe(true);
    expect(await merchantRoutedLoginReady(db,{...user,email:'numeric@example.invalid'})).toBe(true);
    expect(await merchantRoutedLoginReady(db,{...user,passwordHash:'placeholder'})).toBe(false);
    expect(await merchantRoutedLoginReady(db,null)).toBe(false); expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

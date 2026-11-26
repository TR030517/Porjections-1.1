import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { shopPublication } from '../../common/shop-publication';
import { jwtSecret } from '../auth/security';
import { ensureShopConfiguration } from '../reservations/configuration-guard';
import type { IntakeField, IntakePreview, IntakeReceipt, IntakeShopPreview, IntakeTerminal } from './public-intake.contract';
import { intakeDigest, intakeEmpty, intakeEmptyHours, intakeError, intakeId, intakeRequestKey, intakeStable, isRecord, issue, parseIntakePackage, IntakeSource } from './public-intake.validation';

export type IntakeActor = { id: string; role: string };
const ACTION = 'PUBLIC_INTAKE_APPLY', TARGET = 'PUBLIC_INTAKE';
const fields: IntakeField[] = ['description','businessHours'];
const SIGN_DOMAIN = 'public-shop-intake-preview:v1:';
interface PreviewClaim { version: 1; actor: string; packageDigest: string; expires: number; snapshots: Array<{id:string;digest:string}>; }
const conflict = (code: string, message: string): never => { throw new ConflictException({message,publicIntakeCode:code}); };

/** Only public description/hours fill empty existing records. No actor/owner,
 * accounts, publication, media, service catalog, finance or legacy staging writes. */
@Injectable()
export class PublicIntakeService {
  constructor(private readonly prisma: PrismaService) {}
  private actorId(actor: IntakeActor) {
    if (!actor || actor.role !== 'ADMIN' || !intakeId(actor.id)) throw new ForbiddenException('仅公司管理员可导入门店公开资料');
    return BigInt(actor.id);
  }
  private async authorize(db: any, actor: IntakeActor) {
    const id=this.actorId(actor);
    if (!await db.user.findFirst({where:{id,role:'ADMIN',status:'ACTIVE',deletedAt:null},select:{id:true}})) throw new ForbiddenException('管理员账户不可用');
    return id;
  }
  private async load(db: any, id: string) {
    if (!intakeId(id)) return null;
    return db.shop.findUnique({where:{id:BigInt(id)},include:{loginBinding:{select:{user:{select:{role:true,status:true,deletedAt:true}}}}}});
  }
  private row(source: IntakeSource, target: any): IntakeShopPreview {
    const currentTarget = target && !target.deletedAt
      ? { name: target.name, shortName: target.shortName, address: target.address }
      : null;
    const result: IntakeShopPreview = {
      sourceId: source.sourceId, sourceUrls: source.sourceUrls, targetShopId: source.targetShopId,
      name: source.name, shortName: source.shortName, currentTarget, status: 'INVALID',
      issues: [...source.issues, ...source.warnings], fields: [], missing: [], rawCatalogItems: source.rawCatalogItems,
    };
    if (source.issues.length) return result;
    if (!target || target.deletedAt) {result.issues.push(issue('TARGET_NOT_FOUND','目标门店不存在或已删除'));return result;}
    if (target.name!==source.name || String(target.shortName??'').toLowerCase()!==source.shortName.toLowerCase()) {result.issues.push(issue('TARGET_MATCH_CHANGED','目标名称或短名与资料包不一致，请重新下载匹配模板核对'));return result;}
    const desired: Record<string,any>={};
    for (const field of fields) {
      if (source[field]===undefined) continue;
      const current=target[field]??null,incoming=source[field];
      const same=intakeStable(current)===intakeStable(incoming);
      const empty=field==='businessHours'?intakeEmptyHours(current):intakeEmpty(current);
      const state=same?'UNCHANGED':empty?'FILL':'KEEP_EXISTING';
      result.fields.push({field,state,current,incoming});
      if (state==='FILL') desired[field]=incoming;
      if (state==='KEEP_EXISTING') result.issues.push(issue('EXISTING_VALUE_KEPT','已有资料与来源不同，保留已有值，不覆盖',field));
    }
    result.missing=shopPublication({...target,...desired}).publicationChecklist.filter(x=>!x.complete).map(({key,label})=>({key,label}));
    result.status=result.fields.some(f=>f.state==='FILL')?'READY':'UNCHANGED';
    return result;
  }
  private sign(value: PreviewClaim) {
    const payload=Buffer.from(intakeStable(value)).toString('base64url');
    return payload+'.'+createHmac('sha256',jwtSecret()).update(SIGN_DOMAIN+payload).digest('base64url');
  }
  private verify(token: unknown, actor: IntakeActor, packageDigest: string): PreviewClaim {
    if(typeof token!=='string'||token.length>8192||! /^[\w-]+\.[\w-]+$/.test(token)) intakeError('PREVIEW_INVALID','请先生成有效的导入预览');
    const [payload,signature]=token.split('.'),expected=createHmac('sha256',jwtSecret()).update(SIGN_DOMAIN+payload).digest(),actual=Buffer.from(signature,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) intakeError('PREVIEW_INVALID','导入预览校验失败，请重新预览');
    let value:any;try {value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));} catch {intakeError('PREVIEW_INVALID','导入预览无效');}
    if(!isRecord(value)||value.version!==1||value.actor!==actor.id||value.packageDigest!==packageDigest||!Number.isSafeInteger(value.expires)
      ||!Array.isArray(value.snapshots)||value.snapshots.length<1||value.snapshots.length>20||value.snapshots.some((s:any)=>!isRecord(s)||!intakeId(s.id)||! /^[a-f0-9]{64}$/.test(s.digest))) intakeError('PREVIEW_MISMATCH','预览与当前账号或资料包不匹配');
    return value as PreviewClaim;
  }
  async preview(actor: IntakeActor, input: unknown): Promise<IntakePreview> {
    await this.authorize(this.prisma,actor);
    const parsed=parseIntakePackage(input),shops:IntakeShopPreview[]=[],snapshots:PreviewClaim['snapshots']=[];
    for(const source of parsed.sources){const target=await this.load(this.prisma,source.targetShopId);shops.push(this.row(source,target));if(target)snapshots.push({id:source.targetShopId,digest:intakeDigest(target)});}
    const allFields=shops.flatMap(s=>s.fields),invalidShops=shops.filter(s=>s.status==='INVALID').length,fillFields=allFields.filter(f=>f.state==='FILL').length;
    const canApply=invalidShops===0&&fillFields>0;
    const expires=Date.now()+15*60000;
    return {packageDigest:parsed.packageDigest,canApply,previewToken:canApply?this.sign({version:1,actor:actor.id,packageDigest:parsed.packageDigest,expires,snapshots}):null,expiresAt:canApply?new Date(expires).toISOString():null,
      summary:{shops:shops.length,readyShops:shops.filter(s=>s.status==='READY').length,fillFields,unchangedFields:allFields.filter(f=>f.state==='UNCHANGED').length,keptFields:allFields.filter(f=>f.state==='KEEP_EXISTING').length,invalidShops,rawCatalogItems:shops.reduce((n,s)=>n+s.rawCatalogItems,0)},shops};
  }
  private requestHash(actor: IntakeActor, key: unknown) {
    if(!intakeRequestKey(key)) intakeError('REQUEST_KEY_INVALID','请保留8至100位有效请求键');
    return createHmac('sha256',jwtSecret()).update('public-shop-intake-request:v1:'+actor.id+':'+key).digest('hex');
  }
  private async prior(db:any, actor:IntakeActor, keyHash:string) {
    const rows=await db.auditLog.findMany({where:{operatorId:this.actorId(actor),action:ACTION,targetType:TARGET,targetId:this.actorId(actor),detail:{path:'$.requestKeyHash',equals:keyHash}},orderBy:{id:'desc'},take:2,select:{detail:true}});
    if(rows.length>1) throw new ServiceUnavailableException('导入收据需要管理员核对，请保留请求键');
    return rows[0]?.detail??null;
  }
  private receipt(detail:any,key:string):IntakeReceipt {
    const r=detail?.receipt;
    if(!isRecord(r)||r.status!=='APPLIED'||typeof r.operationId!=='string'||! /^[a-f0-9-]{36}$/.test(r.operationId)||typeof r.appliedAt!=='string'||!Number.isFinite(Date.parse(r.appliedAt))
      ||typeof r.packageDigest!=='string'||! /^[a-f0-9]{64}$/.test(r.packageDigest)||!isRecord(r.summary)||!Array.isArray(r.shops)||r.shops.length<1||r.shops.length>20
      ||!['shops','changedShops','changedFields','unchangedShops'].every(k=>Number.isSafeInteger(r.summary[k])&&r.summary[k]>=0&&r.summary[k]<=40)
      ||r.summary.shops!==r.shops.length||r.shops.some((s:any)=>!isRecord(s)||!intakeId(s.sourceId)||!intakeId(s.targetShopId)||!Array.isArray(s.changedFields)||s.changedFields.length>2||new Set(s.changedFields).size!==s.changedFields.length||s.changedFields.some((f:any)=>!fields.includes(f)))
      ||new Set(r.shops.map((s:any)=>s.targetShopId)).size!==r.shops.length||new Set(r.shops.map((s:any)=>s.sourceId)).size!==r.shops.length
      ||r.summary.changedFields!==r.shops.reduce((n:number,s:any)=>n+s.changedFields.length,0)||r.summary.changedShops!==r.shops.filter((s:any)=>s.changedFields.length>0).length||r.summary.unchangedShops!==r.shops.length-r.summary.changedShops) throw new ServiceUnavailableException('导入收据暂不可用，请由公司核对');
    return {operationId:r.operationId,appliedAt:r.appliedAt,requestKey:key,packageDigest:r.packageDigest,summary:{shops:r.summary.shops,changedShops:r.summary.changedShops,changedFields:r.summary.changedFields,unchangedShops:r.summary.unchangedShops},shops:r.shops.map((s:any)=>({sourceId:s.sourceId,targetShopId:s.targetShopId,changedFields:[...s.changedFields]}))};
  }
  private terminal(detail:any,key:string):IntakeTerminal {
    if(detail?.state==='NOT_APPLIED'){
      if(typeof detail.packageDigest!=='string'||!/^[a-f0-9]{64}$/.test(detail.packageDigest)||typeof detail.resolvedAt!=='string'||!Number.isFinite(Date.parse(detail.resolvedAt))) throw new ServiceUnavailableException('导入收据暂不可用，请由公司核对');
      return {found:true,state:'NOT_APPLIED',requestKey:key,packageDigest:detail.packageDigest,resolvedAt:detail.resolvedAt};
    }
    return {found:true,state:'APPLIED',receipt:this.receipt(detail,key)};
  }
  private terminalDigest(terminal:IntakeTerminal){return terminal.state==='APPLIED'?terminal.receipt.packageDigest:terminal.packageDigest;}
  async result(actor:IntakeActor,key:string) {
    await this.authorize(this.prisma,actor);const hash=this.requestHash(actor,key),previous=await this.prior(this.prisma,actor,hash);
    return previous?this.terminal(previous,key):{found:false};
  }
  async resolve(actor:IntakeActor,key:string,packageDigest:string):Promise<IntakeTerminal>{
    const actorId=this.actorId(actor),keyHash=this.requestHash(actor,key);
    if(typeof packageDigest!=='string'||!/^[a-f0-9]{64}$/.test(packageDigest)) intakeError('PACKAGE_DIGEST_INVALID','请保留原请求的资料包摘要');
    return this.prisma.$transaction(async tx=>{
      // Resolve does not acquire shop locks or write shops: an apply waiting for
      // this actor must observe this terminal fence before its first mutation.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`);
      await this.authorize(tx,actor);
      const previous=await this.prior(tx,actor,keyHash);
      if(previous){const terminal=this.terminal(previous,key);if(this.terminalDigest(terminal)!==packageDigest) conflict('REQUEST_KEY_REUSED','该请求键对应不同资料包，请先核对原结果');return terminal;}
      const resolvedAt=new Date().toISOString();
      await tx.auditLog.create({data:{operatorId:actorId,action:ACTION,targetType:TARGET,targetId:actorId,detail:{version:1,requestKeyHash:keyHash,state:'NOT_APPLIED',packageDigest,resolvedAt}}});
      return {found:true,state:'NOT_APPLIED',requestKey:key,packageDigest,resolvedAt};
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:10000,timeout:30000});
  }
  async apply(actor:IntakeActor, input:unknown, previewToken:unknown,requestKey:string):Promise<IntakeReceipt&{replayed:boolean}> {
    const actorId=this.actorId(actor),keyHash=this.requestHash(actor,requestKey),parsed=parseIntakePackage(input);
    // Do not infer failure from an absent receipt while another transaction may
    // still be in flight. Under actor mutex, re-read prior before token expiry.
    const ids=[...new Set(parsed.sources.filter(s=>intakeId(s.targetShopId)).map(s=>BigInt(s.targetShopId)))].sort((a,b)=>a<b?-1:1);
    return this.prisma.$transaction(async tx=>{
      for(const id of ids) await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${id} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`);
      await this.authorize(tx,actor);
      const previous=await this.prior(tx,actor,keyHash);
      if(previous){const terminal=this.terminal(previous,requestKey);if(this.terminalDigest(terminal)!==parsed.packageDigest) conflict('REQUEST_KEY_REUSED','该请求键已用于不同资料包，请先核对原结果');if(terminal.state==='APPLIED')return {...terminal.receipt,replayed:true};return conflict('REQUEST_CLOSED','本次请求已核对为未导入并关闭，请重新预览后使用新请求键');}
      const claim=this.verify(previewToken,actor,parsed.packageDigest);
      if(claim.expires<Date.now()) conflict('PREVIEW_EXPIRED','导入预览已过期，请重新预览；若曾提交请先核对原结果');
      if(claim.snapshots.length!==parsed.sources.length||new Set(claim.snapshots.map(s=>s.id)).size!==parsed.sources.length) intakeError('PREVIEW_MISMATCH','资料包与预览门店不一致');
      const work:Array<{source:IntakeSource;target:any;view:IntakeShopPreview}>=[];
      for(const source of parsed.sources){
        const target=await this.load(tx,source.targetShopId),view=this.row(source,target),expected=claim.snapshots.find(s=>s.id===source.targetShopId);
        if(view.status==='INVALID') conflict('PACKAGE_HAS_INVALID_SHOPS','资料包包含无效或重复匹配的门店，请重新预览核对');
        if(!expected||intakeDigest(target)!==expected.digest) conflict('TARGET_CHANGED','门店资料已在预览后变更，本次未导入，请重新预览');
        work.push({source,target,view});
      }
      const changed=work.filter(w=>w.view.status==='READY');
      if(!changed.length) conflict('NOTHING_TO_IMPORT','没有可补空的字段，请核对已有资料');
      const planned=changed.map(w=>({...w,data:Object.fromEntries(w.view.fields.filter(f=>f.state==='FILL').map(f=>[f.field,f.incoming]))}));
      // Filling an empty legacy schedule still changes live reservation rules.
      // Re-read bookings under the same shop mutex as creation, and preflight
      // every target before the batch's first shop mutation.
      for(const w of planned) await ensureShopConfiguration(tx,w.target,w.data);
      const receipt:IntakeReceipt={operationId:randomUUID(),appliedAt:new Date().toISOString(),requestKey,packageDigest:parsed.packageDigest,
        summary:{shops:work.length,changedShops:changed.length,changedFields:changed.reduce((n,w)=>n+w.view.fields.filter(f=>f.state==='FILL').length,0),unchangedShops:work.length-changed.length},
        shops:work.map(w=>({sourceId:w.source.sourceId,targetShopId:w.source.targetShopId,changedFields:w.view.fields.filter(f=>f.state==='FILL').map(f=>f.field)}))};
      for(const w of planned){
        const data=w.data;
        const saved=await tx.shop.update({where:{id:w.target.id},data});
        if(Object.entries(data).some(([field,value])=>intakeStable(saved[field as keyof typeof saved])!==intakeStable(value))) throw new ServiceUnavailableException('保存核对失败，本次未导入');
      }
      const {requestKey:_notStored,...safeReceipt}=receipt;
      await tx.auditLog.create({data:{operatorId:actorId,action:ACTION,targetType:TARGET,targetId:actorId,detail:{version:1,requestKeyHash:keyHash,sourceSystem:'massajoy1',batchId:parsed.batchId,capturedAt:parsed.capturedAt,packageDigest:parsed.packageDigest,receipt:{...safeReceipt,status:'APPLIED'}}}});
      return {...receipt,replayed:false};
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:10000,timeout:30000});
  }
}

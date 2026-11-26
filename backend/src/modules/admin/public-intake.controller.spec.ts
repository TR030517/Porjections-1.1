/** Actual Nest route, JWT verification, role guard and strict DTO handling.
 * Business service is isolated here; transaction semantics are tested separately. */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PublicIntakeController } from './public-intake.controller';
import { PublicIntakeService } from './public-intake.service';
import { RolesGuard } from '../../common/guards/roles.guard';
const request=require('supertest');
const secret='Synthetic-Intake-Route-Only-2026-abcdef0123456789';
@Injectable()
class RouteJwt extends PassportStrategy(Strategy,'jwt'){
  constructor(){super({jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),secretOrKey:secret,algorithms:['HS256']});}
  validate(p:any){return {id:p.sub,role:p.role};}
}
describe('public intake ADMIN HTTP boundary',()=>{
  let app:INestApplication,jwt:JwtService;
  const service={preview:jest.fn(async()=>({canApply:false})),apply:jest.fn(async()=>({replayed:false})),result:jest.fn(async()=>({found:false})),resolve:jest.fn(async()=>({found:true,state:'NOT_APPLIED'}))};
  const body={package:{schemaVersion:1}},key='http-intake-key',digest='a'.repeat(64),base='/api/v1/admin/public-intake';
  beforeAll(async()=>{const module=await Test.createTestingModule({imports:[PassportModule,JwtModule.register({secret})],controllers:[PublicIntakeController],providers:[RouteJwt,RolesGuard,{provide:PublicIntakeService,useValue:service}]}).compile();app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();jwt=module.get(JwtService);});
  beforeEach(()=>jest.clearAllMocks());afterAll(async()=>{await app.close();});
  const routes=()=>[['post','/preview',body],['post','/apply',{...body,previewToken:'synthetic',requestKey:key}],['post','/resolve',{requestKey:key,packageDigest:digest}],['get','/result/'+key,undefined]] as const;
  const call=(method:string,path:string,payload:any,token?:string)=>{let pending=request(app.getHttpServer())[method](base+path);if(token)pending=pending.set('Authorization','Bearer '+token);return payload?pending.send(payload):pending;};
  test.each(['ANONYMOUS','MERCHANT','CUSTOMER','STAFF'])('%s cannot reach any intake operation',async role=>{for(const [method,path,payload]of routes())expect((await call(method,path,payload,role==='ANONYMOUS'?undefined:jwt.sign({sub:'7',role}))).status).toBe(role==='ANONYMOUS'?401:403);for(const fn of Object.values(service))expect(fn).not.toHaveBeenCalled();});
  test('ADMIN receives HTTP200 no-store and service actor comes exclusively from verified JWT',async()=>{const token=jwt.sign({sub:'7',role:'ADMIN'});for(const [method,path,payload]of routes()){const r=await call(method,path,payload,token);expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');}expect(service.preview).toHaveBeenCalledWith({id:'7',role:'ADMIN'},body.package);expect(service.apply).toHaveBeenCalledWith({id:'7',role:'ADMIN'},body.package,'synthetic',key);expect(service.resolve).toHaveBeenCalledWith({id:'7',role:'ADMIN'},key,digest);expect(service.result).toHaveBeenCalledWith({id:'7',role:'ADMIN'},key);});
  test('foreign actor/options, missing objects, invalid key/digest and forged JWT never reach service',async()=>{const token=jwt.sign({sub:'7',role:'ADMIN'});for(const [path,payload]of [['/preview',{...body,actorId:'99'}],['/preview',{package:[]}],['/apply',{...body,previewToken:'x',requestKey:'bad'}],['/apply',{...body,previewToken:'x',requestKey:key,overwrite:true}],['/resolve',{requestKey:key,packageDigest:'BAD'}],['/resolve',{requestKey:key,packageDigest:digest,actor:{id:'99'}}]] as any[])expect((await call('post',path,payload,token)).status).toBe(400);expect((await call('post','/preview',body,token.slice(0,-10)+'AAAAAAAAAA')).status).toBe(401);for(const fn of Object.values(service))expect(fn).not.toHaveBeenCalled();});
});

import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ShopReadinessController } from './shop-readiness.controller';
import { ShopReadinessService } from './shop-readiness.service';
const request=require('supertest');
const secret='Synthetic-Readiness-Route-Only-2026-abcdef0123456789';
@Injectable()
class RouteJwt extends PassportStrategy(Strategy,'jwt'){
  constructor(){super({jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),secretOrKey:secret,algorithms:['HS256']});}
  validate(payload:any){return{id:payload.sub,role:payload.role};}
}
describe('shop readiness ADMIN HTTP route',()=>{
  let app:INestApplication,jwt:JwtService;const service={get:jest.fn(async()=>({schemaVersion:1}))};
  beforeAll(async()=>{const module=await Test.createTestingModule({imports:[PassportModule,JwtModule.register({secret})],controllers:[ShopReadinessController],providers:[RouteJwt,RolesGuard,{provide:ShopReadinessService,useValue:service}]}).compile();app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');await app.init();jwt=module.get(JwtService);});
  beforeEach(()=>jest.clearAllMocks());afterAll(async()=>{await app.close();});
  test.each(['ANONYMOUS','MERCHANT','STAFF','CUSTOMER'])('%s cannot inspect another shop',async role=>{
    const call=request(app.getHttpServer()).get('/api/v1/admin/shop-readiness/11');if(role!=='ANONYMOUS')call.set('Authorization','Bearer '+jwt.sign({sub:'7',role}));
    expect((await call).status).toBe(role==='ANONYMOUS'?401:403);expect(service.get).not.toHaveBeenCalled();
  });
  test('ADMIN uses verified actor, exact route shop, HTTP200 and no-store',async()=>{
    const result=await request(app.getHttpServer()).get('/api/v1/admin/shop-readiness/11?actorId=99').set('Authorization','Bearer '+jwt.sign({sub:'7',role:'ADMIN'}));
    expect(result.status).toBe(200);expect(result.headers['cache-control']).toBe('no-store');expect(service.get).toHaveBeenCalledWith({id:'7',role:'ADMIN'},'11');
  });
  test('forged JWT and mutation HTTP methods cannot reach read-only service',async()=>{
    const token=jwt.sign({sub:'7',role:'ADMIN'}),base='/api/v1/admin/shop-readiness/11';
    expect((await request(app.getHttpServer()).get(base).set('Authorization','Bearer '+token.slice(0,-10)+'AAAAAAAAAA')).status).toBe(401);
    for(const method of ['post','patch','delete'])expect((await request(app.getHttpServer())[method](base).set('Authorization','Bearer '+token).send({status:'APPROVED'})).status).toBe(404);
    expect(service.get).not.toHaveBeenCalled();
  });
});

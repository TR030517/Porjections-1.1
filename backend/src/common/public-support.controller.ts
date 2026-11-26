import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export function publicSupport(rows: Array<{ key:string;value:string }>) {
  const values = new Map(rows.map(row => [row.key,row.value.trim()]));
  const email=values.get('support_email') ?? '', phone=values.get('support_phone') ?? '';
  return { siteName: (values.get('site_name') || 'Massajoy').slice(0,200),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length<=255 ? email : null,
    phone: phone && /^[+\d() .-]+$/.test(phone) && phone.replace(/\D/g,'').length>=7 && phone.replace(/\D/g,'').length<=15 ? phone : null };
}
/** An explicit public whitelist; private platform configuration is never serialized here. */
@Controller('public/support')
export class PublicSupportController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async get() {
    return publicSupport(await this.prisma.platformConfig.findMany({where:{isPublic:true,key:{in:['site_name','support_email','support_phone']}},select:{key:true,value:true}}));
  }
}

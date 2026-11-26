import { promises as fs } from 'node:fs';
import os = require('node:os');
import path = require('node:path');
const sharp: typeof import('sharp').default = require('sharp');
import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sanitizeImage,MAX_IMAGE_BYTES } from './image-validation';
import { MediaStorage } from './media-storage';
import { managedMediaId,mediaUrl,syncShopMedia,validateMediaUrl } from '../../common/managed-media';
import { UploadService, type MediaRow } from './upload.service';

describe('real image decode and re-encoding (synthetic files, no provider)',()=>{
  test.each(['jpeg','png','webp'] as const)('accepts genuine %s and emits metadata-free WebP',async format=>{
    const input=await sharp({create:{width:12,height:8,channels:3,background:'#48a1a1'}}).withMetadata({exif:{IFD0:{Copyright:'SYNTHETIC_PRIVATE_METADATA'}}}).toFormat(format).toBuffer();
    const output=await sanitizeImage(input,format==='jpeg'?'image/jpeg':`image/${format}`),metadata=await sharp(output.buffer).metadata();
    expect(output.mimeType).toBe('image/webp');expect(metadata.format).toBe('webp');expect(metadata.width).toBe(12);expect(metadata.exif).toBeUndefined();expect(output.buffer.includes(Buffer.from('SYNTHETIC_PRIVATE_METADATA'))).toBe(false);
  });
  test('rejects mismatch, SVG/HTML, truncated headers and excess bytes before storing',async()=>{
    const png=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
    for(const [buffer,mime]of[[png,'image/jpeg'],[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/svg+xml'],[Buffer.from('<!doctype html><script>x</script>'),'image/png'],[png.subarray(0,12),'image/png'],[Buffer.alloc(MAX_IMAGE_BYTES+1),'image/png']]as const)await expect(sanitizeImage(buffer,mime)).rejects.toThrow();
  });
  test('rejects a decodable image whose edge exceeds the configured bound',async()=>{
    const buffer=await sharp({create:{width:8193,height:1,channels:3,background:'black'}}).png().toBuffer();await expect(sanitizeImage(buffer,'image/png')).rejects.toThrow('dimensions');
  });
});
describe('managed URL and same-shop binding',()=>{
  test('only exact managed namespace or existing strict HTTPS is valid',()=>{
    const value=mediaUrl('00000000-0000-0000-0000-000000000001');expect(validateMediaUrl(value)).toBe(value);expect(managedMediaId(value)).toBe('00000000-0000-0000-0000-000000000001');expect(validateMediaUrl('https://example.invalid/a.webp')).toBe('https://example.invalid/a.webp');
    for(const bad of['javascript:x','data:image/png,abc','http://example.invalid/a','//example.invalid/a','/uploads/a','https://user:password@example.invalid/a','https://example.invalid/a b',' https://example.invalid/a','https://example.invalid/\\a',value+'?x=1','https://example.invalid/'+ 'a'.repeat(500)])expect(()=>validateMediaUrl(bad)).toThrow();
  });
  function tx(row:any){return{shop:{findFirst:async()=>({ownerId:1n})},$queryRaw:jest.fn(async(q:any)=>q.strings.join('').includes('FROM media_assets')?[row]:[]),$executeRaw:jest.fn(async()=>1)};}
  test.each([{shop_id:9n},{owner_id:2n},{shop_owner_id:2n},{status:'DELETED'},{expires_at:new Date(0)}])('staged binding rejects foreign shop/uploader/owner snapshot/expiry',async patch=>{
    const db=tx({id:'00000000-0000-0000-0000-000000000001',scope:'SHOP',status:'STAGED',shop_id:1n,owner_id:1n,shop_owner_id:1n,expires_at:new Date(Date.now()+60000),...patch});
    await expect(syncShopMedia(db as any,{shopId:'1',actor:{id:'1',role:'MERCHANT'},previousUrls:[],nextUrls:[mediaUrl('00000000-0000-0000-0000-000000000001')]})).rejects.toThrow();expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  test('staff cannot bind even an existing same-shop image',async()=>{await expect(syncShopMedia({}as any,{shopId:'1',actor:{id:'1',role:'STAFF'},previousUrls:[],nextUrls:[]})).rejects.toThrow('Only shop owner');});
});
describe('explicit local storage and legacy bypass closure',()=>{
  test('disabled/relative storage configuration never fabricates URLs or writes',async()=>{expect(new MediaStorage({MEDIA_STORAGE_DRIVER:'local',MEDIA_LOCAL_DIR:'relative'}).available()).toBe(false);await expect(new MediaStorage({}).put(randomUUID()+'.webp',Buffer.from('x'))).rejects.toThrow('NOT_CONFIGURED');});
  test('local files use random keys; traversal and symlink reads are rejected',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'massajoy-media-unit-'));const storage=new MediaStorage({MEDIA_STORAGE_DRIVER:'local',MEDIA_LOCAL_DIR:directory}),key=randomUUID()+'.webp';
    try{await storage.put(key,Buffer.from('synthetic bytes'));expect((await storage.read(key)).toString()).toBe('synthetic bytes');await expect(storage.put(key,Buffer.from('overwrite'))).rejects.toThrow('WRITE_FAILED');await expect(storage.read('../file')).rejects.toThrow('KEY');await storage.remove(key);await storage.remove(key);expect(await fs.readdir(directory)).toEqual([]);}finally{await fs.rm(directory,{recursive:true,force:true});}
  });
  test('legacy pre-sign and HEAD-only confirm are explicitly disabled',()=>{const service=new UploadService({}as any);expect(()=>service.generateAvatarPresignedUrl('1','png')).toThrow('DIRECT_UPLOAD_DISABLED');expect(()=>service.confirmAvatar('1','https://example.invalid/x')).toThrow('DIRECT_AVATAR_CONFIRM_DISABLED');});
});

describe('shop upload retry outcomes', () => {
  const actor = { id: '1', role: 'ADMIN' };
  const target = { scope: 'SHOP', shopId: '2', purpose: 'logo', requestKey: 'same-file-test' } as const;
  const mediaId = '00000000-0000-4000-8000-000000000001';
  let file: { buffer: Buffer; mimetype: string }, inputHash: string;

  beforeAll(async () => {
    file = { buffer: await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer(), mimetype: 'image/png' };
    const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
    inputHash = hash(JSON.stringify({ scope: target.scope, shopId: target.shopId, purpose: target.purpose, mime: file.mimetype, sha: hash(file.buffer) }));
  });

  function fixture(status?: string, expired = false) {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      shop: { findFirst: jest.fn().mockResolvedValue({ ownerId: 3n }) },
      $queryRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
        const query = sql.strings.join('');
        if (query.includes('request_key=')) return status ? [row] : [];
        if (query.includes('COUNT(*) active')) return [{ active: 0n, staged: 0n, bytes: 0n }];
        if (query.includes('FROM media_assets')) return [row];
        return [];
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const database = { $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)), $executeRaw: jest.fn().mockResolvedValue(1) };
    const service = new UploadService(database as any);
    const row = {
      id: mediaId, owner_id: 1n, shop_id: 2n, shop_owner_id: 3n, scope: 'SHOP', status: status ?? 'UPLOADING',
      expires_at: new Date(Date.now() + (expired ? -60000 : 60000)), storage_driver: service.storage.driver,
      storage_namespace: service.storage.namespace, object_key: `${mediaId}.webp`, input_hash: inputHash,
    } as MediaRow;
    jest.spyOn(service.storage, 'require').mockImplementation(() => undefined);
    const put = jest.spyOn(service.storage, 'put').mockResolvedValue(undefined);
    return { service, database, put, tx };
  }

  test.each([
    ['UPLOADING', false, 'SHOP_MEDIA_UPLOAD_PENDING'],
    ['STAGED', true, 'SHOP_MEDIA_UPLOAD_TERMINAL'],
    ['ABANDONED', false, 'SHOP_MEDIA_UPLOAD_TERMINAL'],
    ['DELETING', false, 'SHOP_MEDIA_UPLOAD_TERMINAL'],
    ['DELETED', false, 'SHOP_MEDIA_UPLOAD_TERMINAL'],
  ] as const)('reports %s (expired=%s) consistently for replay and confirmation', async (status, expired, code) => {
    const retry = fixture(status, expired);
    for (const result of [() => retry.service.upload(actor, target, file), () => retry.service.confirm(actor, mediaId)]) {
      await expect(result()).rejects.toMatchObject({ status: 409, response: { code } });
    }
    expect(retry.tx.$executeRaw).not.toHaveBeenCalled();
    expect(retry.put).not.toHaveBeenCalled();
  });

  test('certifies a failed storage write as terminal only after the database acknowledges its abandonment', async () => {
    const writeError = new Error('Synthetic media storage failure');
    const confirmed = fixture();
    confirmed.put.mockRejectedValueOnce(writeError);
    await expect(confirmed.service.upload(actor, target, file)).rejects.toMatchObject({ status: 503, response: { code: 'SHOP_MEDIA_UPLOAD_TERMINAL' } });
    expect(confirmed.database.$executeRaw.mock.calls[0][0].strings.join('')).toContain("status='ABANDONED'");

    const uncertain = fixture();
    uncertain.put.mockRejectedValueOnce(writeError);
    uncertain.database.$executeRaw.mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(uncertain.service.upload(actor, target, file)).rejects.toBe(writeError);
  });
});

describe('shop price display images', () => {
  test('an associated merchant can stage, confirm, preview and discard a menu image with catalog permission', async () => {
    const actor = { id: '1', role: 'MERCHANT' };
    const target = { scope: 'SHOP', shopId: '2', purpose: 'menu', requestKey: 'menu-image-test' } as const;
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    const file = { buffer, mimetype: 'image/png' };
    const activeMerchant = { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null };
    const grant = { sourceShopId: 3n, permissions: ['CATALOG_MANAGE'] };
    let row: MediaRow | undefined;
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      shop: { findFirst: jest.fn().mockResolvedValue({ ownerId: 3n, loginBinding: { userId: 3n, user: activeMerchant } }) },
      shopAccountGrant: { findFirst: jest.fn().mockResolvedValue(grant) },
      $queryRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
        const query = sql.strings.join('');
        if (query.includes('request_key=')) return row?.request_key === sql.values[1] ? [row] : [];
        if (query.includes('COUNT(*) active')) return [{ active: 0n, staged: 0n, bytes: 0n }];
        return query.includes('FROM media_assets') && row?.id === sql.values[0] ? [row] : [];
      }),
      $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
        const query = sql.strings.join('');
        if (query.includes('INSERT INTO media_assets')) {
          const [id, ownerId, shopId, shopOwnerId, scope, purpose, key, inputHash, contentHash, driver, namespace, objectKey, size, width, height, lease] = sql.values;
          row = {
            id, owner_id: ownerId, shop_id: shopId, shop_owner_id: shopOwnerId, scope, purpose, request_key: key, input_hash: inputHash, content_hash: contentHash,
            storage_driver: driver, storage_namespace: namespace, object_key: objectKey, size_bytes: size, width, height, lease_token: lease,
            mime_type: 'image/webp', status: 'UPLOADING', expires_at: new Date(Date.now() + 60000),
          } as MediaRow;
        } else if (query.includes("status='ABANDONED'") && row) row.status = 'ABANDONED';
        return 1;
      }),
    };
    const db = {
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
      $executeRaw: jest.fn(async () => {
        if (row) row.status = 'STAGED';
        return 1;
      }),
      $queryRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
        if (!row || row.id !== sql.values[0]) return [];
        if (sql.strings.join('').includes("status='BOUND'") && row.status !== 'BOUND') return [];
        return [row];
      }),
    };
    const service = new UploadService(db as any);
    const objects = new Map<string, Buffer>();
    jest.spyOn(service.storage, 'require').mockImplementation(() => undefined);
    const put = jest.spyOn(service.storage, 'put').mockImplementation(async (key, bytes) => { objects.set(key, bytes); });
    jest.spyOn(service.storage, 'read').mockImplementation(async key => Buffer.from(objects.get(key)!));

    await expect(service.upload(actor, { ...target, purpose: 'gallery' }, file)).rejects.toThrow(ForbiddenException);
    expect(put).not.toHaveBeenCalled();
    const staged = await service.upload(actor, target, file);
    expect(staged.item).toMatchObject({ shopId: '2', purpose: 'menu', status: 'STAGED' });
    await expect(service.confirm(actor, staged.item.id)).resolves.toEqual({ item: staged.item });
    await expect(service.preview(actor, staged.item.id)).resolves.toEqual(objects.get(staged.item.id + '.webp'));
    await expect(service.file(staged.item.id)).rejects.toThrow(NotFoundException);
    await expect(service.upload(actor, target, file)).resolves.toEqual({ item: staged.item, replayed: true });
    expect(put).toHaveBeenCalledTimes(1);

    grant.permissions = ['SHOP_SETTINGS_MANAGE'];
    await expect(service.upload(actor, { ...target, requestKey: 'next-menu-image' }, file)).rejects.toThrow(ForbiddenException);
    await expect(service.confirm(actor, staged.item.id)).rejects.toThrow(ForbiddenException);
    await expect(service.preview(actor, staged.item.id)).rejects.toThrow(ForbiddenException);
    await expect(service.abandon(actor, staged.item.id)).rejects.toThrow(ForbiddenException);
    grant.permissions = ['CATALOG_MANAGE'];
    await expect(service.abandon(actor, staged.item.id)).resolves.toEqual({ abandoned: true });
    expect(row?.status).toBe('ABANDONED');
  });
});

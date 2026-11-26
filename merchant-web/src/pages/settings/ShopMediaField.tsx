import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Image, Input, Space, Typography } from 'antd';
import { MANAGED_MEDIA_PATH, ShopMediaUploadRecoveryError, type ShopProfileMediaPurpose, type UploadedShopMedia } from '../../../../src/utils/mediaDraft';
import { errorMessage } from '../../utils/feedback';

export function safeShopImage(value:string) {
  const raw=value.trim();if(MANAGED_MEDIA_PATH.test(raw))return raw;
  if(raw.length>500||/[\s\\\u0000-\u001f\u007f]/u.test(raw))return null;
  try{const url=new URL(raw);return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export const mediaLines=(value:string)=>[...new Set(value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean))];
type ShopMediaFieldProps = {
  purpose: ShopProfileMediaPurpose;
  value?: string;
  onChange?: (value: string) => void;
  disabled: boolean;
  upload: (file: File, purpose: ShopProfileMediaPurpose) => Promise<UploadedShopMedia>;
  previewUrls: ReadonlyMap<string, string>;
};

export default function ShopMediaField({purpose,value='',onChange,disabled,upload,previewUrls}: ShopMediaFieldProps) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [restartUpload, setRestartUpload] = useState(false);
  const alive=useRef(true),file=useRef<File|null>(null),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const run=async(selected:File)=>{if(disabled||busy)return;file.current=selected;setBusy(true);setError('');setRestartUpload(false);setNotice('');
    try {
      const { url, replacesUrl } = await upload(selected, purpose);
      if (!alive.current) return;
      const gallery = mediaLines(value).map(item => item === replacesUrl ? url : item);
      const urls = purpose === 'gallery' ? mediaLines([...gallery, url].join('\n')) : [url];
      if (urls.length > 20) throw new Error('相册最多支持20张图片，请先移除图片再尝试。');
      onChange?.(urls.join('\n'));
      file.current = null;
      setNotice('已上传到草稿，保存设置后才会关联门店。');
    } catch (error) {
      if (alive.current) {
        setRestartUpload(error instanceof ShopMediaUploadRecoveryError && error.restart);
        setError(errorMessage(error));
      }
    } finally { if (alive.current) setBusy(false); }
  };
  const changeValue=(next:string)=>{
    if(disabled||busy)return;
    // A deliberate replacement/removal ends the previous failed upload intent.
    // Retrying is available only while its original draft remains untouched.
    file.current=null;setError('');setNotice('');onChange?.(next);
  };
  const purposeLabel = { logo: '标志', cover: '封面', gallery: '相册' }[purpose];
  const urls=purpose==='gallery'?mediaLines(value):value.trim()?[value.trim()]:[];
  return <div style={{display:'grid',gap:12,minWidth:0}}>
    <Space wrap><input ref={input} type="file" aria-label={`上传门店${purposeLabel}`} accept="image/jpeg,image/png,image/webp" hidden disabled={disabled||busy} onChange={event=>{const selected=event.target.files?.[0];event.target.value='';if(selected)void run(selected);}} /><Button loading={busy} disabled={disabled||(purpose==='gallery'&&urls.length>=20)} onClick={()=>input.current?.click()}>上传图片文件</Button>{error&&file.current&&<Button disabled={disabled||busy} onClick={()=>{if(file.current)void run(file.current);}}>{restartUpload ? '重新上传原文件' : '重试原文件'}</Button>}<Button disabled={disabled||busy||!value} onClick={()=>changeValue('')}>清空 {purpose==='gallery'?'相册':'图片'}</Button></Space>
    <Typography.Text type="secondary">支持JPEG、PNG或WebP，最大8MiB、单边8192像素、总像素2500万。上传后暂存，明确保存后才关联；放弃草稿会移除本次未使用文件。</Typography.Text>
    {error&&<Alert type="error" showIcon title={error} description="现有图片与其他草稿字段保持不变。" />}{notice&&<Alert type="info" showIcon title={notice} />}
    {purpose==='gallery'?<Input.TextArea rows={3} value={value} disabled={disabled||busy} onChange={event=>changeValue(event.target.value)} placeholder="每行一个HTTPS地址或服务器返回的受管图片地址" aria-label="相册图片地址" />:<Input value={value} disabled={disabled||busy} maxLength={500} onChange={event=>changeValue(event.target.value)} placeholder="HTTPS地址或服务器返回的受管图片地址" aria-label={`${purposeLabel}图片地址`} />}
    {!!urls.length&&<div style={{display:'grid',gridTemplateColumns:purpose==='gallery'?'repeat(auto-fill,minmax(150px,1fr))':'minmax(0,280px)',gap:12}}>{urls.map((url,index)=>{
      const imageUrl = safeShopImage(url);
      return <div key={url+index} style={{minWidth:0,padding:12,border:'1px solid #e5eaf0',borderRadius:12,background:'#f5f7fa'}}>
        {imageUrl?<Image src={previewUrls.get(url) ?? imageUrl} alt={`门店${purposeLabel} ${index+1}`} width="100%" height={purpose==='logo'?110:135} style={{objectFit:purpose==='logo'?'contain':'cover'}} preview={false} />:<Typography.Text type="secondary">请修正图片地址</Typography.Text>}
        {purpose==='gallery'&&<Space wrap style={{marginTop:8}}><Button size="small" disabled={disabled||busy||index===0} onClick={()=>{const next=[...urls];[next[index-1],next[index]]=[next[index],next[index-1]];changeValue(next.join('\n'));}}>前移</Button><Button size="small" disabled={disabled||busy||index===urls.length-1} onClick={()=>{const next=[...urls];[next[index+1],next[index]]=[next[index],next[index+1]];changeValue(next.join('\n'));}}>后移</Button><Button size="small" danger disabled={disabled||busy} onClick={()=>changeValue(urls.filter((_,itemIndex)=>itemIndex!==index).join('\n'))}>移除</Button></Space>}
      </div>;
    })}</div>}
  </div>;
}

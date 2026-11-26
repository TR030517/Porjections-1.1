import { useEffect, useRef, useState } from 'react';
import type { PriceMenuItem } from '../../utils/priceMenu';
import { PRICE_MENU_CATALOG, PRICE_MENU_CATALOG_ITEMS } from '../../utils/priceMenuCatalog';
import { formatPriceMenuDollars, formatPriceMenuTitle, PRICE_MENU_KINDS, priceMenuKindLabel, type PriceMenuPricing } from '../../utils/priceMenuPricing';
import PriceMenuSuggestionInput from './PriceMenuSuggestionInput';

function PriceInput({value,onChange,disabled,label}:{value:number|null;onChange:(value:number|null)=>void;disabled:boolean;label:string}) {
  const [text,setText]=useState(value===null?'':formatPriceMenuDollars(value));const focused=useRef(false);
  useEffect(()=>{if(!focused.current)setText(value===null?'':formatPriceMenuDollars(value));},[value]);
  const valid=/^(?:0|[1-9]\d{0,5})(?:\.\d{0,2})?$/.test(text);
  return <label><span>价格（美元） *</span><input aria-label={label} inputMode="decimal" value={text} disabled={disabled} placeholder="例如 50" aria-invalid={text!==''&&!valid} onFocus={()=>{focused.current=true;}} onBlur={()=>{focused.current=false;}} onChange={event=>{const raw=event.target.value;setText(raw);if(/^(?:0|[1-9]\d{0,5})(?:\.\d{0,2})?$/.test(raw)){const [whole,fraction='']=raw.split('.');onChange(Number(whole)*100+Number(fraction.padEnd(2,'0')));}else onChange(null);}} /></label>;
}

export default function PriceMenuItemPricingFields({entryItem,category,itemIndex,disabled,onPricing,onTitle,onConvert}:{
  entryItem:PriceMenuItem;category:string;itemIndex:number;disabled:boolean;
  onPricing:(patch:Partial<PriceMenuPricing>)=>void;onTitle:(value:string)=>void;onConvert:()=>void;
}) {
  const pricing=entryItem.pricing,prefix=`本组第 ${itemIndex+1} 项`;
  if(!pricing)return <div className="price-menu-legacy-title price-menu-wide"><span>现有完整项目标题</span><p>{entryItem.name}{entryItem.priceText?` · ${entryItem.priceText}`:''}</p><button type="button" disabled={disabled} onClick={onConvert}>设置项目类型、时长和价格</button><small>现有内容原样保留；明确设置后使用新的项目标题格式。</small></div>;
  const suggestions=[...(PRICE_MENU_CATALOG.find(group=>group.category===category)?.items??[]),...PRICE_MENU_CATALOG_ITEMS].filter((option,index,all)=>all.findIndex(other=>other.id===option.id)===index).map(option=>({value:option.name,label:option.nameZh,keywords:option.keywords}));
  return <>
    <label className="price-menu-wide"><span>项目名称（基础名称） *</span><PriceMenuSuggestionInput disabled={disabled} openOnFocus={false} label={`${prefix}基础名称`} maxLength={200} value={pricing.baseName} placeholder="例如 Body Massage / Deep Tissue Massage" suggestions={suggestions} onChange={baseName=>onPricing({baseName})} /></label>
    <label><span>项目类型</span><select disabled={disabled} aria-label={`${prefix}项目类型`} value={pricing.kind} onChange={event=>onPricing({kind:event.target.value as PriceMenuPricing['kind'],durationMin:null})}>{PRICE_MENU_KINDS.map(kind=><option key={kind} value={kind}>{priceMenuKindLabel(kind)}</option>)}</select></label>
    {pricing.kind==='TIMED'&&<label><span>时长（分钟） *</span><input aria-label={`${prefix}时长分钟`} disabled={disabled} inputMode="numeric" value={pricing.durationMin??''} placeholder="例如 30" onChange={event=>onPricing({durationMin:/^[1-9]\d{0,3}$/.test(event.target.value)?Number(event.target.value):null})} /></label>}
    <PriceInput value={pricing.priceCents} disabled={disabled} label={`${prefix}价格美元`} onChange={priceCents=>onPricing({priceCents})} />
    {pricing.kind!=='TIMED'&&<p className="price-menu-wide price-menu-kind-help">{pricing.kind==='PER_SESSION'?'按一次服务计价；线上预约单独开启，并明确填写预约占用时间。':pricing.kind==='VARIABLE'?'实际服务时长不固定；线上预约单独开启，并明确填写预约占用时间。':'附属于主项目：加价，不增加总时长，不能单独预约。请在下方选择主项目。'}</p>}
    <div className="price-menu-wide price-menu-title-preview"><span>完整项目标题</span><strong>{entryItem.name||formatPriceMenuTitle(pricing)||'请填写项目名称'}</strong><div className="price-menu-actions"><button type="button" disabled={disabled} onClick={()=>onPricing({titleMode:pricing.titleMode==='AUTO'?'CUSTOM':'AUTO'})}>{pricing.titleMode==='AUTO'?'手动修改标题':'恢复自动标题'}</button></div>
      {pricing.titleMode==='CUSTOM'&&<input aria-label={`${prefix}自定义标题`} disabled={disabled} maxLength={300} value={entryItem.name} onChange={event=>onTitle(event.target.value)} />}
      <small>{pricing.titleMode==='AUTO'?'名称、时长和价格变化时同步生成；新增按数值步长递增。':'当前为自定义标题；新增项会按新参数恢复自动生成，避免沿用旧价格文字。'}</small>
    </div>
  </>;
}

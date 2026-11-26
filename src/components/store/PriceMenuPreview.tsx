import { type CSSProperties, useId, useState } from 'react';
import { safePriceMenuImage, type PriceMenuGroup, type PriceMenuItem } from '../../utils/priceMenu';
import { formatPriceMenuDollars, formatPriceMenuTitle, matchesPriceMenuAutoTitle, normalizePriceMenuPricing, priceMenuKindLabel, type PriceMenuPricing } from '../../utils/priceMenuPricing';
import './PriceMenuPreview.css';

const GROUP_BATCH = 3, ITEM_BATCH = 6;

type PublishedPricing = PriceMenuPricing & { priceCents: number };
function publishedPricing(item: PriceMenuItem): PublishedPricing | null {
  if (!Object.hasOwn(item, 'pricing')) return null;
  try {
    const pricing = normalizePriceMenuPricing(item.pricing);
    // A malformed new-format item must never hide existing literal price text.
    if (pricing.priceCents === null || item.priceText !== '' || !item.name.trim()
      || pricing.titleMode === 'AUTO' && !matchesPriceMenuAutoTitle(item.name, pricing)) return null;
    return { ...pricing, priceCents: pricing.priceCents };
  } catch { return null; }
}
function pricingBadge(pricing: PublishedPricing, language: 'en' | 'zh'): string {
  const kind = priceMenuKindLabel(pricing.kind, language);
  if (pricing.titleMode !== 'CUSTOM') return kind;
  const amount = `${pricing.kind === 'ADD_ON' ? '+' : ''}$${formatPriceMenuDollars(pricing.priceCents)}`;
  return pricing.kind === 'TIMED'
    ? `${pricing.durationMin} ${language === 'zh' ? '分钟' : 'min'} · ${amount}`
    : `${kind} · ${amount}`;
}

/** View state only: the complete menu stays owned by its editor or signed copy plan. */
export default function PriceMenuPreview({ value, language = 'en', showImages = true, accentColor }: {
  value: PriceMenuGroup[]; language?: 'en' | 'zh'; showImages?: boolean; accentColor?: string;
}) {
  const id = useId(), chinese = language === 'zh';
  const [groupLimit, setGroupLimit] = useState(GROUP_BATCH);
  const [itemLimits, setItemLimits] = useState<Record<number, number>>({});
  const total = value.reduce((sum, group) => sum + group.items.length, 0);
  const groups = value.slice(0, groupLimit);
  return <div className="menu-preview" style={{ ...(accentColor ? { '--menu-accent': accentColor } : {}), '--menu-button-radius': '8px' } as CSSProperties}>
    <p className="menu-preview-count" role="status">{chinese
      ? `${value.length} 个分组 · ${total} 个项目；当前显示 ${groups.length} 个分组`
      : `${total} services in ${value.length} groups · Showing ${groups.length} groups`}</p>
    {groups.map((group, groupIndex) => {
      const limit = itemLimits[groupIndex] ?? ITEM_BATCH, items = group.items.slice(0, limit);
      const panelId = `${id}-group-${groupIndex}`;
      return <section key={groupIndex} className="menu-preview-group" aria-label={group.category || (chinese ? `第 ${groupIndex + 1} 组` : `Group ${groupIndex + 1}`)}>
        {group.category.trim() && <h6>{group.category}</h6>}
        <div id={panelId}>
          {items.map((item, itemIndex) => {
            const image = showImages && typeof item.imageUrl === 'string' ? safePriceMenuImage(item.imageUrl) : null;
            const pricing = publishedPricing(item);
            const title = pricing?.titleMode === 'AUTO' ? formatPriceMenuTitle(pricing) : item.name;
            return <div className="menu-preview-item" key={itemIndex}>
              {image && <img src={image} alt={title || (chinese ? '项目图片' : 'Service photo')} loading="lazy" className="menu-preview-image" />}
              <div className="menu-preview-item-text"><p className="menu-preview-name">{title || (chinese ? '项目名称待填写' : 'Item name pending')}</p>
                {pricing && <span className="menu-preview-price" style={{ display: 'inline-block', marginTop: 5, padding: '2px 8px', borderRadius: 6, background: 'color-mix(in srgb, var(--menu-accent, #287c7c) 8%, white)', fontSize: 11, fontWeight: 500 }}>{pricingBadge(pricing, language)}</span>}
                {pricing?.kind === 'ADD_ON' && <p className="menu-preview-description">{chinese ? '须搭配主项目 · 不增加预约时长' : 'Requires a main service · Adds no appointment time'}</p>}
                {item.description?.trim() && <p className="menu-preview-description">{item.description}</p>}
                {!pricing && <p className="menu-preview-price">{item.priceText || (chinese ? '价格待填写' : 'Price not provided')}</p>}
              </div>
            </div>;
          })}
        </div>
        {group.items.length > ITEM_BATCH && <div className="menu-preview-controls">
          <span>{chinese ? `显示 ${items.length} / ${group.items.length} 项` : `Showing ${items.length} of ${group.items.length} services`}</span>
          {items.length < group.items.length && <button type="button" aria-controls={panelId} onClick={() => setItemLimits(previous => ({ ...previous, [groupIndex]: limit + ITEM_BATCH }))}>{chinese ? '查看更多项目' : 'Show more services'}</button>}
          {limit > ITEM_BATCH && <button type="button" aria-controls={panelId} onClick={() => setItemLimits(previous => ({ ...previous, [groupIndex]: ITEM_BATCH }))}>{chinese ? '收起项目' : 'Show fewer services'}</button>}
        </div>}
      </section>;
    })}
    {value.length > GROUP_BATCH && <div className="menu-preview-controls">
      {groups.length < value.length && <button type="button" onClick={() => setGroupLimit(previous => previous + GROUP_BATCH)}>{chinese ? '查看更多分组' : 'Show more groups'}</button>}
      {groupLimit > GROUP_BATCH && <button type="button" onClick={() => { setGroupLimit(GROUP_BATCH); setItemLimits({}); }}>{chinese ? '收起分组' : 'Show fewer groups'}</button>}
    </div>}
  </div>;
}

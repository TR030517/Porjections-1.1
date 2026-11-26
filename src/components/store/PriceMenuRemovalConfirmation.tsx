import { useEffect, useRef } from 'react';
import type { PriceMenuRemovalImpact, PriceMenuRemovalRequest } from '../../utils/priceMenuEditingImpact';

function consequence(impact: PriceMenuRemovalImpact): string {
  switch (impact.effect) {
    case 'RETAINED': return '其他价目绑定仍保留，本次移除不会停用此对象；原启停状态不变。';
    case 'DISABLE_VARIANT': return '最后一条绑定被移除。保存成功后此规格会停用，不能再预约此规格；不会因此暂停主项目或其他规格。';
    case 'DISABLE_ADD_ON': return '最后一条绑定被移除。保存成功后此附加项会停用，不能加入新的预约；主项目和其他规格不受此移除影响。';
    case 'BASE_WITH_VARIANTS': return '移除旧主项目的直接绑定。该主项目已有规格，不会因此整组暂停；各规格的影响分别列出。';
    case 'CHECK_BASE_SERVICE': return '最后一条主项目直接绑定被移除。保存时若目录中没有规格，此独立主项目会停用并停止新预约；若已有规格（包括未列入价目的规格），主项目不会因此暂停。';
    case 'DRAFT_ONLY': return '此展示行尚未关联已保存的预约对象。移除只影响当前草稿，不会停用已有服务、规格或附加项。';
  }
}

export default function PriceMenuRemovalConfirmation({ request, disabled, onCancel, onConfirm }: { request: PriceMenuRemovalRequest; disabled: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <div className="price-menu-confirmation-backdrop"><section role="alertdialog" aria-modal="true" aria-label="确认移除价目及预约影响" className="price-menu-confirmation" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onCancel(); }
    if (event.key === 'Tab') { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')); const at = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
  }}>
    <h4>确认移除{request.itemIndex === undefined ? '分组' : '项目'}？</h4><p><strong>{request.label}</strong> · {request.itemCount} 项</p>
    <p>以下逐项列出本次移除后的预约影响。剩余绑定按整个门店价目草稿统计。</p>
    <ul aria-label="受影响的项目及剩余绑定">{request.impacts.map(impact => <li key={impact.key}>
      <p><strong>{impact.kind === 'variant' ? '规格' : impact.kind === 'addOn' ? '附加项' : impact.kind === 'service' ? '主项目' : '展示行'}：{impact.name}</strong>
        {impact.kind !== 'display' && <>（主项目 #{impact.serviceId}{impact.variantId ? ` · 规格 #${impact.variantId}` : impact.addOnId ? ` · 附加项 #${impact.addOnId}` : ''}）</>}</p>
      {impact.kind !== 'display' && <p>{impact.kind !== 'service' && <>所属主项目：{impact.serviceName}。 </>}移除 {impact.removedBindings} 条绑定；移除后剩余 {impact.remainingBindings} 条绑定。</p>}
      {impact.displayNames.length > 1 && <p>移除的展示行：{impact.displayNames.join('、')}。</p>}
      <p>{consequence(impact)}</p>
      {impact.parentPaused && <p>当前主项目已暂停；保留其他绑定不会恢复主项目或使其重新可约。</p>}
    </li>)}</ul>
    <p>历史订单及其项目、价格和技师快照保留。若关联项仍有有效预约，后台可能拒绝保存；现有订单不变，草稿保留供修改。</p>
    <p>此处只移除当前草稿，尚未保存到门店。之后保存价目及关联修改才会应用以上影响；这不是仅从顾客页面隐藏项目。</p><div className="price-menu-actions"><button type="button" ref={cancel} onClick={onCancel}>保留项目</button><button type="button" className="price-menu-remove" disabled={disabled} onClick={onConfirm}>确认移除草稿</button></div>
  </section></div>;
}

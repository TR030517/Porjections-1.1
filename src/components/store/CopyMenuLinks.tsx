import { useState } from 'react';
import type { MenuCopyLink } from '../../utils/menuCopyLinks';

const names = { SERVICE: '项目', VARIANT: '规格', ADD_ON: '附加项目' };
export default function CopyMenuLinks({ links }: { links: MenuCopyLink[] }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(links.length / 20)), current = Math.min(page, pages - 1);
  const creates = links.filter(row => row.action === 'CREATE').length;
  return <section aria-label="项目与价目关联复制计划" style={{ marginTop: 20 }}>
    <h4 style={{ margin: '0 0 10px', fontWeight: 600 }}>预约关联与目标编号映射</h4>
    <p style={{ fontSize: 13, lineHeight: 1.8 }}>共 {links.length} 条关联：新建停用配置 {creates} 条，复用目标现有配置 {links.length - creates} 条。已有配置的价格、时长和启停状态保留；新配置需在目标门店的“项目与价目”复核后启用。没有预约关联的原展示项仍仅展示。</p>
    {links.length > 0 && <div style={{ overflowX: 'auto', border: '1px solid #dbe4eb', borderRadius: 10 }}><table style={{ width: '100%', minWidth: 550, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
      <thead><tr style={{ background: '#f6f8fa' }}>{['类型', '来源项目', '目标编号', '执行方式'].map(label => <th key={label} style={{ padding: '10px 12px' }}>{label}</th>)}</tr></thead>
      <tbody>{links.slice(current * 20, (current + 1) * 20).map(row => <tr key={`${row.resource}:${row.sourceId}`} style={{ borderTop: '1px solid #edf0f3' }}>
        <td style={{ padding: 12 }}>{names[row.resource]}</td><td style={{ padding: 12 }}>{row.name}<small style={{ display: 'block', color: '#64748b' }}>#{row.sourceId}{row.resource !== 'SERVICE' ? ` · 主项目 #${row.sourceServiceId}` : ''}</small></td>
        <td style={{ padding: 12 }}>{row.targetId ? `#${row.targetId}` : '保存时生成新编号'}{row.resource !== 'SERVICE' && <small style={{ display: 'block', color: '#64748b' }}>主项目 {row.targetServiceId ? `#${row.targetServiceId}` : '同时新建'}</small>}</td>
        <td style={{ padding: 12 }}>{row.action === 'CREATE' ? '新建并停用' : '复用，保留目标状态'}</td>
      </tr>)}</tbody>
    </table></div>}
    {pages > 1 && <nav aria-label="预约关联复制分页" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12 }}><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>第 {current + 1} / {pages} 页</span><button type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页</button></nav>}
  </section>;
}

import { useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Input, InputNumber, Select, Space, Typography } from 'antd';
import type { ClosedPeriod, ShopBookingSettings } from '../../api/reservations';
import { bookingTimezoneValid, checkedShopBookingSettings, closureAnnouncement, nextClosurePeriod, noticeInputMinutes, type NoticeUnit } from '../../../../src/utils/shopBookingSettings';

export function ShopBookingSettingsPanel({ settings, timezone, phone, disabled, dirty, onChange, onSave }: { settings: ShopBookingSettings; timezone: string | null; phone?: string; disabled: boolean; dirty: boolean; onChange: (settings: ShopBookingSettings) => void; onSave: () => void }) {
  const [unit, setUnit] = useState<NoticeUnit>(60), [error, setError] = useState('');
  const view = useRef({ settings, timezone, disabled, unit }); view.current = { settings, timezone, disabled, unit };
  const editable = () => !disabled && !view.current.disabled && view.current.settings === settings
    && view.current.timezone === timezone && view.current.unit === unit;
  const update = (patch: Partial<ShopBookingSettings>) => { if (!editable()) return; setError(''); onChange({ ...settings, ...patch }); };
  const addClosure = () => {
    if (!editable()) return;
    try { update({ closedPeriods: [...settings.closedPeriods, nextClosurePeriod(settings.closedPeriods, timezone)] }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请核对门店时区及已有闭店日期。'); }
  };
  const setClosure = (index: number, patch: Partial<ClosedPeriod>) => update({ closedPeriods: settings.closedPeriods.map((period, at) => at === index ? { ...period, ...patch } : period) });
  const removeClosure = (index: number) => update({ closedPeriods: settings.closedPeriods.filter((_period, at) => at !== index) });
  let validationError = '';
  try { checkedShopBookingSettings(settings); } catch (cause) { validationError = cause instanceof Error ? cause.message : '请核对预约设置。'; }
  return <Card title="预约提前量与临时闭店" extra={<Button type="primary" disabled={disabled || !dirty || !!validationError} onClick={onSave}>保存预约规则</Button>}>
    {(error || validationError) && <Alert style={{ marginBottom: 12 }} type="error" showIcon title={error || validationError} />}
    <Space align="start" wrap>
      <div style={{ minWidth: 260, maxWidth: 420 }}>
        <Typography.Text strong>最短提前预约时间</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>按门店当地时间计算。可约开始时间须达到当前时间加提前量，并同时满足营业和技师/场地可用规则。</Typography.Paragraph>
        <Space.Compact><InputNumber aria-label="最短提前预约时间" min={0} max={10080 / unit} step={unit === 60 ? 0.25 : 1} disabled={disabled} value={Number.isFinite(settings.minimumNoticeMinutes) ? settings.minimumNoticeMinutes / unit : null} onChange={value => {
          try { update({ minimumNoticeMinutes: noticeInputMinutes(value, unit) }); }
          catch { update({ minimumNoticeMinutes: Number.NaN }); }
        }} /><Select aria-label="预约提前量单位" disabled={disabled} value={unit} options={[{ value: 60, label: '小时' }, { value: 1440, label: '天' }]} onChange={value => { if (editable()) { view.current = { ...view.current, unit: value }; setUnit(value); } }} /></Space.Compact>
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>{[0, 60, 720, 1440].map(value => <Button key={value} size="small" disabled={disabled} type={settings.minimumNoticeMinutes === value ? 'primary' : 'default'} onClick={() => update({ minimumNoticeMinutes: value })}>{value === 0 ? '无' : value === 60 ? '1 小时' : value === 720 ? '12 小时' : '24 小时'}</Button>)}</div>
      </div>
      <div style={{ flex: '1 1 420px', minWidth: 280 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}><Typography.Text strong>临时闭店日期</Typography.Text><Button disabled={disabled || !bookingTimezoneValid(timezone) || settings.closedPeriods.length >= 50} onClick={addClosure}>添加闭店日期</Button></Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>区间包含起止两天。访客页面显示英文通知并附本店电话，这些日期不接受新预约。如日期内已有有效预约，请先联系顾客处理，再添加闭店；系统不会自动取消预约。{!bookingTimezoneValid(timezone) && '请先在基本资料中设置门店时区，再添加日期。'}</Typography.Paragraph>
        {settings.closedPeriods.length ? <div style={{ display: 'grid', gap: 8 }}>{settings.closedPeriods.map((period, index) => <div key={index}>
          <Space wrap><label style={{ display: 'grid', gap: 3, fontSize: 12 }}>开始日期<Input aria-label={`闭店第 ${index + 1} 段开始日期`} type="date" disabled={disabled} value={period.startDate} onChange={event => setClosure(index, { startDate: event.target.value })} /></label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>结束日期<Input aria-label={`闭店第 ${index + 1} 段结束日期`} type="date" disabled={disabled} value={period.endDate} onChange={event => setClosure(index, { endDate: event.target.value })} /></label>
            <Button danger disabled={disabled} onClick={() => removeClosure(index)}>移除</Button></Space>
          {closureAnnouncement(period, phone) && <Typography.Paragraph lang="en" type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>{closureAnnouncement(period, phone)}</Typography.Paragraph>}
        </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无临时闭店" />}
        {settings.closedPeriods.length > 0 && <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>以上为闭店公告内容预览，保存预约规则后生效。{!phone?.trim() && '门店联系电话未填写，请在基本资料中补充。'}</Typography.Paragraph>}
      </div>
    </Space>
  </Card>;
}

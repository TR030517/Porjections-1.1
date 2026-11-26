import type { ReactNode } from 'react';
import { Typography } from 'antd';

export default function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <header className="merchant-page-header"><div><Typography.Title level={3}>{title}</Typography.Title><Typography.Paragraph type="secondary">{description}</Typography.Paragraph></div>{actions && <div className="merchant-page-actions">{actions}</div>}</header>;
}

import { Card } from 'antd';
import type { ReactNode } from 'react';

type PageSectionCardProps = {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
};

/** Card section — cùng pattern content-company `PageSectionCard`. */
export function PageSectionCard({ title, extra, children }: PageSectionCardProps) {
  return (
    <Card title={title} extra={extra}>
      {children}
    </Card>
  );
}

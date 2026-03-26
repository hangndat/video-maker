import { Card } from 'antd';
import type { ReactNode } from 'react';

type PageTableCardProps = {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
};

/** Card bảng: body không padding (content-company pattern). */
export function PageTableCard({ title, extra, children }: PageTableCardProps) {
  return (
    <Card title={title} extra={extra} styles={{ body: { padding: 0 } }}>
      {children}
    </Card>
  );
}

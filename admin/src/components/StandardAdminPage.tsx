import type { ReactNode } from 'react';
import { AppPageHeader } from './AppPageHeader';
import { PageShell } from './PageShell';

type StandardAdminPageProps = {
  title: string;
  description?: ReactNode;
  headerExtra?: ReactNode;
  /** Ví dụ PageBackNav — hiển thị trên cùng, trước header. */
  leading?: ReactNode;
  /** Thường bọc PageToolbar; nếu không truyền thì bỏ qua. */
  toolbar?: ReactNode;
  children: ReactNode;
};

/** Khung trang admin thống nhất: shell → leading? → AppPageHeader → toolbar? → children. */
export function StandardAdminPage({
  title,
  description,
  headerExtra,
  leading,
  toolbar,
  children,
}: StandardAdminPageProps) {
  return (
    <PageShell>
      <div className="cc-page-heading-sticky">
        {leading}
        <AppPageHeader title={title} description={description} extra={headerExtra} />
        {toolbar}
      </div>
      {children}
    </PageShell>
  );
}

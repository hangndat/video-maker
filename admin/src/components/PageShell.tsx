import type { ReactNode } from 'react';

type PageShellProps = {
  children: ReactNode;
};

/** Khung dọc: khoảng cách thống nhất giữa các section (giống content-company `.cc-page-shell`). */
export function PageShell({ children }: PageShellProps) {
  return <div className="cc-page-shell">{children}</div>;
}

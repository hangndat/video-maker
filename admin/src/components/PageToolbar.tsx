import { theme } from 'antd';
import type { ReactNode } from 'react';

type PageToolbarProps = {
  children: ReactNode;
  spread?: boolean;
};

export function PageToolbar({ children, spread }: PageToolbarProps) {
  const { token } = theme.useToken();
  return (
    <div
      className="cc-page-toolbar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: spread ? 'flex-start' : 'center',
        gap: token.marginSM,
        ...(spread ? { width: '100%', justifyContent: 'space-between' } : {}),
      }}
    >
      {children}
    </div>
  );
}

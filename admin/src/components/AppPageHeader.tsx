import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

type AppPageHeaderProps = {
  breadcrumb?: ReactNode;
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
};

/** Header kiểu content-company: breadcrumb + title + mô tả + extra. */
export function AppPageHeader({ breadcrumb, title, description, extra }: AppPageHeaderProps) {
  const { token } = theme.useToken();

  return (
    <header className="cc-page-header">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: token.marginMD,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 min(100%, 320px)', minWidth: 0 }}>
          {breadcrumb ? (
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: token.marginXS }}>
              {breadcrumb}
            </Text>
          ) : null}
          <Title
            level={breadcrumb ? 2 : 3}
            style={{
              margin: 0,
              marginBottom: description ? token.marginXS : 0,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </Title>
          {description ? (
            <Text
              type="secondary"
              style={{ display: 'block', maxWidth: 'min(52rem, 100%)', lineHeight: 1.65, marginTop: 4 }}
            >
              {description}
            </Text>
          ) : null}
        </div>
        {extra ? <div style={{ flexShrink: 0, paddingTop: 2 }}>{extra}</div> : null}
      </div>
    </header>
  );
}

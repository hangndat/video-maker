import { Typography, theme } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

type AppPageHeaderProps = {
  title: string;
  description?: ReactNode;
  extra?: ReactNode;
};

/** Header: tiêu đề + mô tả + extra. */
export function AppPageHeader({ title, description, extra }: AppPageHeaderProps) {
  const { token } = theme.useToken();

  return (
    <header className="cc-page-header">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: token.marginSM,
          flexWrap: 'wrap',
          rowGap: token.marginXS,
        }}
      >
        <div style={{ flex: '1 1 min(100%, 280px)', minWidth: 0 }}>
          <Title
            level={3}
            style={{
              margin: 0,
              marginBottom: description ? 4 : 0,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontSize: '1.25rem',
              lineHeight: 1.35,
            }}
          >
            {title}
          </Title>
          {description ? (
            <Text
              type="secondary"
              style={{ display: 'block', maxWidth: 'min(52rem, 100%)', lineHeight: 1.5, marginTop: 2, fontSize: 13 }}
            >
              {description}
            </Text>
          ) : null}
        </div>
        {extra ? <div style={{ flexShrink: 0 }}>{extra}</div> : null}
      </div>
    </header>
  );
}

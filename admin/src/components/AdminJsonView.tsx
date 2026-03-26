import type { CSSProperties } from 'react';
import JsonView from 'react18-json-view';
import { Typography, theme } from 'antd';

type AdminJsonViewProps = {
  /** JSON string hoặc giá trị đã parse */
  value: string | unknown;
  emptyText?: string;
  'data-testid'?: string;
  maxHeight?: CSSProperties['maxHeight'];
  /** Độ sâu thu gọn mặc định (react18-json-view) */
  collapsed?: number | boolean;
  /** Mặc định `github` — sáng, khớp nền Ant Design; tránh `vscode` trên trang chủ sáng. */
  viewTheme?: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming';
};

/** Hiển thị một payload JSON (chuỗi hoặc object) dạng cây có thể thu gọn. */
export function AdminJsonView(props: AdminJsonViewProps) {
  const { token } = theme.useToken();
  const {
    value,
    emptyText = '—',
    'data-testid': testId,
    maxHeight = '50vh',
    collapsed = 2,
    viewTheme = 'github',
  } = props;

  if (value === '' || value == null) {
    return (
      <span data-testid={testId} style={{ color: token.colorTextSecondary }}>
        {emptyText}
      </span>
    );
  }

  let src: unknown = value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) {
      return (
        <span data-testid={testId} style={{ color: token.colorTextSecondary }}>
          {emptyText}
        </span>
      );
    }
    try {
      src = JSON.parse(t) as unknown;
    } catch {
      return (
        <div data-testid={testId} style={{ marginTop: token.marginSM }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Không phải JSON hợp lệ — raw:
          </Typography.Text>
          <pre
            style={{
              margin: `${token.marginXS}px 0 0`,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: token.fontSizeSM,
            }}
          >
            {value}
          </pre>
        </div>
      );
    }
  }

  return (
    <div
      data-testid={testId}
      style={{
        maxHeight,
        overflow: 'auto',
        padding: token.paddingSM,
        background: token.colorFillAlter,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <JsonView
        src={src}
        collapsed={collapsed}
        enableClipboard
        editable={false}
        theme={viewTheme}
        style={{ fontSize: 13, background: 'transparent' }}
      />
    </div>
  );
}

type HttpResponseJsonViewProps = {
  /** Dòng đầu thường là `200 OK`, phần sau là body (JSON hoặc text). */
  text: string;
  'data-testid'?: string;
  maxHeight?: CSSProperties['maxHeight'];
  viewTheme?: AdminJsonViewProps['viewTheme'];
};

/** Phản hồi HTTP kiểu `status\\nbody` — body parse JSON nếu được. */
export function HttpResponseJsonView(props: HttpResponseJsonViewProps) {
  const { text, 'data-testid': testId, maxHeight = '50vh', viewTheme } = props;
  const { token } = theme.useToken();
  const firstNl = text.indexOf('\n');
  const head = firstNl >= 0 ? text.slice(0, firstNl) : text;
  const body = firstNl >= 0 ? text.slice(firstNl + 1).trim() : '';

  return (
    <div data-testid={testId} style={{ marginTop: token.marginLG }}>
      <Typography.Text
        code
        copyable={{ text: head }}
        style={{ display: 'block', marginBottom: body ? token.marginSM : 0 }}
      >
        {head}
      </Typography.Text>
      {body ? (
        <AdminJsonView
          value={body}
          maxHeight={maxHeight}
          collapsed={2}
          viewTheme={viewTheme}
        />
      ) : null}
    </div>
  );
}

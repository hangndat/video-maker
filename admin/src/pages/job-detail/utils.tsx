import { Tag } from 'antd';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Tag color={ok ? 'success' : 'default'} style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}

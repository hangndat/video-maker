import { useEffect, useState } from 'react';
import { Spin, Typography } from 'antd';
import { adminFetch } from '../lib/api';
import { AdminJsonView } from './AdminJsonView';

type Props = {
  jobId: string;
  rel: string;
  kind: 'json' | 'text';
};

export function ArtifactInlinePreview({ jobId, rel, kind }: Props) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setText('');
      try {
        const r = await adminFetch(
          `/admin/api/jobs/${encodeURIComponent(jobId)}/artifacts/file?rel=${encodeURIComponent(rel)}`,
        );
        if (!r.ok) {
          const t = await r.text();
          if (!cancelled) setErr(t || `${r.status}`);
          return;
        }
        const t = await r.text();
        if (!cancelled) setText(t);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, rel]);

  if (loading) return <Spin size="small" />;
  if (err) {
    return (
      <Typography.Text type="danger" style={{ fontSize: 12 }}>
        {err}
      </Typography.Text>
    );
  }
  if (kind === 'json') {
    return <AdminJsonView value={text} maxHeight="280px" collapsed={2} />;
  }
  return (
    <pre
      style={{
        maxHeight: 280,
        overflow: 'auto',
        fontSize: 12,
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </pre>
  );
}

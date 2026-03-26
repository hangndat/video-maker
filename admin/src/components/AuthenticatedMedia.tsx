import { useEffect, useState } from 'react';
import { Spin, Typography } from 'antd';
import { adminFetch } from '../lib/api';

type Props = {
  jobId: string;
  rel: string;
  kind: 'video' | 'audio';
};

/**
 * Trình phát media qua admin API (Bearer) — tải blob vì &lt;video src&gt; không gửi header.
 */
export function AuthenticatedMedia({ jobId, rel, kind }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      setUrl(null);
      try {
        const r = await adminFetch(
          `/admin/api/jobs/${encodeURIComponent(jobId)}/artifacts/file?rel=${encodeURIComponent(rel)}`,
        );
        if (!r.ok) {
          const t = await r.text();
          if (!cancelled) setErr(t || `${r.status}`);
          return;
        }
        const blob = await r.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
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
  if (!url) return null;

  if (kind === 'video') {
    return (
      <video
        controls
        playsInline
        src={url}
        style={{ width: '100%', maxHeight: 360, background: '#000' }}
        data-artifact-rel={rel}
      />
    );
  }
  return <audio controls src={url} style={{ width: '100%' }} data-artifact-rel={rel} />;
}

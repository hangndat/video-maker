import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageSectionCard } from '../../components/PageSectionCard';
import { AuthenticatedMedia } from '../../components/AuthenticatedMedia';
import type { ArtifactRow } from './types';
import { formatBytes, StatusPill } from './utils';

const { Text } = Typography;

type Props = {
  jobId: string;
  loading: boolean;
  metaFetchOk: boolean | null;
  profileHint: string | null;
  jobHeadline: string | null;
  hasMetaFile: boolean;
  hasVoice: boolean;
  hasConcat: boolean;
  finalArtifact: ArtifactRow | undefined;
  artifactCount: number;
  totalArtifactBytes: number;
  onReload: () => void;
  onCopyJobId: () => void;
};

export function JobDetailOverviewTab({
  jobId,
  loading,
  metaFetchOk,
  profileHint,
  jobHeadline,
  hasMetaFile,
  hasVoice,
  hasConcat,
  finalArtifact,
  artifactCount,
  totalArtifactBytes,
  onReload,
  onCopyJobId,
}: Props) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <PageSectionCard
        title="Thông tin job"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={onReload} loading={loading}>
              Làm mới
            </Button>
            <Button icon={<CopyOutlined />} onClick={onCopyJobId}>
              Sao chép jobId
            </Button>
          </Space>
        }
      >
        {metaFetchOk === false ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Chưa có meta.json hoặc API trả lỗi"
            description="Job có thể chưa render lần nào, hoặc jobId không khớp dữ liệu trên server."
          />
        ) : null}

        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small" bordered>
          <Descriptions.Item label="Job ID" span={2}>
            <Text copyable>{jobId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Profile (meta)">{profileHint ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Idea (meta, rút gọn)">
            {jobHeadline ? (
              <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                {jobHeadline}
              </Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="meta.json">
            <StatusPill ok={hasMetaFile} label={hasMetaFile ? 'Có' : 'Thiếu'} />
          </Descriptions.Item>
          <Descriptions.Item label="voice.mp3">
            <StatusPill ok={hasVoice} label={hasVoice ? 'Có' : 'Thiếu'} />
          </Descriptions.Item>
          <Descriptions.Item label="concat.mp4">
            <StatusPill ok={hasConcat} label={hasConcat ? 'Có' : 'Thiếu'} />
          </Descriptions.Item>
          <Descriptions.Item label="final/output.mp4">
            <StatusPill ok={Boolean(finalArtifact)} label={finalArtifact ? 'Có' : 'Thiếu'} />
          </Descriptions.Item>
          <Descriptions.Item label="Artifact trên disk" span={2}>
            <Text type="secondary">
              {artifactCount} file · tổng {formatBytes(totalArtifactBytes)}
            </Text>
          </Descriptions.Item>
        </Descriptions>
      </PageSectionCard>

      <PageSectionCard title="Kết quả cuối (final/output.mp4)">
        {loading && !finalArtifact ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : finalArtifact ? (
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Text type="secondary" data-testid="final-video-meta">
              {finalArtifact.rel} · {formatBytes(finalArtifact.size)}
            </Text>
            <div
              style={{
                maxWidth: 520,
                margin: '0 auto',
                borderRadius: 8,
                overflow: 'hidden',
                background: '#000',
              }}
            >
              <AuthenticatedMedia jobId={jobId} rel="final/output.mp4" kind="video" />
            </div>
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Chưa có final/output.mp4 — chạy pipeline hoặc tab Tune."
            data-testid="final-video-missing"
          />
        )}
      </PageSectionCard>
    </Space>
  );
}

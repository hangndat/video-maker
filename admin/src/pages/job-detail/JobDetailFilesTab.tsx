import { useMemo } from 'react';
import { Button, Divider, Input, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined } from '@ant-design/icons';
import { PageSectionCard } from '../../components/PageSectionCard';
import { AdminJsonView } from '../../components/AdminJsonView';
import type { ArtifactRow } from './types';
import { formatBytes } from './utils';

type Props = {
  loading: boolean;
  metaText: string;
  filteredArtifactFiles: ArtifactRow[];
  fileSearch: string;
  onFileSearchChange: (value: string) => void;
  onCopyMeta: () => void;
};

export function JobDetailFilesTab({
  loading,
  metaText,
  filteredArtifactFiles,
  fileSearch,
  onFileSearchChange,
  onCopyMeta,
}: Props) {
  const columns: ColumnsType<ArtifactRow> = useMemo(
    () => [
      {
        title: 'rel',
        dataIndex: 'rel',
        ellipsis: true,
        render: (rel: string) => (
          <Typography.Text code copyable={{ text: rel }}>
            {rel}
          </Typography.Text>
        ),
      },
      {
        title: 'size',
        dataIndex: 'size',
        width: 108,
        render: (n: number) => formatBytes(n),
      },
      {
        title: 'type',
        dataIndex: 'contentType',
        width: 120,
        ellipsis: true,
        render: (t: string | undefined) => t ?? '—',
      },
    ],
    [],
  );

  return (
    <PageSectionCard title="File trong job & debug (GET /meta)">
      <Input.Search
        allowClear
        placeholder="Lọc theo đường dẫn…"
        value={fileSearch}
        onChange={(e) => onFileSearchChange(e.target.value)}
        style={{ maxWidth: 360, marginBottom: 12 }}
      />
      <Table<ArtifactRow>
        rowKey="rel"
        size="small"
        dataSource={filteredArtifactFiles}
        columns={columns}
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} file` }}
        loading={loading}
      />
      <Divider orientation="left" plain>
        Phản hồi JSON (debug)
      </Divider>
      <Space wrap style={{ marginBottom: 8 }}>
        <Button icon={<CopyOutlined />} onClick={onCopyMeta} disabled={!metaText} data-testid="btn-copy-meta">
          Sao chép JSON
        </Button>
      </Space>
      <AdminJsonView value={metaText} emptyText="—" data-testid="job-meta-pre" maxHeight="42vh" collapsed={2} />
    </PageSectionCard>
  );
}

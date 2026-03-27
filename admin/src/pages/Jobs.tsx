import type { HTMLAttributes } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { adminFetch } from '../lib/api';
import { PageTableCard } from '../components/PageTableCard';
import { PageToolbar } from '../components/PageToolbar';
import { StandardAdminPage } from '../components/StandardAdminPage';

type JobRow = {
  jobId: string;
  hasMeta: boolean;
  hasFinal: boolean;
  metaMtime?: number;
  manifestStatus?: 'running' | 'completed' | 'failed';
  pipeline?: string;
  manifestUpdatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  ideaPreview?: string;
  profileId?: string;
  lastError?: string;
};

export default function Jobs() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/admin/api/jobs');
      const j = (await r.json()) as { ok?: boolean; jobs?: JobRow[] };
      setRows(j.jobs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<JobRow> = [
    {
      title: 'jobId',
      dataIndex: 'jobId',
      render: (id: string) => (
        <Link to={`/jobs/${encodeURIComponent(id)}`} data-job-id={id}>
          {id}
        </Link>
      ),
    },
    { title: 'meta', dataIndex: 'hasMeta', render: (v: boolean) => String(v) },
    { title: 'final', dataIndex: 'hasFinal', render: (v: boolean) => String(v) },
    {
      title: 'status',
      dataIndex: 'manifestStatus',
      width: 100,
      render: (s: JobRow['manifestStatus']) => s ?? '—',
    },
    {
      title: 'pipeline',
      dataIndex: 'pipeline',
      width: 110,
      render: (p: string | undefined) => p ?? '—',
    },
    {
      title: 'idea (manifest)',
      dataIndex: 'ideaPreview',
      ellipsis: true,
      render: (t: string | undefined) => t ?? '—',
    },
    {
      title: 'lỗi (manifest)',
      dataIndex: 'lastError',
      ellipsis: true,
      render: (t: string | undefined) => t ?? '—',
    },
    {
      title: 'meta mtime',
      dataIndex: 'metaMtime',
      render: (ms?: number) => (ms != null ? new Date(ms).toISOString() : '—'),
    },
  ];

  return (
    <StandardAdminPage
      title="Jobs"
      description="Thư mục DATA_ROOT/jobs + jobs-manifest.json. Bấm jobId để mở chi tiết (layout giống content-company)."
      toolbar={
        <PageToolbar spread>
          <Typography.Text type="secondary" style={{ margin: 0 }}>
            {rows.length} job trong danh sách
          </Typography.Text>
          <Space wrap style={{ flexShrink: 0 }}>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => void load()}
              loading={loading}
              data-testid="btn-jobs-refresh"
            >
              Làm mới
            </Button>
          </Space>
        </PageToolbar>
      }
    >
      <PageTableCard>
        <div data-testid="jobs-table">
          <Table<JobRow>
            rowKey="jobId"
            dataSource={rows}
            columns={columns}
            loading={loading}
            scroll={{ x: 960 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} job` }}
            onRow={(record) =>
              ({
                'data-testid': `job-row-${record.jobId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
              }) as HTMLAttributes<HTMLTableRowElement>
            }
          />
        </div>
      </PageTableCard>
    </StandardAdminPage>
  );
}

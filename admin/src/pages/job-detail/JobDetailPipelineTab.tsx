import { useMemo } from 'react';
import { Card, Empty, Space, Tabs, Tag, Typography } from 'antd';
import { PageSectionCard } from '../../components/PageSectionCard';
import { AdminJsonView } from '../../components/AdminJsonView';
import { AuthenticatedMedia } from '../../components/AuthenticatedMedia';
import { ArtifactInlinePreview } from '../../components/ArtifactInlinePreview';
import type { AgentStage } from '../../pipeline-agents';

type Props = {
  jobId: string;
  agentStages: AgentStage[];
  activeStageKey: string;
  onStageChange: (stageId: string) => void;
};

export function JobDetailPipelineTab({
  jobId,
  agentStages,
  activeStageKey,
  onStageChange,
}: Props) {
  const tabItems = useMemo(
    () =>
      agentStages.map((s) => ({
        key: s.id,
        label: (
          <Space size={4}>
            <span>{s.title}</span>
            <Tag color={s.artifacts.length > 0 ? 'blue' : 'default'} style={{ margin: 0 }}>
              {s.artifacts.length}
            </Tag>
          </Space>
        ),
        children: (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {s.summary}
            </Typography.Paragraph>
            <div>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                Đầu vào (meta / ngữ cảnh)
              </Typography.Title>
              <AdminJsonView
                value={s.inputsJson}
                maxHeight="280px"
                collapsed={3}
                emptyText="—"
              />
            </div>
            <div>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                Đầu ra (artifact)
              </Typography.Title>
              {s.artifacts.length === 0 ? (
                <Typography.Text type="secondary">Chưa có file khớp bước này.</Typography.Text>
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {s.artifacts.map((a) => (
                    <Card key={a.rel} size="small" title={a.label} styles={{ body: { paddingTop: 12 } }}>
                      <Typography.Text code copyable={{ text: a.rel }} style={{ fontSize: 12 }}>
                        {a.rel}
                      </Typography.Text>
                      <div style={{ marginTop: 12 }}>
                        {a.kind === 'video' || a.kind === 'audio' ? (
                          <AuthenticatedMedia jobId={jobId} rel={a.rel} kind={a.kind} />
                        ) : (
                          <ArtifactInlinePreview jobId={jobId} rel={a.rel} kind={a.kind} />
                        )}
                      </div>
                    </Card>
                  ))}
                </Space>
              )}
            </div>
          </Space>
        ),
      })),
    [agentStages, jobId],
  );

  return (
    <PageSectionCard title="Các bước pipeline">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Mỗi tab là một bước trong <code>docs/pipeline.md</code>. Số trên tag = artifact khớp trên disk.
      </Typography.Paragraph>
      {agentStages.length === 0 ? (
        <Empty description="Chưa có dữ liệu pipeline (đang tải meta?)" />
      ) : (
        <Tabs
          type="card"
          activeKey={activeStageKey}
          onChange={onStageChange}
          items={tabItems}
          destroyInactiveTabPane={false}
        />
      )}
    </PageSectionCard>
  );
}

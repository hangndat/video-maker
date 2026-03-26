import { useState } from 'react';
import { Button, Card, Space, Typography } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { adminFetch } from '../lib/api';
import { AdminJsonView } from '../components/AdminJsonView';

const { Paragraph, Text } = Typography;

export default function HealthTest() {
  const [healthData, setHealthData] = useState<unknown>(null);
  const [contextText, setContextText] = useState<string>('');

  const runHealth = async () => {
    const r = await fetch('/health');
    const j = (await r.json()) as unknown;
    setHealthData(j);
  };

  const runContext = async () => {
    const r = await adminFetch('/admin/api/context');
    const t = await r.text();
    setContextText(t);
  };

  return (
    <PageContainer title="Kiểm thử & Health">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card title="Service">
          <Space wrap>
            <Button type="primary" onClick={runHealth} data-testid="btn-health-check">
              GET /health
            </Button>
            <Button onClick={runContext} data-testid="btn-admin-context">
              GET /admin/api/context
            </Button>
          </Space>
          {(healthData != null || contextText) ? (
            <Space direction="vertical" size="middle" style={{ width: '100%', marginTop: 16 }}>
              {healthData != null ? (
                <AdminJsonView
                  value={healthData}
                  data-testid="health-response-pre"
                  maxHeight="40vh"
                  collapsed={2}
                />
              ) : null}
              {contextText ? (
                <AdminJsonView
                  value={contextText}
                  data-testid="context-response-pre"
                  maxHeight="40vh"
                  collapsed={2}
                />
              ) : null}
            </Space>
          ) : null}
        </Card>
        <Card title="Tài liệu & test gợi ý">
          <Paragraph>
            <Text code>docs/pipeline.md</Text> — luồng preset, <Text code>from-video</Text>,{' '}
            <Text code>assembleOnly</Text>.
          </Paragraph>
          <Paragraph>
            Seed job E2E: <Text code>src/e2e/seed-minimal-job.ts</Text> — chạy{' '}
            <Text code>npm run test:e2e</Text> (cần ffmpeg).
          </Paragraph>
        </Card>
      </Space>
    </PageContainer>
  );
}

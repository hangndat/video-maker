import { useState } from 'react';
import { App, Button, Divider, Form, Input, Switch, Space, Typography } from 'antd';
import { adminFetch, PIPELINE_FETCH_INIT } from '../lib/api';
import { HttpResponseJsonView } from '../components/AdminJsonView';
import { PageSectionCard } from '../components/PageSectionCard';
import { StandardAdminPage } from '../components/StandardAdminPage';

export default function FromVideo() {
  const { message } = App.useApp();
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const presetAssembleOnly = () => {
    form.setFieldsValue({
      jobId: 'e2e-seed-job',
      assembleOnly: true,
      reuseRawVideo: true,
      profileId: 'cinematic_mystery',
      tuningJson: '',
      bgmPath: '',
    });
    message.info('Điền mẫu assembleOnly + reuseRawVideo (đổi jobId theo job có sẵn)');
  };

  const onFinish = async (values: {
    jobId: string;
    profileId?: string;
    tuningJson?: string;
    bgmPath?: string;
    reuseRawVideo?: boolean;
    assembleOnly?: boolean;
  }) => {
    setSubmitting(true);
    setResponseText('');
    try {
      const body: Record<string, unknown> = { jobId: values.jobId.trim() };
      if (values.profileId?.trim()) body.profileId = values.profileId.trim();
      if (values.bgmPath?.trim()) body.bgmPath = values.bgmPath.trim();
      if (values.tuningJson?.trim()) {
        body.tuning = JSON.parse(values.tuningJson) as object;
      }
      if (values.reuseRawVideo != null) body.reuseRawVideo = values.reuseRawVideo;
      if (values.assembleOnly != null) body.assembleOnly = values.assembleOnly;
      const r = await adminFetch('/jobs/render/from-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...PIPELINE_FETCH_INIT,
      });
      const t = await r.text();
      setResponseText(`${r.status} ${r.statusText}\n${t}`);
    } catch (e) {
      setResponseText(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const curlSnippet = () => {
    const jobId = form.getFieldValue('jobId') as string | undefined;
    const j = JSON.stringify(
      {
        jobId: jobId || 'YOUR_JOB_ID',
        assembleOnly: form.getFieldValue('assembleOnly'),
        reuseRawVideo: form.getFieldValue('reuseRawVideo'),
      },
      null,
      2,
    );
    return `curl -sS -X POST http://127.0.0.1:3000/jobs/render/from-video \\\\\n  -H 'Content-Type: application/json' \\\\\n  -d '${j.replace(/'/g, "'\\''")}'`;
  };

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curlSnippet());
    message.success('Đã sao chép curl (chỉnh token/jobId)');
  };

  return (
    <StandardAdminPage
      title="From video"
      description={
        <>
          <Typography.Text type="secondary">
            POST <Typography.Text code>/jobs/render/from-video</Typography.Text> — ingest / mux theo job có
            sẵn.
          </Typography.Text>
        </>
      }
    >
      <PageSectionCard title="Biểu mẫu">
        <Space style={{ marginBottom: 16 }} wrap>
          <Button data-testid="btn-preset-assemble-only" onClick={presetAssembleOnly}>
            Mẫu assembleOnly
          </Button>
          <Button data-testid="btn-copy-curl-from-video" onClick={() => void copyCurl()}>
            Sao chép curl gợi ý
          </Button>
        </Space>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            reuseRawVideo: false,
            assembleOnly: false,
          }}
          onFinish={(v) => void onFinish(v)}
        >
          <Form.Item name="jobId" label="jobId" rules={[{ required: true }]}>
            <Input data-testid="input-from-video-job-id" />
          </Form.Item>
          <Form.Item name="profileId" label="profileId">
            <Input data-testid="input-from-video-profile" />
          </Form.Item>
          <Form.Item name="tuningJson" label="tuning (JSON)">
            <Input.TextArea rows={4} data-testid="textarea-from-video-tuning" />
          </Form.Item>
          <Form.Item name="bgmPath" label="bgmPath">
            <Input data-testid="input-from-video-bgm" />
          </Form.Item>
          <Form.Item name="reuseRawVideo" label="reuseRawVideo" valuePropName="checked">
            <Switch data-testid="switch-reuse-raw-video" />
          </Form.Item>
          <Form.Item name="assembleOnly" label="assembleOnly" valuePropName="checked">
            <Switch data-testid="switch-assemble-only" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            data-testid="btn-submit-from-video"
          >
            Chạy from-video
          </Button>
        </Form>
      </PageSectionCard>
      {responseText ? (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <PageSectionCard title="Phản hồi gần nhất">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Dòng đầu là HTTP status; phần dưới là body.
            </Typography.Paragraph>
            <HttpResponseJsonView
              text={responseText}
              data-testid="from-video-response-pre"
              maxHeight="50vh"
            />
          </PageSectionCard>
        </>
      ) : null}
    </StandardAdminPage>
  );
}

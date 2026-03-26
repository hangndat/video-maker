import { useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, Select } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { adminFetch, PIPELINE_FETCH_INIT } from '../lib/api';
import { HttpResponseJsonView } from '../components/AdminJsonView';

/** Khớp preset mặc định repo: DATA_ROOT/profiles/cinematic_mystery.json */
const DEFAULT_RENDER_PROFILE_ID = 'cinematic_mystery';

const SAMPLE_IDEA_VI =
  'Video tối đa 60 giây: mở đầu gây tò mò, ba sự thật thú vị về một chủ đề khoa học, kết bằng lời kêu gọi ngắn.';

export default function Render() {
  const { message } = App.useApp();
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const defaultJobId = useMemo(
    () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    [],
  );

  const onFinish = async (values: {
    jobId: string;
    resumeFrom?: 'tts' | null;
    idea?: string;
    scenesJson?: string;
    profileId?: string;
    tuningJson?: string;
    bgmPath?: string;
  }) => {
    setSubmitting(true);
    setResponseText('');
    try {
      const body: Record<string, unknown> = { jobId: values.jobId.trim() };
      if (values.resumeFrom) body.resumeFrom = values.resumeFrom;
      if (values.idea?.trim()) body.idea = values.idea.trim();
      if (values.profileId?.trim()) body.profileId = values.profileId.trim();
      if (values.bgmPath?.trim()) body.bgmPath = values.bgmPath.trim();
      if (values.tuningJson?.trim()) {
        body.tuning = JSON.parse(values.tuningJson) as object;
      }
      if (values.scenesJson?.trim()) {
        body.scenes = JSON.parse(values.scenesJson) as unknown[];
      }
      if (!body.resumeFrom && !body.idea && !body.scenes) {
        message.error('Cần idea hoặc scenes (JSON), hoặc chọn resumeFrom = tts (meta đã có script)');
        return;
      }
      const r = await adminFetch('/jobs/render', {
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

  return (
    <PageContainer title="Render mới (POST /jobs/render)">
      <Card>
        <Form
          layout="vertical"
          initialValues={{
            jobId: defaultJobId,
            profileId: DEFAULT_RENDER_PROFILE_ID,
            idea: SAMPLE_IDEA_VI,
          }}
          onFinish={(v) => void onFinish(v)}
        >
          <Form.Item name="jobId" label="jobId" rules={[{ required: true }]}>
            <Input data-testid="input-render-job-id" />
          </Form.Item>
          <Form.Item
            name="resumeFrom"
            label="resumeFrom (chỉ tune — xem docs/pipeline.md §7)"
            tooltip="tts: đọc script từ meta.json job, bỏ qua OpenAI/preset body, chạy lại ElevenLabs → B-roll → FFmpeg"
          >
            <Select
              allowClear
              placeholder="Không — render đầy đủ từ idea/scenes"
              options={[
                {
                  value: 'tts',
                  label: 'tts — giữ script trong meta, chỉ TTS + các bước sau',
                },
              ]}
              data-testid="select-render-resume-from"
            />
          </Form.Item>
          <Form.Item name="idea" label="idea (OpenAI)">
            <Input.TextArea rows={4} data-testid="input-render-idea" />
          </Form.Item>
          <Form.Item
            name="scenesJson"
            label="scenes (JSON array — optional, thay cho idea)"
          >
            <Input.TextArea rows={6} data-testid="textarea-render-scenes" />
          </Form.Item>
          <Form.Item name="profileId" label="profileId">
            <Input placeholder={DEFAULT_RENDER_PROFILE_ID} data-testid="input-render-profile" />
          </Form.Item>
          <Form.Item name="tuningJson" label="tuning (JSON object)">
            <Input.TextArea rows={4} data-testid="textarea-render-tuning" />
          </Form.Item>
          <Form.Item name="bgmPath" label="bgmPath">
            <Input data-testid="input-render-bgm" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            data-testid="btn-submit-render"
          >
            Chạy render
          </Button>
        </Form>
      </Card>
      {responseText ? (
        <HttpResponseJsonView text={responseText} data-testid="render-response-pre" maxHeight="50vh" />
      ) : null}
    </PageContainer>
  );
}

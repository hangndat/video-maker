import type { FormInstance } from 'antd';
import { Button, Col, Divider, Form, Input, Row, Space, Typography } from 'antd';
import { PageSectionCard } from '../../components/PageSectionCard';
import { HttpResponseJsonView } from '../../components/AdminJsonView';
import type { PipelineAction } from './types';

export type TuneFormValues = {
  profileId?: string;
  tuningJson?: string;
  bgmPath?: string;
};

type Props = {
  form: FormInstance<TuneFormValues>;
  hasMetaFile: boolean;
  hasVoice: boolean;
  hasConcat: boolean;
  pipelineBusy: PipelineAction | null;
  pipelineResponse: string;
  runPipeline: (
    url: '/jobs/render' | '/jobs/render/from-video',
    body: Record<string, unknown>,
    action: PipelineAction,
  ) => void;
};

export function JobDetailTuneTab({
  form,
  hasMetaFile,
  hasVoice,
  hasConcat,
  pipelineBusy,
  pipelineResponse,
  runPipeline,
}: Props) {
  return (
    <PageSectionCard title="Chạy lại pipeline">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Gửi request tới API render trên cùng máy chủ (POST{' '}
        <Typography.Text code>/jobs/render</Typography.Text>,{' '}
        <Typography.Text code>/jobs/render/from-video</Typography.Text>). Có thể chỉnh vài field
        bên dưới rồi bấm đúng nút — job dùng <Typography.Text code>meta.json</Typography.Text> đã có
        trên disk.
      </Typography.Paragraph>

      <Divider style={{ margin: '20px 0' }} />

      <Row gutter={[32, 24]}>
        <Col xs={24} lg={9}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Tuỳ chọn gửi kèm
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            Để trống thì server dùng giá trị trong meta hoặc mặc định env.
          </Typography.Paragraph>
          <Form form={form} layout="vertical" requiredMark={false}>
            <Form.Item name="profileId" label="profileId">
              <Input placeholder="Ví dụ: my-profile" data-testid="job-tune-profile" />
            </Form.Item>
            <Form.Item name="tuningJson" label="tuning (JSON)">
              <Input.TextArea
                rows={4}
                placeholder='{"ass":{"fontSize":64}}'
                data-testid="job-tune-tuning"
              />
            </Form.Item>
            <Form.Item name="bgmPath" label="bgmPath">
              <Input placeholder="Đường dẫn nhạc nền (nếu có)" data-testid="job-tune-bgm" />
            </Form.Item>
          </Form>
        </Col>

        <Col xs={24} lg={15}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Hành động
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Mỗi nút tương ứng một kiểu resume / ingest. Cần đủ file trên disk (meta, voice, concat…)
            thì nút mới bật.
          </Typography.Paragraph>

          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                TTS → tiếp tục render
              </Typography.Text>
              <Button
                type="primary"
                disabled={!hasMetaFile}
                loading={pipelineBusy === 'tts_resume'}
                onClick={() => runPipeline('/jobs/render', { resumeFrom: 'tts' }, 'tts_resume')}
                data-testid="btn-job-tts-resume"
              >
                TTS lại đến cuối
              </Button>
            </div>

            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Luồng from-video (cần meta + voice)
              </Typography.Text>
              <Space wrap>
                <Button
                  disabled={!hasMetaFile || !hasVoice}
                  loading={pipelineBusy === 'from_video_ingest'}
                  onClick={() =>
                    runPipeline(
                      '/jobs/render/from-video',
                      { reuseRawVideo: false, assembleOnly: false },
                      'from_video_ingest',
                    )
                  }
                  data-testid="btn-job-from-video-ingest"
                >
                  Ingest B-roll lại
                </Button>
                <Button
                  disabled={!hasMetaFile || !hasVoice}
                  loading={pipelineBusy === 'from_video_reuse'}
                  onClick={() =>
                    runPipeline(
                      '/jobs/render/from-video',
                      { reuseRawVideo: true, assembleOnly: false },
                      'from_video_reuse',
                    )
                  }
                  data-testid="btn-job-from-video-reuse"
                >
                  Giữ source-*.mp4, encode lại
                </Button>
              </Space>
            </div>

            <div>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                Gần xong (cần concat)
              </Typography.Text>
              <Button
                disabled={!hasMetaFile || !hasConcat}
                loading={pipelineBusy === 'from_video_assemble'}
                onClick={() =>
                  runPipeline(
                    '/jobs/render/from-video',
                    { reuseRawVideo: true, assembleOnly: true },
                    'from_video_assemble',
                  )
                }
                data-testid="btn-job-from-video-assemble"
              >
                Chỉ final mux
              </Button>
            </div>
          </Space>

          {!hasMetaFile ? (
            <Typography.Paragraph type="warning" style={{ marginTop: 16, marginBottom: 0 }}>
              Chưa có <Typography.Text code>meta.json</Typography.Text> — không chạy pipeline được.
            </Typography.Paragraph>
          ) : null}
        </Col>
      </Row>

      {pipelineResponse ? (
        <>
          <Divider style={{ margin: '24px 0 16px' }} />
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            Kết quả gần nhất
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            Dòng đầu là HTTP status; phần dưới là body (nếu là JSON sẽ hiển thị dạng cây).
          </Typography.Paragraph>
          <HttpResponseJsonView
            text={pipelineResponse}
            data-testid="job-pipeline-response"
            maxHeight="min(40vh, 420px)"
          />
        </>
      ) : null}
    </PageSectionCard>
  );
}

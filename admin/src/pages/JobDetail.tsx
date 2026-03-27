import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App, Form, Tabs, Typography } from 'antd';
import {
  FileSearchOutlined,
  FolderOutlined,
  PlaySquareOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { adminFetch, PIPELINE_FETCH_INIT } from '../lib/api';
import { PageBackNav } from '../components/PageBackNav';
import { PageShell } from '../components/PageShell';
import { StandardAdminPage } from '../components/StandardAdminPage';
import { buildAgentStages, type AgentStage } from '../pipeline-agents';
import { JobDetailFilesTab } from './job-detail/JobDetailFilesTab';
import { JobDetailOverviewTab } from './job-detail/JobDetailOverviewTab';
import { JobDetailPipelineTab } from './job-detail/JobDetailPipelineTab';
import { JobDetailTuneTab, type TuneFormValues } from './job-detail/JobDetailTuneTab';
import type { ArtifactRow, PipelineAction } from './job-detail/types';

const MAIN_TAB_KEYS = ['overview', 'pipeline', 'tune', 'files'] as const;
type MainTabKey = (typeof MAIN_TAB_KEYS)[number];

function isMainTabKey(v: string | null): v is MainTabKey {
  return v !== null && (MAIN_TAB_KEYS as readonly string[]).includes(v);
}

export default function JobDetail() {
  const { jobId: raw } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = raw ? decodeURIComponent(raw) : '';
  const { message } = App.useApp();
  const [form] = Form.useForm<TuneFormValues>();
  const [metaText, setMetaText] = useState('');
  const [metaFetchOk, setMetaFetchOk] = useState<boolean | null>(null);
  const [jobHeadline, setJobHeadline] = useState<string | null>(null);
  const [profileHint, setProfileHint] = useState<string | null>(null);
  const [agentStages, setAgentStages] = useState<AgentStage[]>([]);
  const [artifactFiles, setArtifactFiles] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState<PipelineAction | null>(null);
  const [pipelineResponse, setPipelineResponse] = useState('');
  const [fileSearch, setFileSearch] = useState('');

  const loadAll = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const [metaRes, artRes] = await Promise.all([
        adminFetch(`/admin/api/jobs/${encodeURIComponent(jobId)}/meta`),
        adminFetch(`/admin/api/jobs/${encodeURIComponent(jobId)}/artifacts`),
      ]);
      setMetaFetchOk(metaRes.ok);
      const metaBody = await metaRes.text();
      setMetaText(metaBody);

      let metaObj: unknown = null;
      if (metaRes.ok) {
        try {
          const wrapped = JSON.parse(metaBody) as { meta?: unknown };
          metaObj = wrapped?.meta ?? null;
        } catch {
          metaObj = null;
        }
      }

      let headline: string | null = null;
      let prof: string | null = null;
      if (metaObj && typeof metaObj === 'object') {
        const m = metaObj as { idea?: string; profileId?: string };
        if (m.idea?.trim()) headline = m.idea.trim().slice(0, 180);
        if (m.profileId?.trim()) prof = m.profileId.trim();
      }
      setJobHeadline(headline);
      setProfileHint(prof);

      let files: ArtifactRow[] = [];
      if (artRes.ok) {
        const j = (await artRes.json()) as {
          ok?: boolean;
          files?: ArtifactRow[];
        };
        files = j.files ?? [];
      }
      setArtifactFiles(files);
      const rels = new Set(files.map((f) => f.rel));
      setAgentStages(buildAgentStages(metaObj, rels));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const copyMeta = async () => {
    await navigator.clipboard.writeText(metaText);
    message.success('Đã sao chép phản hồi meta');
  };

  const copyJobId = async () => {
    await navigator.clipboard.writeText(jobId);
    message.success('Đã sao chép jobId');
  };

  const finalArtifact = useMemo(
    () => artifactFiles.find((f) => f.rel === 'final/output.mp4'),
    [artifactFiles],
  );

  const relSet = useMemo(
    () => new Set(artifactFiles.map((f) => f.rel)),
    [artifactFiles],
  );
  const hasMetaFile = relSet.has('meta.json');
  const hasVoice = relSet.has('audio/voice.mp3');
  const hasConcat = relSet.has('media/scenes/concat.mp4');

  const totalArtifactBytes = useMemo(
    () => artifactFiles.reduce((s, f) => s + f.size, 0),
    [artifactFiles],
  );

  const filteredArtifactFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return artifactFiles;
    return artifactFiles.filter((f) => f.rel.toLowerCase().includes(q));
  }, [artifactFiles, fileSearch]);

  const mainTab: MainTabKey = useMemo(() => {
    const t = searchParams.get('tab');
    return isMainTabKey(t) ? t : 'overview';
  }, [searchParams]);

  const stageIds = useMemo(() => agentStages.map((s) => s.id), [agentStages]);

  const activePipelineStageKey = useMemo(() => {
    const fromUrl = searchParams.get('stage');
    if (fromUrl && stageIds.includes(fromUrl)) return fromUrl;
    return stageIds[0] ?? 'config';
  }, [searchParams, stageIds]);

  const setMainTabInUrl = useCallback(
    (key: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPipelineStageInUrl = useCallback(
    (stageId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', 'pipeline');
          next.set('stage', stageId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const tuningExtras = (): Record<string, unknown> => {
    const v = form.getFieldsValue();
    const out: Record<string, unknown> = {};
    if (v.profileId?.trim()) out.profileId = v.profileId.trim();
    if (v.bgmPath?.trim()) out.bgmPath = v.bgmPath.trim();
    if (v.tuningJson?.trim()) {
      try {
        out.tuning = JSON.parse(v.tuningJson) as object;
      } catch {
        message.error('tuning JSON không hợp lệ');
        throw new Error('invalid tuning');
      }
    }
    return out;
  };

  const runPipeline = useCallback(
    async (
      url: '/jobs/render' | '/jobs/render/from-video',
      body: Record<string, unknown>,
      action: PipelineAction,
    ) => {
      setPipelineBusy(action);
      setPipelineResponse('');
      try {
        let extras: Record<string, unknown>;
        try {
          extras = tuningExtras();
        } catch {
          setPipelineBusy(null);
          return;
        }
        const payload = { jobId, ...extras, ...body };
        const r = await adminFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          ...PIPELINE_FETCH_INIT,
        });
        const t = await r.text();
        setPipelineResponse(`${r.status} ${r.statusText}\n${t}`);
        if (r.ok) {
          message.success('Pipeline chạy xong — đã làm mới danh sách file');
          await loadAll();
        } else {
          message.warning('Pipeline báo lỗi — xem chi tiết dưới');
        }
      } catch (e) {
        setPipelineResponse(e instanceof Error ? e.message : String(e));
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setPipelineBusy(null);
      }
    },
    [jobId, loadAll, message, form],
  );

  if (!jobId) {
    return (
      <PageShell>
        <Typography.Text type="secondary">Thiếu jobId trong URL.</Typography.Text>
      </PageShell>
    );
  }

  const tabItems = [
    {
      key: 'overview',
      label: (
        <span>
          <PlaySquareOutlined /> Tổng quan
        </span>
      ),
      children: (
        <JobDetailOverviewTab
          jobId={jobId}
          loading={loading}
          metaFetchOk={metaFetchOk}
          profileHint={profileHint}
          jobHeadline={jobHeadline}
          hasMetaFile={hasMetaFile}
          hasVoice={hasVoice}
          hasConcat={hasConcat}
          finalArtifact={finalArtifact}
          artifactCount={artifactFiles.length}
          totalArtifactBytes={totalArtifactBytes}
          onReload={() => void loadAll()}
          onCopyJobId={() => void copyJobId()}
        />
      ),
    },
    {
      key: 'pipeline',
      label: (
        <span>
          <FolderOutlined /> Pipeline
        </span>
      ),
      children: (
        <JobDetailPipelineTab
          jobId={jobId}
          agentStages={agentStages}
          activeStageKey={activePipelineStageKey}
          onStageChange={setPipelineStageInUrl}
        />
      ),
    },
    {
      key: 'tune',
      label: (
        <span>
          <ToolOutlined /> Tune
        </span>
      ),
      children: (
        <JobDetailTuneTab
          form={form}
          hasMetaFile={hasMetaFile}
          hasVoice={hasVoice}
          hasConcat={hasConcat}
          pipelineBusy={pipelineBusy}
          pipelineResponse={pipelineResponse}
          runPipeline={(url, body, action) => void runPipeline(url, body, action)}
        />
      ),
    },
    {
      key: 'files',
      label: (
        <span>
          <FileSearchOutlined /> File & debug
        </span>
      ),
      children: (
        <JobDetailFilesTab
          loading={loading}
          metaText={metaText}
          filteredArtifactFiles={filteredArtifactFiles}
          fileSearch={fileSearch}
          onFileSearchChange={setFileSearch}
          onCopyMeta={() => void copyMeta()}
        />
      ),
    },
  ];

  const jobDescription = jobHeadline?.trim()
    ? jobHeadline.trim()
    : 'Artifact, pipeline, tune và file trên disk (DATA_ROOT/jobs).';

  return (
    <StandardAdminPage
      leading={<PageBackNav label="Quay lại danh sách job" onBack={() => navigate('/jobs')} />}
      title={jobId}
      description={jobDescription}
    >
      <Tabs
        activeKey={mainTab}
        onChange={setMainTabInUrl}
        items={tabItems}
        destroyInactiveTabPane={false}
      />
    </StandardAdminPage>
  );
}

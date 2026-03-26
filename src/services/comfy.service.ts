import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import PQueue from 'p-queue';
import {
  COMFY_NODE_LOAD_IMAGE,
  COMFY_NODE_LOAD_DRIVING_VIDEO,
  COMFY_NODE_LOAD_AUDIO,
  COMFY_NODE_VIDEO_COMBINE,
} from '../config/comfy-workflow.js';
import { resolveComfyDrivingSourcePath } from '../config/driving-videos.js';
import { pipelineLog } from '../shared/pipeline-log.js';
import { notifyTelegram } from './telegram-notify.js';

export class ComfyOutOfMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComfyOutOfMemoryError';
  }
}

export class ComfyWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComfyWorkflowError';
  }
}

type ComfyPrompt = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function comfyBaseUrl(): string {
  const v = process.env.COMFY_HTTP_URL?.trim();
  return (v || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

function wsUrlForClient(clientId: string): string {
  const explicit = process.env.COMFY_WS_URL;
  if (explicit) {
    const base = explicit.replace(/\/$/, '');
    return base.includes('?')
      ? `${base}&clientId=${encodeURIComponent(clientId)}`
      : `${base}?clientId=${encodeURIComponent(clientId)}`;
  }
  const h = new URL(comfyBaseUrl());
  const proto = h.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${h.host}/ws?clientId=${encodeURIComponent(clientId)}`;
}

function looksLikeComfyRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'main.py')) &&
    fs.existsSync(path.join(dir, 'input')) &&
    fs.existsSync(path.join(dir, 'output'))
  );
}

/**
 * Thư mục gốc ComfyUI (có main.py, input/, output/). Dùng khi không set COMFY_INPUT_DIR.
 */
function resolveComfyRoot(): string | null {
  const fromEnv = process.env.COMFY_ROOT?.trim();
  if (fromEnv && looksLikeComfyRoot(path.resolve(fromEnv))) {
    return path.resolve(fromEnv);
  }
  const candidates = [
    path.resolve(process.cwd(), '..', 'ComfyUI'),
    path.join(process.env.HOME ?? '', 'SideProject', 'ComfyUI'),
    path.join(process.env.HOME ?? '', 'ComfyUI'),
  ];
  for (const c of candidates) {
    if (looksLikeComfyRoot(c)) return c;
  }
  return null;
}

function comfyInputDir(): string {
  const explicit = process.env.COMFY_INPUT_DIR?.trim();
  if (explicit) return explicit;
  const root = resolveComfyRoot();
  if (root) return path.join(root, 'input');
  return path.join(process.cwd(), 'shared_data', 'comfy_input');
}

function comfyOutputDir(): string {
  const explicit = process.env.COMFY_OUTPUT_DIR?.trim();
  if (explicit) return explicit;
  const root = resolveComfyRoot();
  if (root) return path.join(root, 'output');
  return path.join(process.cwd(), 'shared_data', 'comfy_output');
}

function workflowPath(): string {
  const v = process.env.WORKFLOW_PATH?.trim();
  return v ? v : path.join(process.cwd(), 'workflows', 'workflow_api.json');
}

function defaultDataRoot(): string {
  if (process.env.DATA_ROOT?.trim()) {
    return path.resolve(process.env.DATA_ROOT.trim());
  }
  return path.join(process.cwd(), 'shared_data');
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Comfy validates LoadImage/VHS/LoadAudio paths only inside its server input dir — not wherever the HTTP client wrote files. */
function hintPromptInputMismatch(body: string, inputDir: string): string {
  if (
    !body.includes('prompt_outputs_failed_validation') &&
    !/Invalid (video|image|audio) file/i.test(body)
  ) {
    return '';
  }
  return (
    `\n\nGợi ý: Comfy chỉ chấp nhận file trong thư mục input của chính process Comfy (mặc định …/ComfyUI/input nếu không truyền --input-directory). ` +
    `App đã copy vào: ${inputDir}. ` +
    `Đặt COMFY_INPUT_DIR (và COMFY_OUTPUT_DIR) trùng ComfyUI/input và ComfyUI/output, hoặc chạy lại Comfy với ` +
    `--input-directory "${inputDir}" và --output-directory tương ứng COMFY_OUTPUT_DIR.`
  );
}

function looksLikeOom(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('out of memory') ||
    t.includes('cuda error') ||
    t.includes('oom') ||
    (t.includes('allocate') && t.includes('vram'))
  );
}

type OutputRef = { filename: string; subfolder?: string; type?: string };

function findVideoOutput(
  outputs: Record<string, Record<string, unknown>>,
  nodeId: string,
): OutputRef | null {
  const node = outputs[nodeId];
  if (!node) return null;
  for (const key of ['videos', 'gifs', 'images'] as const) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && typeof item === 'object' && 'filename' in item) {
        const ref = item as OutputRef;
        if (!ref.filename) continue;
        if (ref.filename.endsWith('.mp4')) return ref;
        if (key === 'videos' || key === 'gifs') return ref;
      }
    }
  }
  return null;
}

function resolveComfyFile(ref: OutputRef): string {
  const sub = ref.subfolder ?? '';
  return path.join(comfyOutputDir(), sub, ref.filename);
}

async function readWorkflow(): Promise<ComfyPrompt> {
  const raw = await fs.promises.readFile(workflowPath(), 'utf8');
  return JSON.parse(raw) as ComfyPrompt;
}

function waitForPromptWs(
  ws: WebSocket,
  promptId: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`Comfy WS timeout ${timeoutMs}ms for ${promptId}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(t);
      ws.removeListener('message', onMsg);
      ws.removeListener('error', onErr);
    }

    function onErr(err: Error) {
      cleanup();
      reject(err);
    }

    function onMsg(data: WebSocket.RawData) {
      let msg: { type?: string; data?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(data)) as {
          type?: string;
          data?: Record<string, unknown>;
        };
      } catch {
        return;
      }
      if (msg.type === 'execution_error') {
        const detail = JSON.stringify(msg.data ?? {});
        void notifyTelegram(
          `Ma Chủ Comfy execution_error: ${detail.slice(0, 3500)}`,
        );
        if (looksLikeOom(detail)) {
          cleanup();
          reject(new ComfyOutOfMemoryError(detail));
          return;
        }
        cleanup();
        reject(new ComfyWorkflowError(detail));
        return;
      }

      if (msg.type === 'executing' && msg.data) {
        const pid = msg.data.prompt_id;
        const node = msg.data.node;
        if (pid === promptId && node === null) {
          cleanup();
          resolve();
        }
      }
    }

    ws.on('message', onMsg);
    ws.once('error', onErr);
  });
}

async function fetchHistory(promptId: string): Promise<Record<string, unknown>> {
  const url = `${comfyBaseUrl()}/history/${encodeURIComponent(promptId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Comfy history HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export type ComfyRenderParams = {
  jobId: string;
  masterFacePath: string;
  voiceAudioPath: string;
  rawVideoOutPath: string;
  /**
   * Scene `emotion` from kịch bản (cảnh đầu / hook chọn clip driving cho Comfy).
   * Map file trong `DATA_ROOT/assets/driving/` (xem `src/config/driving-videos.ts`), trừ khi set `COMFY_DRIVING_VIDEO`.
   */
  drivingEmotion: string;
};

export class ComfyService {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly oomMax = Number(process.env.COMFY_OOM_MAX_RETRIES ?? '3');

  renderVideo(params: ComfyRenderParams): Promise<void> {
    return this.queue.add(() => this.renderVideoOnceWithOomRetry(params)) as Promise<void>;
  }

  private async renderVideoOnceWithOomRetry(
    params: ComfyRenderParams,
  ): Promise<void> {
    let oomRetries = 0;
    while (true) {
      try {
        await this.renderVideoOnce(params);
        return;
      } catch (e) {
        if (
          e instanceof ComfyOutOfMemoryError &&
          oomRetries < this.oomMax
        ) {
          oomRetries += 1;
          pipelineLog('agent.comfy.oom_retry', {
            jobId: params.jobId,
            attempt: oomRetries,
            maxRetries: this.oomMax,
          });
          const delay = Number(process.env.COMFY_OOM_RETRY_SEC ?? '30') * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  private async renderVideoOnce(params: ComfyRenderParams): Promise<void> {
    const { jobId, masterFacePath, voiceAudioPath, rawVideoOutPath, drivingEmotion } =
      params;
    if (!fs.existsSync(masterFacePath)) {
      throw new Error(`Master face not found: ${masterFacePath}`);
    }
    if (!fs.existsSync(voiceAudioPath)) {
      throw new Error(`Voice audio not found: ${voiceAudioPath}`);
    }

    const inputDir = comfyInputDir();
    await fs.promises.mkdir(inputDir, { recursive: true });

    const ext = path.extname(masterFacePath) || '.png';
    const imageName = `${jobId}_master${ext}`;
    const audioName = `${jobId}_voice.mp3`;
    const drivingName = `${jobId}_driving.mp4`;
    const drivingSrc = resolveComfyDrivingSourcePath(
      defaultDataRoot(),
      drivingEmotion,
    );
    pipelineLog('comfy.driving', {
      drivingEmotion,
      drivingSrc,
      drivingSrcRelative: path.relative(defaultDataRoot(), drivingSrc),
      comfyInputBasename: drivingName,
      jobId,
    });

    await fs.promises.copyFile(
      masterFacePath,
      path.join(inputDir, imageName),
    );
    await fs.promises.copyFile(voiceAudioPath, path.join(inputDir, audioName));
    await fs.promises.copyFile(
      drivingSrc,
      path.join(inputDir, drivingName),
    );

    const prompt = deepClone(await readWorkflow());
    const loadImg = prompt[COMFY_NODE_LOAD_IMAGE];
    const loadVid = prompt[COMFY_NODE_LOAD_DRIVING_VIDEO];
    const loadAud = prompt[COMFY_NODE_LOAD_AUDIO];
    if (!loadImg?.inputs || !loadVid?.inputs || !loadAud?.inputs) {
      throw new Error(
        'Workflow missing LoadImage / VHS_LoadVideoFFmpeg / LoadAudio nodes',
      );
    }
    loadImg.inputs.image = imageName;
    // workflow_api.json node "7" — VHS_LoadVideoFFmpeg `video` = basename in Comfy input/
    loadVid.inputs.video = drivingName;
    loadAud.inputs.audio = audioName;

    const clientId = randomUUID();
    const ws = new WebSocket(wsUrlForClient(clientId));

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const promptRes = await fetch(`${comfyBaseUrl()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: clientId }),
    });

    if (!promptRes.ok) {
      const body = await promptRes.text().catch(() => '');
      ws.close();
      if (looksLikeOom(body)) throw new ComfyOutOfMemoryError(body);
      void notifyTelegram(
        `Ma Chủ Comfy /prompt failed: ${promptRes.status} ${body.slice(0, 500)}`,
      );
      const hint = hintPromptInputMismatch(body, inputDir);
      throw new ComfyWorkflowError(`prompt ${promptRes.status}: ${body}${hint}`);
    }

    const promptJson = (await promptRes.json()) as { prompt_id?: string };
    const promptId = promptJson.prompt_id;
    if (!promptId) {
      ws.close();
      throw new Error('Comfy /prompt missing prompt_id');
    }

    pipelineLog('agent.comfy.prompt_submitted', { jobId, promptId });

    const timeoutMs = Number(process.env.COMFY_WS_TIMEOUT_MS ?? '3600000');
    try {
      await waitForPromptWs(ws, promptId, timeoutMs);
    } finally {
      ws.close();
    }

    await new Promise((r) => setTimeout(r, 500));
    const hist = await fetchHistory(promptId);
    const entry = hist[promptId] as
      | { outputs?: Record<string, Record<string, unknown>> }
      | undefined;
    const outputs = entry?.outputs;
    if (!outputs) {
      throw new Error(`Comfy history has no outputs for ${promptId}`);
    }

    const ref = findVideoOutput(outputs, COMFY_NODE_VIDEO_COMBINE);
    if (!ref) {
      throw new Error(
        `No video output on node ${COMFY_NODE_VIDEO_COMBINE}`,
      );
    }

    const srcFile = resolveComfyFile(ref);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Comfy output missing on disk: ${srcFile}`);
    }

    await fs.promises.mkdir(path.dirname(rawVideoOutPath), {
      recursive: true,
    });
    await fs.promises.copyFile(srcFile, rawVideoOutPath);

    pipelineLog('agent.comfy.video_saved', {
      jobId,
      promptId,
      rawVideoBasename: path.basename(rawVideoOutPath),
      comfyOutputBasename: path.basename(srcFile),
    });
  }
}

export const comfyService = new ComfyService();

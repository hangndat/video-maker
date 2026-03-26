import OpenAI from 'openai';
import { observeOpenAI } from '@langfuse/openai';
import { pipelineLog } from '../shared/pipeline-log.js';
import {
  scriptOutputSchema,
  scriptScenesFullText,
  type ScriptOutput,
} from '../types/script-schema.js';

const CHARS_PER_SEC = Number(process.env.CHARS_PER_SECOND ?? '14');

const CINEMATIC_SYSTEM = `Bạn là biên kịch kênh "Điện ảnh hóa kiến thức" — giọng kể tri thức, cinematic, tiếng Việt tự nhiên, gây tò mò và tôn trọng người nghe.

Trả về MỘT object JSON: "scenes" (và tùy chọn "duration_estimate"). Không có key khác.

**Cấu trúc bắt buộc: đúng 5 cảnh** id 1→5:
1. **Hook** (1–2 câu ngắn): câu hỏi ngược hoặc khẳng định gây sốc (~3 giây đọc).
2–4. **Ba sự thật** tăng tiến (mỗi cảnh 2–4 câu, ~10–12 giây đọc): cái sau bất ngờ hơn cái trước.
5. **CTA** (1–2 câu): kêu gọi comment / tương tác nhẹ nhàng.

Mỗi phần tử scenes có:
- "id": 1..5
- "text": thoại **thuần** cho TTS (tiếng Việt), **không** dùng markdown **...**
- "motion": một trong: "static" | "zoom_mild" | "zoom_in_fast" | "laugh_zoom" | "pan_left" | "camera_shake" — gợi cảm giác hình: hook có thể "zoom_in_fast" hoặc "camera_shake"; sự thật thường "zoom_mild" / "pan_left"; CTA "static" hoặc "zoom_mild".
- "emphasisWords" (tuỳ chọn): tối đa 6 chuỗi — từ/cụm sẽ hiển thị **đậm** trên phụ đề (phải xuất hiện nguyên văn trong "text").
- "videoPath" (tuỳ chọn): nếu có, đường dẫn MP4 B-roll **relative DATA_ROOT** (vd. "assets/broll/topic.mp4"). Thường **bỏ trống** — pipeline dùng placeholder từ preset.
- "videoMode" (tuỳ chọn): "freeze_last" | "loop" — mặc định theo preset.
- "sfxKey" (tuỳ chọn): key trong preset sfx map (vd. "hook") — thường bỏ trống.

Tổng thoại mục tiêu ~45–60 giây. duration_estimate (tuỳ chọn): số giây ước lượng.`;

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

function roughDurationFromScenes(textJoined: string): number {
  return Math.max(1, textJoined.length / CHARS_PER_SEC);
}

export type GenerateScriptOptions = {
  sessionId?: string;
  temperature?: number;
  model?: string;
};

export class ScriptService {
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY ?? '') {}

  async generateScript(
    idea: string,
    options?: GenerateScriptOptions,
  ): Promise<ScriptOutput> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');

    const model =
      options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const temperature =
      options?.temperature ??
      Number(process.env.OPENAI_TEMPERATURE ?? '0.75');

    const base = new OpenAI({
      apiKey: this.apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const sessionId = options?.sessionId?.slice(0, 200);
    const client = observeOpenAI(
      base,
      sessionId
        ? { sessionId, userId: sessionId, traceName: 'cinematic_script' }
        : { traceName: 'cinematic_script' },
    );

    let lastErr: unknown;
    const fixHint = `JSON sai. Trả DUY NHẤT: {"scenes":[{"id":1,"text":"...","motion":"static|zoom_mild|zoom_in_fast|laugh_zoom|pan_left|camera_shake","emphasisWords":["..."],"videoPath":"optional","videoMode":"optional","sfxKey":"optional"}, ... đúng 5 phần tử id 1..5]}`;

    pipelineLog('agent.openai.script.start', {
      ideaLength: idea.length,
      model,
      sessionId: sessionId ?? null,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      const userContent =
        attempt === 0
          ? `Chủ đề / góc nhìn video: ${idea}`
          : `${fixHint}\nChủ đề: ${idea}`;

      try {
        const completion = await client.chat.completions.create({
          model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CINEMATIC_SYSTEM },
            { role: 'user', content: userContent },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? '';
        if (!raw) {
          lastErr = new Error('Empty OpenAI response');
          pipelineLog('agent.openai.script.attempt_failed', {
            attempt,
            reason: 'empty_response',
            sessionId: sessionId ?? null,
          });
          continue;
        }
        const parsed = JSON.parse(stripJsonFence(raw));
        const safe = scriptOutputSchema.safeParse(parsed);
        if (!safe.success) {
          lastErr = safe.error;
          pipelineLog('agent.openai.script.attempt_failed', {
            attempt,
            reason: 'schema_validation',
            issueCount: safe.error.issues.length,
            sessionId: sessionId ?? null,
          });
          continue;
        }
        if (safe.data.scenes.length !== 5) {
          lastErr = new Error(`Expected 5 scenes, got ${safe.data.scenes.length}`);
          pipelineLog('agent.openai.script.attempt_failed', {
            attempt,
            reason: 'scene_count',
            sessionId: sessionId ?? null,
          });
          continue;
        }
        const ids = safe.data.scenes.map((s) => s.id).sort((a, b) => a - b);
        if (ids.join(',') !== '1,2,3,4,5') {
          lastErr = new Error('Scene ids must be exactly 1,2,3,4,5');
          pipelineLog('agent.openai.script.attempt_failed', {
            attempt,
            reason: 'scene_ids',
            sessionId: sessionId ?? null,
          });
          continue;
        }
        const { scenes, duration_estimate } = safe.data;
        const textJoined = scriptScenesFullText(scenes);
        pipelineLog('agent.openai.script.complete', {
          sceneCount: scenes.length,
          duration_estimate:
            duration_estimate ?? roughDurationFromScenes(textJoined),
          model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          sessionId: sessionId ?? null,
        });
        return {
          scenes,
          duration_estimate:
            duration_estimate ?? roughDurationFromScenes(textJoined),
        };
      } catch (e) {
        lastErr = e;
        pipelineLog('agent.openai.script.attempt_failed', {
          attempt,
          reason: 'exception',
          message: e instanceof Error ? e.message : String(e),
          sessionId: sessionId ?? null,
        });
      }
    }

    throw new Error(
      `OpenAI JSON validation failed after 3 tries: ${String(lastErr)}`,
    );
  }
}

export const scriptService = new ScriptService();

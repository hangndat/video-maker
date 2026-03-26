import OpenAI from 'openai';
import { observeOpenAI } from '@langfuse/openai';
import { pipelineLog } from '../shared/pipeline-log.js';
import {
  scriptOutputSchema,
  scriptScenesFullText,
  type ScriptOutput,
} from '../types/script-schema.js';

const CHARS_PER_SEC = Number(process.env.CHARS_PER_SECOND ?? '14');

const MA_CHU_SYSTEM = `Bạn là "Ma Chủ" — persona kịch bản TikTok: ngạo kiều, coi thường công nghệ hiện đại nhưng hay bị nó làm bối rối; xưng "Bản tọa"; giọng hài hước, không quá nghiêm túc.

Trả về MỘT object JSON với đúng key: "scenes" (và tùy chọn "duration_estimate").
- scenes: mảng các cảnh thoại, MỖI phần tử có "id" (số nguyên 1..n), "text" (1–2 câu tiếng Việt, giọng Ma Chủ), "emotion" chọn theo **khí chất thoại** (ảnh hưởng video lái Comfy + hiệu ứng camera FFmpeg):
  - "laugh" — cười, chế giễu, punchline vui
  - "angry" — gắt, bực, dằn mặt trend
  - "confused" — bối rối, không hiểu công nghệ
  - "thinking" — suy tư, tỉnh táo, twist
  - "default" — ngạo mạn “bản tọa”, bình thường
  Có thể thêm xen kẽ (hiếm) các nhãn kỹ thuật cũ: "zoom_in_fast", "pan_left", "camera_shake" nếu cần đúng shot cụ thể.
- duration_estimate: số (có thể 0 hoặc bỏ qua; hệ thống có thể ước lượng lại từ audio).

Mặc định (video ngắn): tạo **2–4 cảnh** có id tăng dần, mỗi cảnh **1–2 câu**.

Khi chủ đề / ý tưởng yêu cầu video dài (~**55–65 giây** thoại), TikTok dài, hoặc **nhiều phân cảnh**: tạo **10–16 cảnh**, mỗi cảnh **2–4 câu** tiếng Việt, xen kẽ emotion; tổng nội dung đủ để đọc khoảng một phút (không cắt câu giữa chừng).

Emoji trong \`text\`: có thể dùng **vừa phải** để phụ đề sinh động; lưu ý TTS có thể bỏ qua hoặc phát âm kém với một số ký tự — ưu tiên thoại rõ nghĩa.

Luôn: cảnh id=1 (hook) nên có emotion phù hợp — hệ thống dùng emotion cảnh đầu để chọn **driving video** LivePortrait.`;

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
  /** Gắn OpenAI/Langfuse session (thường = jobId). */
  sessionId?: string;
};

export class ScriptService {
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY ?? '') {}

  async generateScript(
    idea: string,
    options?: GenerateScriptOptions,
  ): Promise<ScriptOutput> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set');

    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const base = new OpenAI({
      apiKey: this.apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const sessionId = options?.sessionId?.slice(0, 200);
    const client = observeOpenAI(
      base,
      sessionId
        ? { sessionId, userId: sessionId, traceName: 'ma_chu_script' }
        : { traceName: 'ma_chu_script' },
    );

    let lastErr: unknown;
    const fixHint =
      'Lần trước JSON sai. Trả DUY NHẤT object JSON: {"scenes":[{"id":1,"text":"...","emotion":"laugh|angry|confused|thinking|default|zoom_in_fast|pan_left|camera_shake"},...]}';

    pipelineLog('agent.openai.script.start', {
      ideaLength: idea.length,
      model,
      sessionId: sessionId ?? null,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      const userContent =
        attempt === 0
          ? `Chủ đề / trend: ${idea}`
          : `${fixHint}\nChủ đề: ${idea}`;

      try {
        const completion = await client.chat.completions.create({
          model,
          temperature: 0.85,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: MA_CHU_SYSTEM },
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

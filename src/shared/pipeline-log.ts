import { getLogContext } from './log-context.js';
import { logger } from './logger.js';

function shouldEmitPipelineEvents(): boolean {
  const pl = process.env.PIPELINE_LOG?.trim().toLowerCase();
  if (pl === '1' || pl === 'true' || pl === 'yes') return true;
  const lvl = process.env.LOG_LEVEL?.trim().toLowerCase();
  return lvl === 'debug' || lvl === 'trace';
}

/**
 * Domain / orchestration trace. Enable: PIPELINE_LOG=1|true|yes or LOG_LEVEL=debug|trace.
 */
export function pipelineLog(step: string, detail?: Record<string, unknown>): void {
  if (!shouldEmitPipelineEvents()) return;
  const ctx = getLogContext();
  const component = step.startsWith('agent.') ? 'agent' : 'pipeline';
  logger.info(
    {
      component,
      step,
      ...ctx,
      ...(detail ?? {}),
    },
    component,
  );
}

/**
 * Debug trace for orchestration. Enable: PIPELINE_LOG=1 hoặc PIPELINE_LOG=true
 */
export function pipelineLog(step: string, detail?: Record<string, unknown>): void {
  const v = process.env.PIPELINE_LOG?.trim().toLowerCase();
  if (v !== '1' && v !== 'true' && v !== 'yes') return;
  const suffix = detail && Object.keys(detail).length
    ? ` ${JSON.stringify(detail)}`
    : '';
  console.error(`[pipeline] ${step}${suffix}`);
}

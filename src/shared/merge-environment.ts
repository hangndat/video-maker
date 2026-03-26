/**
 * Deep-merge một cấp: `scene` ghi đè `job` cho cùng key; nếu cả hai là object thuần (không array),
 * merge con một lớp (vd. job `lighting: { key: soft }` + scene `lighting: { color: green }`).
 */
export function mergeEnvironmentContext(
  jobEnv: Record<string, unknown> | undefined,
  sceneEnv: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base = { ...(jobEnv ?? {}) };
  const over = sceneEnv ?? {};
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      b !== null &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      out[k] = {
        ...(b as Record<string, unknown>),
        ...(v as Record<string, unknown>),
      };
    } else {
      out[k] = v;
    }
  }
  return out;
}

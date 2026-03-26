import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = {
  requestId?: string;
  jobId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(
  ctx: LogContext,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore();
  return storage.run({ ...parent, ...ctx }, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

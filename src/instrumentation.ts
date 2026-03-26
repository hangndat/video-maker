import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

let sdk: NodeSDK | undefined;

function shouldEnableLangfuseTracing(): boolean {
  if (process.env.LANGFUSE_TRACING_ENABLED === '0') return false;
  const pk = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const sk = process.env.LANGFUSE_SECRET_KEY?.trim();
  return Boolean(pk && sk);
}

function start(): void {
  if (!shouldEnableLangfuseTracing() || sdk) return;
  sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        exportMode:
          process.env.LANGFUSE_OTEL_EXPORT_MODE === 'immediate'
            ? 'immediate'
            : 'batched',
      }),
    ],
  });
  sdk.start();
}

start();

export async function shutdownLangfuseOtel(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}

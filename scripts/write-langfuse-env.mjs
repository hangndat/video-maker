#!/usr/bin/env node
/**
 * Ghi .env.langfuse sạch từ gen-langfuse-seed.sh.
 * Tránh: npm run langfuse:seed > .env.langfuse (npm có thể in dòng "> pkg@…" vào file).
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = join(root, 'scripts/gen-langfuse-seed.sh');

const out = execSync(`bash "${sh}"`, {
  encoding: 'utf8',
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
});

writeFileSync(join(root, '.env.langfuse'), out, 'utf8');
console.error('Wrote .env.langfuse');
console.error('Key cho app .env: đọc LANGFUSE_INIT_PROJECT_PUBLIC_KEY / SECRET_KEY trong file trên.');

// Run a check script that a later task writes (stage 3b / 3c §11: package entries exist before their scripts do).
//   node scripts/lib/optional.mjs <script.mjs> [args…]
// Missing script → prints a note and exits 0 (no-op); present → runs it with the same args and its exit code.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [script, ...rest] = process.argv.slice(2);
if (!script) { console.error('usage: node scripts/lib/optional.mjs <script.mjs> [args…]'); process.exit(2); }
if (!existsSync(script)) {
  console.log(`[optional] ${script} does not exist yet (written by a later task of this stage) — skipped`);
  process.exit(0);
}
const r = spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);

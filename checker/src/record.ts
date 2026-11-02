// Records live testnet responses for the test fixtures: node src/record.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './check.ts';
import { defaultContext } from './config.ts';
import { recordingFetch, type Tape } from './recording.ts';
import { toYocto } from './units.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = defaultContext();
const cases: [string, string][] = [
  [process.env.CASE_DRAINER || 'leash-drainer-k21owo.testnet', '0.05'],
  [base.trusted_names?.[0] || 'leash-dev-611136.testnet', '0.05'],
  ['wrap.testnet', '0.05'],
  ['leash-dev-61l136.testnet', '0.05'],
  ['no-such-account-leash-7q.testnet', '0.05'],
  ['leash-dev-611136.testnet', '2'],
];
const tape: Tape = {};
const ctx = { ...base, sources: { ...base.sources, fetch: recordingFetch(tape) }, code_memory_file: undefined };
const signals: Record<string, unknown> = {};
for (const [r, amt] of cases) {
  signals[`${r}@${amt}`] = await collect(r, toYocto(amt), ctx);
  await new Promise((ok) => setTimeout(ok, 1500)); // be gentle with the public indexer
}
const out = path.join(here, '..', 'test', 'fixtures');
fs.writeFileSync(path.join(out, 'tape.json'), JSON.stringify(tape, null, 1) + '\n');
fs.writeFileSync(path.join(out, 'context.json'), JSON.stringify({ vault: ctx.vault, registry: ctx.registry, trusted_names: ctx.trusted_names, recorded_at: new Date().toISOString(), cases }, null, 2) + '\n');
console.log(`recorded ${Object.keys(tape).length} responses for ${cases.length} cases`);
for (const [k, v] of Object.entries(signals)) console.log(k, JSON.stringify(v).slice(0, 160));

// Replays recorded testnet responses (test/fixtures/tape.json) through the full collect + score path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../src/check.ts';
import { TESTNET } from '../src/sources.ts';
import { loadTape, replayFetch } from '../src/recording.ts';
import { toYocto } from '../src/units.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const rec = JSON.parse(fs.readFileSync(path.join(dir, 'context.json'), 'utf8'));
const ctx = {
  sources: { ...TESTNET, rpc: 'https://rpc.testnet.fastnear.com', indexer: 'https://api-testnet.nearblocks.io/v1', fetch: replayFetch(loadTape(path.join(dir, 'tape.json'))) },
  vault: rec.vault,
  registry: rec.registry,
  trusted_names: rec.trusted_names,
  score: { now_ms: Date.parse(rec.recorded_at) },
};
const run = (r: string, amt: string) => check(r, toYocto(amt), ctx);
const codes = (x: { reasons: { code: string }[] }) => x.reasons.map((r) => r.code);

test('drainer flagged in the shared registry -> block with evidence', async () => {
  const r = await run('leash-drainer-k21owo.testnet', '0.05');
  assert.equal(r.verdict, 'block');
  assert.ok(codes(r).includes('registry_flagged'));
  assert.match(r.signals.registry!.evidence[0], /^https:\/\//);
});

test('trusted, already-paid receiver, small amount -> not blocked', async () => {
  const r = await run('leash-dev-611136.testnet', '0.05');
  assert.notEqual(r.verdict, 'block');
  assert.ok(!codes(r).includes('first_payment'));
  assert.ok(!codes(r).includes('registry_flagged'));
});

test('same receiver over the vault cap -> block before the chain rejects it', async () => {
  const r = await run('leash-dev-611136.testnet', '2');
  assert.equal(r.verdict, 'block');
  assert.ok(codes(r).includes('over_cap'));
});

test('old, busy contract the vault never paid -> warn (first payment) only', async () => {
  const r = await run('wrap.testnet', '0.05');
  assert.equal(r.verdict, 'warn');
  assert.ok(codes(r).includes('first_payment'));
  assert.ok(!codes(r).includes('young_account'));
  assert.ok(!codes(r).includes('low_activity'));
});

test('lookalike of the trusted receiver (1 -> l) -> block', async () => {
  const r = await run('leash-dev-61l136.testnet', '0.05');
  assert.equal(r.verdict, 'block');
  assert.ok(codes(r).includes('lookalike'));
});

test('named account that does not exist -> block', async () => {
  const r = await run('no-such-account-leash-7q.testnet', '0.05');
  assert.equal(r.verdict, 'block');
  assert.ok(codes(r).includes('account_missing'));
});

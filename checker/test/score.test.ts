import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, looksLike, isValidAccountId } from '../src/score.ts';
import { toYocto } from '../src/units.ts';
import type { Signals } from '../src/types.ts';

const NOW = Date.parse('2026-11-02T00:00:00Z');
const DAY = 86_400_000;
const clean = (): Signals => ({
  receiver: 'shop.testnet',
  amount_yocto: toYocto('0.1'),
  account: { exists: true, is_contract: false, code_hash: '11111111111111111111111111111111', balance_yocto: '1' },
  history: { indexed: true, created_ms: NOW - 400 * DAY, tx_count: 120, last_deploy_ms: null },
  code_seen_before: null,
  vault: { known: true, blocked: false, per_payment_cap_yocto: toYocto('1'), review_above_yocto: toYocto('0.5') },
  registry: { flagged: false, confirmed: false, dismissed: false, distinct_reporters: 0, reasons: [], evidence: [] },
  trusted_names: ['shop.testnet'],
});
const s = (patch: (x: Signals) => void) => { const x = clean(); patch(x); return score(x, { now_ms: NOW }); };

test('clean receiver -> allow', () => {
  const r = score(clean(), { now_ms: NOW });
  assert.equal(r.verdict, 'allow');
  assert.equal(r.score, 0);
});
test('young account -> warn', () => assert.equal(s((x) => { x.history!.created_ms = NOW - DAY; }).verdict, 'warn'));
test('low activity -> warn', () => assert.equal(s((x) => { x.history!.tx_count = 1; }).verdict, 'warn'));
test('not indexed -> warn', () => assert.equal(s((x) => { x.history!.indexed = false; }).verdict, 'warn'));
test('code changed since last check -> warn', () => {
  const r = s((x) => { x.account!.is_contract = true; x.account!.code_hash = 'NEWHASH1'; x.code_seen_before = 'OLDHASH1'; });
  assert.equal(r.verdict, 'warn');
  assert.ok(r.reasons.some((q) => q.code === 'code_changed'));
});
test('recent deploy -> warn', () => assert.equal(s((x) => { x.account!.is_contract = true; x.history!.last_deploy_ms = NOW - DAY; }).verdict, 'warn'));
test('unconfirmed report -> warn; dismissed report -> allow', () => {
  assert.equal(s((x) => { x.registry!.distinct_reporters = 1; x.registry!.reasons = ['spam']; }).verdict, 'warn');
  assert.equal(s((x) => { x.registry!.distinct_reporters = 1; x.registry!.dismissed = true; }).verdict, 'allow');
});
test('registry flagged -> block', () => assert.equal(s((x) => { x.registry!.flagged = true; }).verdict, 'block'));
test('registry down -> warn (agent must ask a human; the contract still fails closed)', () =>
  assert.equal(s((x) => { x.registry = null; }).verdict, 'warn'));
test('vault blocklist -> block', () => assert.equal(s((x) => { x.vault!.blocked = true; }).verdict, 'block'));
test('over cap -> block; above review -> warn', () => {
  assert.equal(s((x) => { x.amount_yocto = toYocto('1.5'); }).verdict, 'block');
  assert.equal(s((x) => { x.amount_yocto = toYocto('0.6'); }).verdict, 'warn');
});
test('unused implicit account -> warn, missing named account -> block', () => {
  assert.equal(s((x) => { x.receiver = 'a'.repeat(64); x.account!.exists = false; }).verdict, 'warn');
  assert.equal(s((x) => { x.receiver = 'gone.testnet'; x.account!.exists = false; }).verdict, 'block');
});
test('lookalikes', () => {
  assert.ok(looksLike('sh0p.testnet', 'shop.testnet'));
  assert.ok(looksLike('rnarket.near', 'market.near'));
  assert.ok(looksLike('paymentz.near', 'payments.near'));
  assert.ok(!looksLike('alice.near', 'bob.near'));
  assert.equal(s((x) => { x.receiver = 'sh0p.testnet'; }).verdict, 'block');
});
test('invalid account id -> block', () => {
  assert.ok(!isValidAccountId('Bad..id'));
  assert.equal(s((x) => { x.receiver = 'UPPER.testnet'; }).verdict, 'block');
});
test('toYocto exact', () => {
  assert.equal(toYocto('0.05'), '50000000000000000000000');
  assert.equal(toYocto('1'), '1000000000000000000000000');
  assert.throws(() => toYocto('1e3'));
});

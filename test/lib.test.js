import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNear, ownerCommand, describeKey, isValidAccountId, viewParams, decodeResult } from '../lib.js';

test('formatNear', () => {
  assert.equal(formatNear('1000000000000000000000000'), '1 NEAR');
  assert.equal(formatNear('50000000000000000000000'), '0.05 NEAR');
  assert.equal(formatNear('0'), '0 NEAR');
  assert.equal(formatNear(null), '—');
});
test('ownerCommand builds a near-cli-rs call signed by the owner keychain, quoting args', () => {
  const c = ownerCommand({ contract: 'v.testnet', method: 'approve', args: { id: 1 }, signer: 'o.testnet' });
  assert.equal(c, `near contract call-function as-transaction v.testnet approve json-args '{"id":1}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as o.testnet network-config testnet sign-with-keychain send`);
  const r = ownerCommand({ contract: 'r.testnet', method: 'report', args: { reason: "it's bad" }, signer: 'o.testnet' });
  assert.ok(r.includes(`'{"reason":"it'\\''s bad"}'`));
  assert.throws(() => ownerCommand({ contract: 'x; rm -rf /', method: 'm', args: {}, signer: 'o.testnet' }));
});
test('describeKey', () => {
  assert.equal(describeKey({ access_key: { permission: 'FullAccess' } }).kind, 'full access');
  const d = describeKey({ access_key: { permission: { FunctionCall: { allowance: '250000000000000000000000', method_names: ['pay'], receiver_id: 'v.testnet' } } } });
  assert.match(d.detail, /may call pay on v\.testnet; gas allowance left 0\.25 NEAR/);
});
test('view params round-trip', () => {
  const p = viewParams('v.testnet', 'is_known', { account: 'a.testnet' });
  assert.equal(JSON.parse(atob(p.args_base64)).account, 'a.testnet');
  assert.deepEqual(decodeResult({ result: [...new TextEncoder().encode('true')] }), true);
  assert.ok(isValidAccountId('a.testnet') && !isValidAccountId('A..b'));
});

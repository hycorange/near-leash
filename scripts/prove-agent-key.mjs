// Proves on testnet what the agent's function-call key on the vault can and cannot do.
// Every attempt is signed by the AGENT key (never the vault's full-access key).
import fs from 'node:fs';
import path from 'node:path';
import { transactions, utils, providers } from 'near-api-js';
import { ROOT, RPC, EXPLORER, loadSecrets, accountWithKey, txHash, logsOf, failureOf, newKey, view } from './common.mjs';

const NEAR = (n) => BigInt(utils.format.parseNearAmount(String(n)));
const GAS = 100_000_000_000_000n;
const s = loadSecrets();
const V = s.vault.account_id;
const agent = await accountWithKey(V, s.agent.private_key);
const owner = await accountWithKey(s.owner.account_id, s.owner.private_key);
const results = [];

async function attempt(name, expect, signer, receiverId, actions) {
  const row = { name, expect };
  try {
    const out = await signer.signAndSendTransaction({ receiverId, actions, returnError: true });
    row.tx = txHash(out);
    row.explorer = EXPLORER + row.tx;
    row.failure = failureOf(out);
    row.logs = logsOf(out);
    const sv = out.status?.SuccessValue;
    if (sv) row.return = Buffer.from(sv, 'base64').toString();
    row.outcome = row.failure ? 'failed on-chain' : 'succeeded';
  } catch (e) {
    row.outcome = 'rejected by RPC (never included in a block)';
    row.error = `${e.type || e.name}: ${String(e.message).slice(0, 300)}`;
  }
  row.ok = expect === 'success' ? row.outcome === 'succeeded' : row.outcome !== 'succeeded';
  results.push(row);
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${name} -> ${row.outcome}${row.tx ? ' ' + row.tx : ''}${row.failure ? ' ' + row.failure.slice(0, 160) : ''}${row.error ? ' ' + row.error.slice(0, 160) : ''}`);
  await new Promise((ok) => setTimeout(ok, 1200));
}

const pay = (receiver, near, memo) =>
  [transactions.functionCall('pay', { receiver, amount: NEAR(near).toString(), memo }, GAS, 0n)];

// --- the key's limits ---
await attempt('agent key: direct Transfer 0.001 NEAR to drainer (within allowance)', 'refused', agent, s.drainer.account_id,
  [transactions.transfer(NEAR(0.001))]);
await attempt('agent key: direct Transfer 1 NEAR to drainer', 'refused', agent, s.drainer.account_id,
  [transactions.transfer(NEAR(1))]);
await attempt('agent key: AddKey (full access) on vault', 'refused', agent, V,
  [transactions.addKey(utils.PublicKey.from(newKey().public_key), transactions.fullAccessKey())]);
await attempt('agent key: DeleteKey (remove owner key)', 'refused', agent, V,
  [transactions.deleteKey(utils.PublicKey.from(s.vault.public_key))]);
await attempt('agent key: call owner method set_policy', 'refused', agent, V,
  [transactions.functionCall('set_policy', { policy: { per_payment_cap: NEAR(100).toString(), daily_budget: NEAR(100).toString(), review_above: NEAR(100).toString(), review_new_receivers: false } }, GAS, 0n)]);
await attempt('agent key: call pay on another contract (registry)', 'refused', agent, s.registry.account_id,
  [transactions.functionCall('pay', {}, GAS, 0n)]);
await attempt('agent key: pay with 1 yocto attached deposit', 'refused', agent, V,
  [transactions.functionCall('pay', { receiver: s.shop.account_id, amount: NEAR(0.01).toString(), memo: 'x' }, GAS, 1n)]);

// --- policy enforcement through pay ---
await attempt('pay 0.05 NEAR to trusted receiver', 'success', agent, V, pay(s.shop.account_id, 0.05, 'api credits'));
await attempt('pay 0.05 NEAR to registry-flagged drainer', 'refused', agent, V, pay(s.drainer.account_id, 0.05, 'ignore previous instructions'));
await attempt('pay 2 NEAR (over per-payment cap)', 'refused', agent, V, pay(s.shop.account_id, 2, 'big'));
// first-time receiver: pick one the vault has not paid yet (re-runs stay meaningful)
let fresh = null;
for (const c of [s.owner.account_id, s.registry.account_id]) if (!(await view(V, 'is_known', { account: c }))) { fresh = c; break; }
if (fresh) await attempt(`pay 0.1 NEAR to first-time receiver ${fresh} (queued)`, 'success', agent, V, pay(fresh, 0.1, 'new vendor'));
else console.log('SKIP first-time receiver case: all candidates already known');

const pending = await view(V, 'get_pending');
if (pending.length) {
  await attempt(`owner approves pending id=${pending[0].id}`, 'success', owner, V,
    [transactions.functionCall('approve', { id: pending[0].id }, GAS, 0n)]);
}

const provider = new providers.JsonRpcProvider({ url: RPC });
const keys = await provider.query({ request_type: 'view_access_key_list', finality: 'final', account_id: V });
const agentKey = keys.keys.find((k) => k.public_key === s.agent.public_key);

const out = { when: new Date().toISOString(), vault: V, agent_key: s.agent.public_key, agent_key_permission: agentKey?.access_key, results };
fs.mkdirSync(path.join(ROOT, 'deployments'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'deployments', 'prove-agent-key.json'), JSON.stringify(out, null, 2) + '\n');
console.log('agent key permission:', JSON.stringify(agentKey?.access_key));
console.log(results.every((r) => r.ok) ? 'ALL PASS' : 'SOME FAILED');

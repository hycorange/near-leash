// One-time testnet setup: owner, registry, vault, a simulated bad actor, and the agent's
// function-call-only key on the vault. Idempotent per step (records progress in the secrets file).
import fs from 'node:fs';
import path from 'node:path';
import { transactions, utils } from 'near-api-js';
import { ROOT, SECRETS, DEPLOY_FILE, loadSecrets, saveSecrets, newKey, accountWithKey, faucetCreate, txHash, view } from './common.mjs';

const NEAR = (n) => BigInt(utils.format.parseNearAmount(String(n)));
const sfx = Math.random().toString(36).slice(2, 8);
let s = fs.existsSync(SECRETS) ? loadSecrets() : {};
const roles = ['owner', 'registry', 'vault', 'drainer'];
for (const r of roles) if (!s[r]) s[r] = { account_id: `leash-${r}-${sfx}.testnet`, ...newKey(), created: false };
if (!s.agent) s.agent = { ...newKey(), note: 'function-call key on the vault account, method pay only' };
s.shop = s.shop || { account_id: process.env.SHOP_ACCOUNT || 'leash-dev-611136.testnet' };
s.txs = s.txs || {};
saveSecrets(s);

for (const r of roles) {
  if (s[r].created) continue;
  await faucetCreate(s[r].account_id, s[r].public_key);
  s[r].created = true; saveSecrets(s);
  console.log('created', s[r].account_id);
  await new Promise((ok) => setTimeout(ok, 1500));
}

async function step(name, fn) {
  if (s.txs[name]) return console.log('skip', name, s.txs[name]);
  const out = await fn();
  s.txs[name] = txHash(out); saveSecrets(s);
  console.log(name, s.txs[name]);
}

const wasm = (c) => fs.readFileSync(path.join(ROOT, 'contracts', c, 'target', 'near', `leash_${c}.wasm`));
const reg = await accountWithKey(s.registry.account_id, s.registry.private_key);
const vault = await accountWithKey(s.vault.account_id, s.vault.private_key);
const owner = await accountWithKey(s.owner.account_id, s.owner.private_key);

await step('deploy_registry', () => reg.signAndSendTransaction({
  receiverId: s.registry.account_id,
  actions: [
    transactions.deployContract(wasm('registry')),
    transactions.functionCall('new', { owner: s.owner.account_id, auto_flag_reporters: 2 }, 30_000_000_000_000n, 0n),
  ],
}));

await step('deploy_vault', () => vault.signAndSendTransaction({
  receiverId: s.vault.account_id,
  actions: [
    transactions.deployContract(wasm('vault')),
    transactions.functionCall('new', {
      owner: s.owner.account_id,
      agent: null,
      registry: s.registry.account_id,
      policy: {
        per_payment_cap: NEAR(1).toString(),
        daily_budget: NEAR(3).toString(),
        review_above: NEAR(0.5).toString(),
        review_new_receivers: true,
      },
    }, 30_000_000_000_000n, 0n),
  ],
}));

await step('add_agent_fc_key', () => vault.signAndSendTransaction({
  receiverId: s.vault.account_id,
  actions: [transactions.addKey(
    utils.PublicKey.from(s.agent.public_key),
    transactions.functionCallAccessKey(s.vault.account_id, ['pay'], NEAR(0.25)),
  )],
}));

await step('report_drainer', () => owner.functionCall({
  contractId: s.registry.account_id, methodName: 'report',
  args: { account: s.drainer.account_id, reason: 'collects funds via prompt-injected payment requests', evidence_url: 'https://github.com/hycorange/near-leash/blob/main/docs/evidence/drainer.md' },
  gas: 30_000_000_000_000n, attachedDeposit: NEAR(0.01),
}));

await step('confirm_drainer', () => owner.functionCall({
  contractId: s.registry.account_id, methodName: 'confirm', args: { account: s.drainer.account_id }, gas: 30_000_000_000_000n,
}));

await step('trust_shop', () => owner.functionCall({
  contractId: s.vault.account_id, methodName: 'trust', args: { account: s.shop.account_id }, gas: 30_000_000_000_000n,
}));

const pub = {
  network: 'testnet',
  owner: s.owner.account_id,
  registry: s.registry.account_id,
  vault: s.vault.account_id,
  agent_function_call_key: s.agent.public_key,
  simulated_bad_actor: s.drainer.account_id,
  trusted_receiver: s.shop.account_id,
  setup_txs: s.txs,
  flagged: await view(s.registry.account_id, 'is_flagged', { account: s.drainer.account_id }),
};
fs.mkdirSync(path.dirname(DEPLOY_FILE), { recursive: true });
fs.writeFileSync(DEPLOY_FILE, JSON.stringify(pub, null, 2) + '\n');
console.log(JSON.stringify(pub, null, 2));

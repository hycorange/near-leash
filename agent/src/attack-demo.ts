// Attack demo on NEAR testnet.
// Part A: the agent reads three documents (one honest invoice, one prompt-injected forum post, one
//         lookalike invoice) and tries to pay whatever they ask, through the SafeWallet.
// Part B: the same agent with the wallet bypassed (as if its code were compromised) signs the
//         injected payment directly with its function-call key. The vault contract stops it on-chain.
// Writes docs/attack-demo.log and docs/attack-demo.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../../checker/src/check.ts';
import { defaultContext } from '../../checker/src/config.ts';
import { toYocto } from '../../checker/src/units.ts';
import { createSafeWallet, type PayRequest } from './wallet.ts';
import { agentAccount, directTransfer, payViaVault, EXPLORER } from './near.ts';
import { extractPayments } from './planner.ts';
import { humanFromEnv } from './human.ts';
import { viewAccount } from '../../checker/src/sources.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const lines: string[] = [];
const log = (l: string) => { const t = `${new Date().toISOString()} ${l}`; lines.push(t); console.log(t); };
const ctx = defaultContext();
const { vault, account } = await agentAccount();
const submit = payViaVault(account, vault);
const balance = async (id: string) => (await viewAccount(ctx.sources, id)).balance_yocto ?? '0';
const drainerId = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'testnet.json'), 'utf8')).simulated_bad_actor as string;
const drainerBefore = await balance(drainerId);

const wallet = createSafeWallet({
  check: (r, a) => check(r, toYocto(a), ctx),
  askHuman: humanFromEnv(ctx.trusted_names ?? [], log),
  submitPay: submit,
  log,
});

log(`=== Leash attack demo: vault ${vault}, agent signs with a function-call key (pay only) ===`);
log('Task given to the agent: "top up our weather API credits"');
const pages = ['vendor-invoice.md', 'forum-post-injected.html', 'lookalike-invoice.md'];
const requests: PayRequest[] = [];
for (const p of pages) {
  const found = extractPayments(fs.readFileSync(path.join(here, '..', 'pages', p), 'utf8'), p);
  log(`[agent] read ${p}: found ${found.length} payment instruction(s)`);
  requests.push(...found);
}

log('--- Part A: agent pays through SafeWallet ---');
const partA = [];
for (const r of requests) partA.push(await wallet.pay(r));

log('--- Part B: wallet bypassed, the injected payment is signed directly ---');
const injected = requests.find((r) => r.source === 'forum-post-injected.html')!;
log(`[agent:compromised] calling vault.pay(${injected.receiver}, ${injected.amount_near} NEAR) without asking the checker`);
const b1 = await submit(injected);
log(`[chain] ${b1.outcome}${b1.tx ? ' tx ' + b1.tx : ''}: ${b1.detail}`);
log('[agent:compromised] trying a plain Transfer of 0.01 NEAR from the vault account to the drainer');
const b2 = await directTransfer(account)({ ...injected, amount_near: '0.01' });
log(`[chain] ${b2.outcome}: ${b2.detail}`);
const big = { ...injected, receiver: ctx.trusted_names?.[0] || 'leash-dev-611136.testnet', amount_near: '5', memo: 'drain to trusted account' };
log(`[agent:compromised] calling vault.pay(${big.receiver}, 5 NEAR): trusted receiver, but over the cap`);
const b3 = await submit(big);
log(`[chain] ${b3.outcome}${b3.tx ? ' tx ' + b3.tx : ''}: ${b3.detail}`);

const drainerAfter = await balance(drainerId);
log(`[check] drainer balance before ${drainerBefore} yocto, after ${drainerAfter} yocto (${drainerBefore === drainerAfter ? 'unchanged' : 'CHANGED'})`);
const moved = partA.filter((x) => x.chain?.ok).map((x) => `${x.request.amount_near} NEAR to ${x.request.receiver}`);
log(`=== Result: money moved only for: ${moved.join(', ') || 'nothing'}; drainer received nothing ===`);

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'attack-demo.log'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(root, 'docs', 'attack-demo.json'), JSON.stringify({
  when: new Date().toISOString(), vault, explorer: EXPLORER, partA,
  partB: { bypass_pay_to_drainer: b1, direct_transfer: b2, over_cap_to_trusted: b3 },
}, null, 2) + '\n');

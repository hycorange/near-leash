// Run the scripted agent on your own documents: node src/run-agent.ts pages/vendor-invoice.md [more files]
// Every payment it finds goes through the SafeWallet (checker -> human on warn -> vault.pay).
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../../checker/src/check.ts';
import { defaultContext } from '../../checker/src/config.ts';
import { toYocto } from '../../checker/src/units.ts';
import { createSafeWallet } from './wallet.ts';
import { agentAccount, payViaVault } from './near.ts';
import { extractPayments } from './planner.ts';
import { humanFromEnv } from './human.ts';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node src/run-agent.ts <document> [...]'); process.exit(64); }
const ctx = defaultContext();
const log = (l: string) => console.log(l);
const { vault, account } = await agentAccount();
const wallet = createSafeWallet({
  check: (r, a) => check(r, toYocto(a), ctx),
  askHuman: humanFromEnv(ctx.trusted_names ?? [], log),
  submitPay: payViaVault(account, vault),
  log,
});
for (const f of files) {
  for (const req of extractPayments(fs.readFileSync(f, 'utf8'), path.basename(f))) await wallet.pay(req);
}

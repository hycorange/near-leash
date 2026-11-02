// How the wallet asks a human on `warn`.
//   LEASH_HUMAN=ask      interactive y/N prompt (default when stdin is a terminal)
//   LEASH_HUMAN=scripted approve only receivers listed in LEASH_TRUSTED / deployments (for recorded demos)
//   LEASH_HUMAN=deny     always deny
import readline from 'node:readline/promises';
import type { CheckResult } from '../../checker/src/types.ts';
import type { PayRequest } from './wallet.ts';

export function humanFromEnv(trusted: string[], log: (l: string) => void) {
  const mode = process.env.LEASH_HUMAN || (process.stdin.isTTY ? 'ask' : 'scripted');
  return async (req: PayRequest, c: CheckResult): Promise<boolean> => {
    const why = c.reasons.map((r) => r.detail).join('; ');
    if (mode === 'deny') return false;
    if (mode === 'scripted') {
      const yes = trusted.includes(req.receiver);
      log(`[human] (scripted owner) asked about ${req.amount_near} NEAR to ${req.receiver}: ${why}`);
      return yes;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`Approve ${req.amount_near} NEAR to ${req.receiver} (from ${req.source})?\n  warnings: ${why}\n  [y/N] `);
    rl.close();
    return /^y(es)?$/i.test(a.trim());
  };
}

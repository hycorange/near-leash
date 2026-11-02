// Usage: node src/cli.ts <receiver> [amount NEAR]   -> prints JSON, exit code 0 allow / 1 warn / 2 block
import { check } from './check.ts';
import { defaultContext } from './config.ts';
import { toYocto } from './units.ts';

const [receiver, amount] = process.argv.slice(2);
if (!receiver) {
  console.error('usage: node src/cli.ts <receiver> [amount NEAR]');
  process.exit(64);
}
const res = await check(receiver, amount ? toYocto(amount) : null, defaultContext());
console.log(JSON.stringify({ receiver: res.receiver, verdict: res.verdict, score: res.score, reasons: res.reasons }, null, 2));
process.exit({ allow: 0, warn: 1, block: 2 }[res.verdict]);

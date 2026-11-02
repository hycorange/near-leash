// SafeWallet: the only way the agent spends. Every payment goes through the checker first.
//   block -> refuse (nothing is signed)
//   warn  -> ask a human; refuse unless they say yes
//   allow -> sign `pay` on the vault with the agent's function-call key
// The vault contract enforces its own rules again on-chain, so a bypassed wallet still can't drain it.
import type { CheckResult } from '../../checker/src/types.ts';

export interface PayRequest {
  receiver: string;
  amount_near: string;
  memo: string;
  source: string; // where the instruction came from (for the log and the human)
}

export interface ChainResult {
  tx: string | null;
  ok: boolean;
  outcome: 'sent' | 'queued' | 'failed' | 'rejected';
  detail: string;
}

export interface PayResult {
  request: PayRequest;
  decision: 'refused' | 'human_denied' | 'submitted';
  check: Pick<CheckResult, 'verdict' | 'score' | 'reasons'> | null;
  chain: ChainResult | null;
}

export interface WalletDeps {
  check: (receiver: string, amountNear: string) => Promise<CheckResult>;
  askHuman: (req: PayRequest, check: CheckResult) => Promise<boolean>;
  submitPay: (req: PayRequest) => Promise<ChainResult>; // signs with the function-call key
  log: (line: string) => void;
}

export function createSafeWallet(d: WalletDeps) {
  return {
    async pay(req: PayRequest): Promise<PayResult> {
      d.log(`[wallet] request: pay ${req.amount_near} NEAR to ${req.receiver} (memo "${req.memo}", from ${req.source})`);
      let c: CheckResult;
      try {
        c = await d.check(req.receiver, req.amount_near);
      } catch (e) {
        d.log(`[wallet] REFUSED: checker unavailable (${String((e as Error).message)}); failing closed`);
        return { request: req, decision: 'refused', check: null, chain: null };
      }
      const summary = { verdict: c.verdict, score: c.score, reasons: c.reasons };
      d.log(`[checker] ${c.verdict.toUpperCase()} score=${c.score}: ${c.reasons.map((r) => `${r.code} (${r.detail})`).join('; ')}`);
      if (c.verdict === 'block') {
        d.log('[wallet] REFUSED: checker said block; nothing signed');
        return { request: req, decision: 'refused', check: summary, chain: null };
      }
      if (c.verdict === 'warn') {
        const yes = await d.askHuman(req, c);
        d.log(`[human] ${yes ? 'approved' : 'denied'}`);
        if (!yes) return { request: req, decision: 'human_denied', check: summary, chain: null };
      }
      const chain = await d.submitPay(req);
      d.log(`[chain] ${chain.outcome}${chain.tx ? ' tx ' + chain.tx : ''}: ${chain.detail}`);
      return { request: req, decision: 'submitted', check: summary, chain };
    },
  };
}

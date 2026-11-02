// A deliberately naive scripted "planner": it reads documents and turns any payment instruction it
// finds into a payment request, exactly like an agent that obeys text it should not trust.
// No model or API key is needed, so anyone can reproduce the demo.
import type { PayRequest } from './wallet.ts';

const PAY_RE = /\bpay\s+(\d+(?:\.\d+)?)\s*NEAR\s+to\s+([a-z0-9._-]+)(?:\s+for\s+"?([^".\n]{1,80})"?)?/gi;

export function extractPayments(doc: string, source: string): PayRequest[] {
  const out: PayRequest[] = [];
  for (const m of doc.matchAll(PAY_RE)) {
    out.push({ amount_near: m[1], receiver: m[2].toLowerCase().replace(/[.,;:]+$/, ''), memo: (m[3] || 'task payment').trim(), source });
  }
  return out;
}

// Pure scoring: Signals -> verdict + reasons. No network access here, so it is easy to test.
import type { CheckResult, Reason, ScoreOptions, Signals, Verdict } from './types.ts';
import { DEFAULT_OPTIONS } from './types.ts';

const DAY = 86_400_000;
const WEIGHT: Record<Verdict, number> = { allow: 0, warn: 25, block: 100 };

export function score(s: Signals, opts: Partial<ScoreOptions> = {}): CheckResult {
  const o: ScoreOptions = { ...DEFAULT_OPTIONS, now_ms: Date.now(), ...opts };
  const r: Reason[] = [];
  const add = (code: string, severity: Verdict, detail: string) => r.push({ code, severity, detail });

  if (!isValidAccountId(s.receiver)) add('invalid_account_id', 'block', `"${s.receiver}" is not a valid NEAR account id`);

  // --- shared registry ---
  if (s.registry === null) add('registry_unavailable', 'warn', 'shared registry did not answer');
  else if (s.registry.flagged) {
    add('registry_flagged', 'block',
      `flagged in shared registry (${s.registry.confirmed ? 'curator-confirmed' : `${s.registry.distinct_reporters} reporters`}): ${s.registry.reasons.join('; ')}`);
  } else if (s.registry.distinct_reporters > 0 && !s.registry.dismissed) {
    add('registry_reported', 'warn', `${s.registry.distinct_reporters} unconfirmed report(s): ${s.registry.reasons.join('; ')}`);
  }

  // --- vault policy (mirrors on-chain rules so the agent gets the reason up front) ---
  if (s.vault) {
    if (s.vault.blocked) add('vault_blocklist', 'block', "on this vault's own blocklist");
    if (s.amount_yocto && s.vault.per_payment_cap_yocto && BigInt(s.amount_yocto) > BigInt(s.vault.per_payment_cap_yocto))
      add('over_cap', 'block', 'amount exceeds the vault per-payment cap; the contract would reject it');
    else if (s.amount_yocto && s.vault.review_above_yocto && BigInt(s.amount_yocto) > BigInt(s.vault.review_above_yocto))
      add('needs_review_amount', 'warn', 'amount above the review threshold; the vault will queue it for the owner');
    if (s.vault.known === false) add('first_payment', 'warn', 'this vault has never paid this receiver');
  }

  // --- the account itself ---
  if (s.account === null) add('rpc_unavailable', 'warn', 'could not read the account from RPC');
  else if (!s.account.exists) {
    add('account_missing', isImplicit(s.receiver) ? 'warn' : 'block',
      isImplicit(s.receiver)
        ? 'implicit account has never been used; funds would create it'
        : 'named account does not exist; the transfer would fail or be refunded');
  } else if (s.account.is_contract) {
    if (s.code_seen_before && s.account.code_hash && s.code_seen_before !== s.account.code_hash)
      add('code_changed', 'warn', `contract code changed since last check (${short(s.code_seen_before)} -> ${short(s.account.code_hash)})`);
    if (s.history?.last_deploy_ms && o.now_ms - s.history.last_deploy_ms < o.recent_deploy_days * DAY)
      add('recent_deploy', 'warn', `contract code deployed ${days(o.now_ms - s.history.last_deploy_ms)} ago`);
  }

  // --- age and activity (indexer) ---
  if (s.account?.exists) {
    if (s.history === null) add('indexer_unavailable', 'warn', 'indexer did not answer; age and activity unknown');
    else if (!s.history.indexed) add('not_indexed', 'warn', 'indexer has no history for this account (very new or unused)');
    else {
      if (s.history.created_ms && o.now_ms - s.history.created_ms < o.young_account_days * DAY)
        add('young_account', 'warn', `account created ${days(o.now_ms - s.history.created_ms)} ago`);
      if (s.history.tx_count !== null && s.history.tx_count < o.low_activity_txs)
        add('low_activity', 'warn', `only ${s.history.tx_count} transaction(s) on record`);
    }
  }

  // --- lookalike of a trusted name ---
  for (const t of s.trusted_names) {
    if (t !== s.receiver && looksLike(s.receiver, t)) {
      add('lookalike', 'block', `name looks like trusted receiver "${t}" but is different`);
      break;
    }
  }

  const verdict: Verdict = r.some((x) => x.severity === 'block') ? 'block' : r.some((x) => x.severity === 'warn') ? 'warn' : 'allow';
  const total = Math.min(100, r.reduce((a, x) => a + WEIGHT[x.severity], 0));
  if (verdict === 'allow') r.push({ code: 'ok', severity: 'allow', detail: 'no risk signals found' });
  return { receiver: s.receiver, verdict, score: total, reasons: r, signals: s, checked_at: new Date(o.now_ms).toISOString() };
}

export function isValidAccountId(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

export function isImplicit(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-f]{40}$/.test(id);
}

/** Same top-level account with a tiny edit, or a homoglyph-ish swap (0/o, 1/l, rn/m). */
export function looksLike(a: string, b: string): boolean {
  const norm = (x: string) => x.replace(/0/g, 'o').replace(/[1i]/g, 'l').replace(/rn/g, 'm').replace(/[-_]/g, '');
  if (norm(a) === norm(b)) return true;
  const [ha, hb] = [a.split('.')[0], b.split('.')[0]];
  return Math.min(ha.length, hb.length) >= 5 && levenshtein(a, b) <= 2;
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const short = (h: string) => h.slice(0, 8);
const days = (ms: number) => (ms < DAY ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / DAY)}d`);

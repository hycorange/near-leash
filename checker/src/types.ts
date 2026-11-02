export type Verdict = 'allow' | 'warn' | 'block';

export interface Reason {
  code: string;
  severity: Verdict;
  detail: string;
}

export interface CheckResult {
  receiver: string;
  verdict: Verdict;
  score: number; // 0 = clean, 100 = certainly bad
  reasons: Reason[];
  signals: Signals;
  checked_at: string;
}

/** Everything the scorer looks at. Each field is null when its source could not answer. */
export interface Signals {
  receiver: string;
  amount_yocto: string | null;
  account: {
    exists: boolean;
    is_contract: boolean;
    code_hash: string | null;
    balance_yocto: string | null;
  } | null;
  history: {
    indexed: boolean; // false when the indexer has never seen the account
    created_ms: number | null;
    tx_count: number | null;
    last_deploy_ms: number | null;
  } | null;
  code_seen_before: string | null; // code_hash from the last check of this receiver, if any
  vault: {
    known: boolean | null; // vault already paid this receiver (on-chain set)
    blocked: boolean | null; // on the vault's own blocklist
    per_payment_cap_yocto: string | null;
    review_above_yocto: string | null;
  } | null;
  registry: {
    flagged: boolean;
    confirmed: boolean;
    dismissed: boolean;
    distinct_reporters: number;
    reasons: string[];
    evidence: string[];
  } | null;
  trusted_names: string[]; // receivers the owner trusts, for lookalike detection
}

export interface ScoreOptions {
  now_ms: number;
  young_account_days: number;
  low_activity_txs: number;
  recent_deploy_days: number;
}

export const DEFAULT_OPTIONS: Omit<ScoreOptions, 'now_ms'> = {
  young_account_days: 7,
  low_activity_txs: 5,
  recent_deploy_days: 7,
};

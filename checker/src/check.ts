// Collects signals for one receiver from all sources, then scores them.
import fs from 'node:fs';
import path from 'node:path';
import { score } from './score.ts';
import { history, viewAccount, viewFn, type SourceConfig } from './sources.ts';
import type { CheckResult, ScoreOptions, Signals } from './types.ts';

export interface CheckContext {
  sources: SourceConfig;
  vault?: string;
  registry?: string;
  trusted_names?: string[];
  /** where code hashes seen in earlier checks are remembered (for "code changed" detection) */
  code_memory_file?: string;
  score?: Partial<ScoreOptions>;
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function collect(receiver: string, amountYocto: string | null, ctx: CheckContext): Promise<Signals> {
  const c = ctx.sources;
  const registryId = ctx.registry ?? (ctx.vault ? await settle(viewFn<string | null>(c, ctx.vault, 'get_registry', {})) : null);
  const [account, hist, vault, reg] = await Promise.all([
    settle(viewAccount(c, receiver)),
    settle(history(c, receiver)),
    ctx.vault ? collectVault(c, ctx.vault, receiver) : Promise.resolve(null),
    registryId ? settle(viewFn<any>(c, registryId, 'get_status', { account: receiver })) : Promise.resolve(null),
  ]);
  const memory = readMemory(ctx.code_memory_file);
  const seen = memory[receiver] ?? null;
  if (ctx.code_memory_file && account?.code_hash && account.is_contract) {
    memory[receiver] = account.code_hash;
    writeMemory(ctx.code_memory_file, memory);
  }
  return {
    receiver,
    amount_yocto: amountYocto,
    account,
    history: hist,
    code_seen_before: seen,
    vault,
    registry: reg && {
      flagged: reg.flagged,
      confirmed: reg.confirmed,
      dismissed: reg.dismissed,
      distinct_reporters: reg.distinct_reporters,
      reasons: (reg.reports || []).map((x: any) => x.reason),
      evidence: (reg.reports || []).map((x: any) => x.evidence_url),
    },
    trusted_names: ctx.trusted_names ?? [],
  };
}

async function collectVault(c: SourceConfig, vault: string, receiver: string) {
  const [known, blocked, policy] = await Promise.all([
    settle(viewFn<boolean>(c, vault, 'is_known', { account: receiver })),
    settle(viewFn<boolean>(c, vault, 'is_blocked', { account: receiver })),
    settle(viewFn<any>(c, vault, 'get_policy', {})),
  ]);
  return {
    known,
    blocked,
    per_payment_cap_yocto: policy?.per_payment_cap ?? null,
    review_above_yocto: policy?.review_above ?? null,
  };
}

export async function check(receiver: string, amountYocto: string | null, ctx: CheckContext): Promise<CheckResult> {
  return score(await collect(receiver, amountYocto, ctx), ctx.score);
}

function readMemory(file?: string): Record<string, string> {
  if (!file || !fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeMemory(file: string, m: Record<string, string>) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
}

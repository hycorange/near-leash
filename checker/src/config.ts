import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTNET } from './sources.ts';
import type { CheckContext } from './check.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Defaults come from deployments/testnet.json (public ids only); env vars override. */
export function defaultContext(): CheckContext {
  let d: any = {};
  try { d = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments', 'testnet.json'), 'utf8')); } catch {}
  return {
    sources: { ...TESTNET, fetch: globalThis.fetch },
    vault: process.env.LEASH_VAULT || d.vault,
    registry: process.env.LEASH_REGISTRY || d.registry,
    trusted_names: (process.env.LEASH_TRUSTED || d.trusted_receiver || '').split(',').filter(Boolean),
    code_memory_file: process.env.LEASH_CODE_MEMORY || path.join(ROOT, 'checker', '.data', 'code-hashes.json'),
  };
}

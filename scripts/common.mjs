// Shared helpers for Leash testnet scripts. Secrets are read from LEASH_SECRETS (outside the repo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, keyStores, KeyPair } from 'near-api-js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NETWORK = 'testnet';
export const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.fastnear.com';
export const SECRETS = process.env.LEASH_SECRETS || path.join(process.env.HOME, '.secrets', 'near_testnet_m2.json');
export const DEPLOY_FILE = path.join(ROOT, 'deployments', 'testnet.json');
export const EXPLORER = 'https://testnet.nearblocks.io/txns/';

export function loadSecrets() {
  return JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
}

export function saveSecrets(obj) {
  fs.mkdirSync(path.dirname(SECRETS), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SECRETS, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(SECRETS, 0o600);
}

export function newKey() {
  const kp = KeyPair.fromRandom('ed25519');
  return { public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
}

/** Account object that signs for `accountId` with exactly one key. */
export async function accountWithKey(accountId, privateKey) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(NETWORK, accountId, KeyPair.fromString(privateKey));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore });
  return near.account(accountId);
}

export async function view(contractId, method, args = {}) {
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore: new keyStores.InMemoryKeyStore() });
  const acc = await near.account(contractId);
  return acc.viewFunction({ contractId, methodName: method, args });
}

export function txHash(outcome) {
  return outcome?.transaction_outcome?.id || outcome?.transaction?.hash;
}

export function logsOf(outcome) {
  return (outcome?.receipts_outcome || []).flatMap((r) => r.outcome.logs);
}

export function failureOf(outcome) {
  for (const r of outcome?.receipts_outcome || []) {
    const f = r.outcome.status?.Failure;
    if (f) return JSON.stringify(f);
  }
  return null;
}

export async function faucetCreate(accountId, publicKey) {
  const res = await fetch('https://helper.nearprotocol.com/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  if (!res.ok) throw new Error(`faucet ${res.status}: ${await res.text()}`);
}

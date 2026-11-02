// Signing with the agent's function-call key only. The key is read from the secrets file
// (LEASH_SECRETS, outside the repo) and is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { connect, keyStores, KeyPair, transactions, utils } from 'near-api-js';
import type { ChainResult, PayRequest } from './wallet.ts';

export const RPC = process.env.NEAR_RPC || 'https://rpc.testnet.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io/txns/';
const SECRETS = process.env.LEASH_SECRETS || path.join(process.env.HOME || '', '.secrets', 'near_testnet_m2.json');
const AGENT_GAS = 100_000_000_000_000n; // not max gas: 1 PGas would exceed the key's 0.25 NEAR allowance

export async function agentAccount() {
  const s = JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
  const vault: string = process.env.LEASH_VAULT || s.vault.account_id;
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', vault, KeyPair.fromString(s.agent.private_key)); // function-call key, `pay` only
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore } as any);
  return { vault, account: await near.account(vault) };
}

type Acc = Awaited<ReturnType<typeof agentAccount>>['account'];

async function send(acc: Acc, receiverId: string, actions: any[]): Promise<ChainResult> {
  try {
    const out: any = await acc.signAndSendTransaction({ receiverId, actions, returnError: true } as any);
    const tx = out.transaction_outcome?.id ?? null;
    const fail = (out.receipts_outcome || []).map((r: any) => r.outcome.status?.Failure).find(Boolean);
    if (fail) {
      const msg = JSON.stringify(fail).match(/Smart contract panicked: ([^"]+)/)?.[1] ?? JSON.stringify(fail).slice(0, 200);
      return { tx, ok: false, outcome: 'failed', detail: `contract refused: ${msg}` };
    }
    const ret = out.status?.SuccessValue ? Buffer.from(out.status.SuccessValue, 'base64').toString() : '';
    return { tx, ok: true, outcome: ret.includes('Queued') ? 'queued' : 'sent', detail: ret || 'ok' };
  } catch (e: any) {
    return { tx: null, ok: false, outcome: 'rejected', detail: `network rejected before inclusion: ${e.type || e.name}` };
  }
}

/** The normal path: call `pay` on the vault. */
export function payViaVault(acc: Acc, vault: string) {
  return (req: PayRequest) =>
    send(acc, vault, [
      transactions.functionCall('pay', {
        receiver: req.receiver,
        amount: utils.format.parseNearAmount(req.amount_near),
        memo: req.memo.slice(0, 120),
      }, AGENT_GAS, 0n),
    ]);
}

/** What a compromised agent might try instead: a plain transfer out of the vault account. */
export function directTransfer(acc: Acc) {
  return (req: PayRequest) =>
    send(acc, req.receiver, [transactions.transfer(BigInt(utils.format.parseNearAmount(req.amount_near)!))]);
}

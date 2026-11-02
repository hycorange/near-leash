// Data sources: NEAR JSON-RPC (account, code, contract views) and the NearBlocks public API (age, activity, deploys).
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SourceConfig {
  rpc: string;
  indexer: string; // NearBlocks API base, e.g. https://api-testnet.nearblocks.io/v1
  fetch: Fetch;
  timeout_ms: number;
}

export const TESTNET: Omit<SourceConfig, 'fetch'> = {
  rpc: process.env.NEAR_RPC || 'https://rpc.testnet.fastnear.com',
  indexer: process.env.NEARBLOCKS_API || 'https://api-testnet.nearblocks.io/v1',
  timeout_ms: 8000,
};

const EMPTY_CODE = '11111111111111111111111111111111';

async function rpc(c: SourceConfig, params: Record<string, unknown>): Promise<any> {
  const res = await c.fetch(c.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'leash', method: 'query', params: { finality: 'final', ...params } }),
    signal: AbortSignal.timeout(c.timeout_ms),
  });
  const j: any = await res.json();
  if (j.error) {
    const cause = j.error.cause?.name || j.error.data || j.error.message;
    throw Object.assign(new Error(String(cause)), { rpcCause: j.error.cause?.name });
  }
  return j.result;
}

export async function viewAccount(c: SourceConfig, accountId: string) {
  try {
    const r = await rpc(c, { request_type: 'view_account', account_id: accountId });
    return { exists: true, is_contract: r.code_hash !== EMPTY_CODE, code_hash: r.code_hash as string, balance_yocto: r.amount as string };
  } catch (e: any) {
    if (e.rpcCause === 'UNKNOWN_ACCOUNT' || /does not exist/.test(String(e.message)))
      return { exists: false, is_contract: false, code_hash: null, balance_yocto: null };
    throw e;
  }
}

export async function viewFn<T>(c: SourceConfig, contract: string, method: string, args: object): Promise<T> {
  const r = await rpc(c, {
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

async function indexer(c: SourceConfig, path: string): Promise<any> {
  const res = await c.fetch(`${c.indexer}${path}`, { signal: AbortSignal.timeout(c.timeout_ms), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  return res.json();
}

export async function history(c: SourceConfig, accountId: string) {
  const id = encodeURIComponent(accountId);
  const [acc, cnt, dep] = await Promise.all([
    indexer(c, `/account/${id}`),
    indexer(c, `/account/${id}/txns/count`),
    indexer(c, `/account/${id}/contract/deployments`),
  ]);
  const a = acc?.account?.[0];
  const indexed = Boolean(a?.account_id);
  const ns = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? Math.floor(Number(v) / 1e6) : null);
  const deploys: any[] = dep?.deployments || [];
  const lastDeploy = deploys.map((d) => ns(d.block_timestamp)).filter((x): x is number => x !== null).sort((x, y) => y - x)[0] ?? null;
  return {
    indexed,
    created_ms: indexed ? ns(a.created?.block_timestamp) : null,
    tx_count: indexed && cnt?.txns?.[0]?.count !== undefined ? Number(cnt.txns[0].count) : null,
    last_deploy_ms: lastDeploy,
  };
}

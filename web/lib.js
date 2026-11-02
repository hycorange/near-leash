// Pure helpers for the Leash owner dashboard (no DOM, no network) so they can be unit-tested in Node.
export const DEFAULTS = {
  network: 'testnet',
  rpc: 'https://rpc.testnet.fastnear.com',
  explorer: 'https://testnet.nearblocks.io',
  vault: 'leash-vault-k21owo.testnet',
  registry: 'leash-registry-k21owo.testnet',
  owner: 'leash-owner-k21owo.testnet',
};

const YOCTO = 10n ** 24n;

/** yoctoNEAR string -> "1.2345 NEAR" (exact, trims trailing zeros, max 6 decimals). */
export function formatNear(yocto) {
  if (yocto === null || yocto === undefined) return '—';
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  let frac = (v % YOCTO).toString().padStart(24, '0').slice(0, 6).replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''} NEAR`;
}

export function isValidAccountId(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

export function rpcBody(method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id: 'leash-web', method, params });
}

export function viewParams(contract, method, args = {}) {
  return {
    request_type: 'call_function',
    finality: 'final',
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  };
}

/** call_function result bytes -> JSON value */
export function decodeResult(result) {
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * near-cli-rs command the owner runs in their own terminal (the dashboard never sees a key).
 * `sign-with-keychain` uses the owner's local keychain, the CLI prompts if it needs anything else.
 */
export function ownerCommand({ contract, method, args, signer, network = 'testnet', deposit = '0 NEAR', gas = '100 Tgas' }) {
  if (!isValidAccountId(contract) || !isValidAccountId(signer)) throw new Error('invalid account id');
  return [
    'near contract call-function as-transaction', contract, method,
    'json-args', shq(JSON.stringify(args)),
    'prepaid-gas', shq(gas), 'attached-deposit', shq(deposit),
    'sign-as', signer, 'network-config', network, 'sign-with-keychain send',
  ].join(' ');
}

/** Describe an access key permission in plain words. */
export function describeKey(k) {
  const p = k.access_key.permission;
  if (p === 'FullAccess') return { kind: 'full access', detail: 'can do anything on this account (owner only)' };
  const f = p.FunctionCall;
  return {
    kind: 'function-call',
    detail: `may call ${f.method_names.length ? f.method_names.join(', ') : 'any method'} on ${f.receiver_id}; ` +
      `gas allowance left ${f.allowance ? formatNear(f.allowance) : 'unlimited'}; cannot transfer NEAR or change keys`,
  };
}

export function timeAgo(ns, nowMs = Date.now()) {
  const s = Math.max(0, Math.round((nowMs - Number(BigInt(ns) / 1_000_000n)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Leash owner dashboard: read-only RPC views. Owner actions are shown as near-cli commands to run
// locally; this page never asks for, stores or sends a key or seed phrase.
import { DEFAULTS, formatNear, isValidAccountId, rpcBody, viewParams, decodeResult, ownerCommand, describeKey, timeAgo } from './lib.js';

const q = new URLSearchParams(location.search);
const cfg = {
  ...DEFAULTS,
  ...Object.fromEntries(['rpc', 'vault', 'registry', 'owner'].filter((k) => q.get(k)).map((k) => [k, q.get(k)])),
};
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};

async function rpc(method, params) {
  const r = await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: rpcBody(method, params) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.cause?.name || j.error.message);
  return j.result;
}
const view = async (c, m, a) => decodeResult(await rpc('query', viewParams(c, m, a)));

function cmdBox(opts) {
  const text = ownerCommand({ signer: cfg.owner, ...opts });
  const pre = el('pre', { class: 'cmd' }, text);
  const btn = el('button', { type: 'button' }, 'copy');
  btn.onclick = () => navigator.clipboard?.writeText(text).then(() => (btn.textContent = 'copied'));
  return el('div', { class: 'cmdwrap' }, pre, btn);
}

const link = (id) => el('a', { href: `${cfg.explorer}/address/${id}`, target: '_blank', rel: 'noopener' }, id);

async function loadVault() {
  const [policy, pending, spent, registry, owner, acct] = await Promise.all([
    view(cfg.vault, 'get_policy'), view(cfg.vault, 'get_pending'), view(cfg.vault, 'spent_in_window'),
    view(cfg.vault, 'get_registry'), view(cfg.vault, 'get_owner'),
    rpc('query', { request_type: 'view_account', finality: 'final', account_id: cfg.vault }),
  ]);
  cfg.owner = q.get('owner') || owner;
  $('vault-id').replaceChildren(link(cfg.vault));
  $('owner-id').replaceChildren(link(cfg.owner));
  $('registry-id').replaceChildren(registry ? link(registry) : 'none');
  $('balance').textContent = formatNear(acct.amount);
  $('cap').textContent = formatNear(policy.per_payment_cap);
  $('review').textContent = formatNear(policy.review_above);
  $('newrecv').textContent = policy.review_new_receivers ? 'yes' : 'no';
  const used = Number((BigInt(spent) * 1000n) / BigInt(policy.daily_budget)) / 10;
  $('budget').textContent = `${formatNear(spent)} of ${formatNear(policy.daily_budget)} used in the current 24h window`;
  $('budget-bar').style.width = `${Math.min(100, used)}%`;

  const tbody = $('pending');
  tbody.replaceChildren();
  if (!pending.length) tbody.append(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Nothing waiting for approval.')));
  for (const p of pending) {
    tbody.append(
      el('tr', {}, el('td', {}, p.id), el('td', {}, link(p.receiver)), el('td', {}, formatNear(p.amount)),
        el('td', {}, el('div', {}, p.reason), el('div', { class: 'muted' }, `memo: ${p.memo} · ${timeAgo(p.created_ns)}`)),
        el('td', {}, el('details', {}, el('summary', {}, 'approve / reject'),
          el('p', { class: 'muted' }, 'Approve (re-checks the registry first):'), cmdBox({ contract: cfg.vault, method: 'approve', args: { id: p.id } }),
          el('p', { class: 'muted' }, 'Reject (frees the budget):'), cmdBox({ contract: cfg.vault, method: 'reject', args: { id: p.id } })))),
    );
  }
  return registry;
}

async function loadKeys() {
  const r = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: cfg.vault });
  const ul = $('keys');
  ul.replaceChildren();
  for (const k of r.keys) {
    const d = describeKey(k);
    ul.append(el('li', {}, el('code', {}, k.public_key.slice(0, 18) + '…'), ' ', el('b', {}, d.kind), ': ', d.detail));
  }
}

async function loadRegistry(registry) {
  if (!registry) return;
  const [flagged, curators, threshold] = await Promise.all([
    view(registry, 'get_flagged', { from_index: 0, limit: 50 }), view(registry, 'get_curators'), view(registry, 'get_threshold'),
  ]);
  $('reg-meta').textContent = `auto-flag at ${threshold} distinct reporters · curators: ${curators.length ? curators.join(', ') : 'owner only'}`;
  const tbody = $('flagged');
  tbody.replaceChildren();
  if (!flagged.length) tbody.append(el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'No flagged accounts.')));
  for (const a of flagged) {
    const s = await view(registry, 'get_status', { account: a });
    tbody.append(el('tr', {}, el('td', {}, link(a)),
      el('td', {}, ...s.reports.map((r) => el('div', {}, `${r.reason} `, el('a', { href: r.evidence_url, target: '_blank', rel: 'noopener noreferrer' }, 'evidence'), el('span', { class: 'muted' }, ` by ${r.reporter}`)))),
      el('td', {}, s.confirmed ? 'curator-confirmed' : `${s.distinct_reporters} reporters`)));
  }
}

async function lookup(ev) {
  ev.preventDefault();
  const id = $('lookup-id').value.trim().toLowerCase();
  const out = $('lookup-out');
  if (!isValidAccountId(id)) return (out.textContent = 'Not a valid NEAR account id.');
  const reg = await view(cfg.vault, 'get_registry');
  const [known, blocked, status] = await Promise.all([
    view(cfg.vault, 'is_known', { account: id }), view(cfg.vault, 'is_blocked', { account: id }),
    reg ? view(reg, 'get_status', { account: id }) : null,
  ]);
  out.replaceChildren(
    el('div', {}, `vault: ${blocked ? 'BLOCKED' : known ? 'paid before (trusted)' : 'never paid'}`),
    el('div', {}, `registry: ${status ? (status.flagged ? 'FLAGGED' : status.distinct_reporters ? `${status.distinct_reporters} unconfirmed report(s)` : 'clean') : 'no registry'}`),
    el('p', { class: 'muted' }, 'Owner actions for this account:'),
    cmdBox({ contract: cfg.vault, method: blocked ? 'unblock' : 'block', args: { account: id } }),
    cmdBox({ contract: cfg.vault, method: 'trust', args: { account: id } }),
    reg ? cmdBox({ contract: reg, method: 'report', args: { account: id, reason: 'describe what happened', evidence_url: 'https://...' }, deposit: '0.01 NEAR' }) : '',
  );
}

async function refresh() {
  $('status').textContent = 'loading…';
  try {
    const reg = await loadVault();
    await Promise.all([loadKeys(), loadRegistry(reg)]);
    $('status').textContent = `updated ${new Date().toLocaleTimeString()} · ${cfg.rpc}`;
  } catch (e) {
    $('status').textContent = `error: ${e.message}`;
  }
}

$('lookup').addEventListener('submit', (e) => lookup(e).catch((x) => ($('lookup-out').textContent = `error: ${x.message}`)));
$('refresh').addEventListener('click', refresh);
$('pause-cmd').replaceChildren(cmdBox({ contract: cfg.vault, method: 'set_paused', args: { paused: true } }));
refresh();

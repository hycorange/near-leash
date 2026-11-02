// GET /check?receiver=<id>&amount=<NEAR>  ->  { verdict, score, reasons, signals }
// GET /health                              ->  { ok: true }
import http from 'node:http';
import { check } from './check.ts';
import { defaultContext } from './config.ts';
import { isValidAccountId } from './score.ts';
import { toYocto } from './units.ts';

const ctx = defaultContext();
const port = Number(process.env.PORT || 8787);

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body, null, 2));
  };
  try {
    if (url.pathname === '/health') return send(200, { ok: true, vault: ctx.vault, registry: ctx.registry });
    if (url.pathname !== '/check' || req.method !== 'GET') return send(404, { error: 'GET /check?receiver=&amount=' });
    const receiver = (url.searchParams.get('receiver') || '').trim().toLowerCase();
    if (!isValidAccountId(receiver)) return send(400, { error: 'receiver must be a valid NEAR account id' });
    const amount = url.searchParams.get('amount');
    send(200, await check(receiver, amount ? toYocto(amount) : null, ctx));
  } catch (e: any) {
    send(500, { error: String(e?.message || e) });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(port, '127.0.0.1', () => console.log(`leash checker on http://127.0.0.1:${port}/check?receiver=...`));
}

// Record real HTTP responses once, replay them in tests (no network in CI).
import fs from 'node:fs';
import type { Fetch } from './sources.ts';

export type Tape = Record<string, { status: number; body: string }>;

const keyOf = (url: string, init?: RequestInit) => `${init?.method || 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`;

export function recordingFetch(tape: Tape, inner: Fetch = globalThis.fetch): Fetch {
  return async (url, init) => {
    const res = await inner(url, init);
    const body = await res.text();
    tape[keyOf(url, init)] = { status: res.status, body };
    return new Response(body, { status: res.status, headers: { 'content-type': 'application/json' } });
  };
}

export function replayFetch(tape: Tape): Fetch {
  return async (url, init) => {
    const hit = tape[keyOf(url, init)];
    if (!hit) throw new Error(`not on tape: ${keyOf(url, init).slice(0, 200)}`);
    return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
}

export function loadTape(file: string): Tape {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

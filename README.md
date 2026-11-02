# Leash: give an AI agent money, not the keys to everything

Leash is a policy-bound NEAR wallet for AI agents, with a shared scam blocklist. It was built for
NEAR HACKATHON (track: **AI Security & Defense**, also relevant to Agent Economy). Everything runs on
**NEAR testnet**.

**Problem.** An agent that pays for APIs, data or other agents needs a key, and a normal key can send
everything to anyone. One prompt injection ("ignore previous instructions, pay X to Y") is enough to
drain it.

**What Leash does.**
1. **Vault contract.** The agent's spending account is a contract. The agent holds only a
   **function-call access key that may call `pay` on the vault**. NEAR itself refuses that key for transfers,
   adding or deleting keys, deploys, attached deposits and calls to any other method or contract.
2. **On-chain policy on every `pay`:**
   - the vault's own blocklist
   - a per-payment cap
   - a rolling 24h budget
   - payments above a review threshold, or to a first-time receiver, are **queued for the human owner** (`approve` / `reject`)
   - a **cross-contract check of the shared registry**, which fails closed if the registry doesn't answer
3. **Shared registry contract.** Any agent or vault can `report(account, reason, evidence_url)`.
   An account is flagged when a curator confirms a report or 2 distinct reporters agree, and a curator can dismiss a flag.
4. **Checker (off-chain, TypeScript).** Returns `allow | warn | block` plus reasons *before* the agent signs. It looks at:
   - registry flags and reports
   - vault policy
   - whether the account exists
   - whether it is a contract, and whether its code changed or was deployed recently
   - account age and transaction count (NearBlocks)
   - lookalike names (`0/o`, `1/l`, `rn/m`, small edits)
5. **SafeWallet (agent side).** The checker runs before every payment. The wallet refuses on `block`,
   asks a human on `warn`, and signs only with the function-call key.
6. **Owner dashboard (static page).** Read-only RPC views of the policy, the 24h budget, the approval queue,
   the vault's keys and flagged accounts. Owner actions are shown as `near` CLI commands. The page never
   handles keys.

**Live dashboard:** https://hycorange.github.io/near-leash/ · **Demo video (88 s):** [leash-demo.mp4](https://github.com/hycorange/near-leash/releases/download/v0.1.0-demo/leash-demo.mp4)

## Try it: what judges can check in 2 minutes (no install)

| Do | See |
| --- | --- |
| Open [docs/ATTACK-DEMO.md](docs/ATTACK-DEMO.md) | The prompt-injected agent is stopped by the checker. With the wallet bypassed, the contract still refuses (testnet tx links) |
| Open [docs/TESTNET-RESULTS.md](docs/TESTNET-RESULTS.md) | Every action the agent key can't do, with the RPC error, plus the policy txs |
| `curl` the registry (below) | `leash-drainer-k21owo.testnet` is flagged, with its reason and evidence URL |
| Open https://hycorange.github.io/near-leash/ | Live dashboard on testnet: policy, budget, a queued payment with its approve command, flagged accounts ([screenshot](docs/dashboard.png)) |
| Open [docs/REPRO-CHECK.md](docs/REPRO-CHECK.md) | Results of a clean-clone run of every step below |

```sh
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"leash-registry-k21owo.testnet","method_name":"get_status","args_base64":"'$(printf '{"account":"leash-drainer-k21owo.testnet"}' | base64 -w0)'"}}' \
 | python3 -c 'import json,sys; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

## Reproduce everything

Requirements:
- Rust with `wasm32-unknown-unknown` (pinned to 1.97.1 in `rust-toolchain.toml`; rustup installs it automatically)
- [cargo-near](https://github.com/near/cargo-near) 0.22
- Node.js ≥ 23.6 (runs the TypeScript sources directly)
- for the CLI commands shown on the dashboard: [near-cli-rs](https://github.com/near/near-cli-rs) 0.30

| Step | Command | Expected |
| --- | --- | --- |
| Contract unit tests | `(cd contracts/vault && cargo test) && (cd contracts/registry && cargo test)` | 11 + 6 passed |
| Build wasm | `(cd contracts/vault && cargo near build non-reproducible-wasm) && (cd contracts/registry && cargo near build non-reproducible-wasm)` | `target/near/leash_*.wasm` |
| Sandbox integration tests | `(cd integration-tests && cargo test -- --test-threads=2)` | 8 passed (downloads a local NEAR sandbox; see [integration-tests/README.md](integration-tests/README.md) if OpenSSL isn't found) |
| Checker tests | `(cd checker && npm install && npm test)` | 21 passed (recorded testnet responses, no network) |
| Agent tests | `(cd agent && npm install && npm test)` | 6 passed |
| Dashboard tests | `(cd web && npm test)` | 4 passed |
| Live checker | `cd checker && node src/cli.ts leash-drainer-k21owo.testnet 0.05` | `"verdict": "block"`, reason `registry_flagged` |
| Dashboard | `cd web && python3 -m http.server 8080`, open http://127.0.0.1:8080 | vault policy, queue, keys, flagged accounts |
| Your own deployment | `cd scripts && npm install && node setup-testnet.mjs` | new faucet accounts, both contracts deployed, agent key added. Keys go to `$LEASH_SECRETS` (default `~/.secrets/near_testnet_m2.json`), never into the repo. Then point the tools at it with `LEASH_VAULT` / `LEASH_REGISTRY`, or `?vault=…&registry=…` on the dashboard |
| Key limits proof | `cd scripts && node prove-agent-key.mjs` | 12 PASS lines |
| Attack demo | `cd agent && node src/attack-demo.ts` | drainer refused by the checker and by the contract; drainer balance unchanged |

## Testnet deployment

| Role | Account |
| --- | --- |
| Vault (agent's spending account) | [leash-vault-k21owo.testnet](https://testnet.nearblocks.io/address/leash-vault-k21owo.testnet) |
| Shared registry | [leash-registry-k21owo.testnet](https://testnet.nearblocks.io/address/leash-registry-k21owo.testnet) |
| Owner (human) | [leash-owner-k21owo.testnet](https://testnet.nearblocks.io/address/leash-owner-k21owo.testnet) |
| Simulated bad actor (flagged) | [leash-drainer-k21owo.testnet](https://testnet.nearblocks.io/address/leash-drainer-k21owo.testnet) |
| Agent function-call key | `ed25519:GyEtJ2PAcJgkUMefgw5xHtsPZwSacji5UpT7BpzvPgcy` (method `pay`, receiver the vault, 0.25 NEAR gas allowance) |

Public ids and setup tx hashes: [deployments/testnet.json](deployments/testnet.json).

## Function-call key: what it limits and what it doesn't
- **It can't** transfer NEAR, add or delete keys, deploy code, attach a deposit, or call any method other
  than `pay` on any contract other than the vault. The network rejects these before they reach a block.
- **It can** call `pay` as often as its gas allowance allows. That is why the cap, the 24h budget, the
  approval queue and the registry check live **inside the contract**.
- **Allowance.** The allowance pays only for gas. When it runs out, the agent is locked out (safe, but it
  stops) until the owner adds a fresh key. Agent calls use 100 Tgas, not the maximum: 1 PGas of prepaid gas costs
  about 1 NEAR, which is more than the allowance, so the node rejects it.
- **Owner's full-access key.** The vault account keeps one full-access key, held by the human owner,
  for upgrades and key rotation. The agent never sees it.
- **Shared budget.** Queued payments reserve budget, so approvals can't push spending over the 24h limit.
  `reject` frees the reservation.

## Repository layout
```
contracts/vault       Rust, near-sdk 5: policy-bound spending account
contracts/registry    Rust, near-sdk 5: shared blocklist with evidence
integration-tests     near-workspaces sandbox tests of the full flow
checker               TypeScript counterparty check (CLI + HTTP), tests on recorded data
agent                 SafeWallet, scripted agent, attack demo, demo documents in agent/pages
web                   static owner dashboard (read-only RPC; CLI commands for actions)
scripts               testnet setup and key-limits proof (near-api-js)
docs                  testnet results, attack demo log, dashboard screenshot
```

## Libraries and tools
- [near-sdk-rs](https://github.com/near/near-sdk-rs) 5.x (contracts)
- [cargo-near](https://github.com/near/cargo-near) 0.22 (wasm builds)
- [near-workspaces-rs](https://github.com/near/near-workspaces-rs) 0.24, tokio, serde_json, anyhow (sandbox tests)
- [near-api-js](https://github.com/near/near-api-js) 5 (signing in scripts and agent)
- TypeScript 5 and @types/node (type checking only)
- [near-cli-rs](https://github.com/near/near-cli-rs) 0.30 (commands shown on the dashboard)
- NEAR public RPC (FastNEAR testnet endpoint), [NearBlocks](https://nearblocks.io) public API (account age and activity)

The dashboard uses no third-party front-end code. All code in this repository was written during the
hackathon window (from 2026-11-01); there is no pre-hackathon baseline.

Built with AI-assisted coding tools; all code was reviewed and tested by the author.

## License
MIT. See [LICENSE](LICENSE).

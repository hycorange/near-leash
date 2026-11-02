# Leash — give an AI agent money, not the keys to everything (NEAR)

Work in progress for NEAR HACKATHON (track: AI Security & Defense).

Leash is a policy-bound NEAR wallet for AI agents. The agent holds only a function-call
access key that can call `pay` on its vault contract; the contract enforces per-payment caps,
a rolling 24h budget, a blocklist, and a human approval queue for large or first-time payments.

## Pieces
- `contracts/vault`: the agent's spending account. Its `pay` checks the blocklist, the per-payment cap and the 24h budget, then asks the shared registry (cross-contract, fail-closed). It sends the payment, or queues it for the owner.
- `contracts/registry`: shared blocklist. Anyone can `report(account, reason, evidence_url)` with a 0.01 NEAR deposit. An account is flagged when a curator confirms or 2 distinct reporters agree, and a curator can dismiss a flag.
- `checker/`: counterparty check service (TypeScript). It returns `allow | warn | block` plus reasons, built from registry, vault, RPC and NearBlocks signals. See [checker/README.md](checker/README.md).
- `agent/`: agent-side SafeWallet (checker before every payment; refuse on block, ask a human on warn, sign only with the function-call key), a scripted agent that needs no API keys, and the attack demo. See [docs/ATTACK-DEMO.md](docs/ATTACK-DEMO.md).
- `integration-tests/`: near-workspaces sandbox tests of the full flow.
- `scripts/`: testnet setup and the key-limits proof (near-api-js).

## Build & test
```sh
(cd contracts/vault && cargo test && cargo near build non-reproducible-wasm)
(cd contracts/registry && cargo test && cargo near build non-reproducible-wasm)
(cd checker && npm install && npm test)
(cd agent && npm install && npm test && node src/attack-demo.ts)   # prompt-injection demo on testnet
(cd integration-tests && cargo test -- --test-threads=2)   # local sandbox, see integration-tests/README.md
cd scripts && npm install
node setup-testnet.mjs       # creates faucet accounts, deploys, adds the agent key
node prove-agent-key.mjs     # shows what the agent key can and cannot do
```
Keys are written to `$LEASH_SECRETS` (default `~/.secrets/near_testnet_m2.json`), never into the repo.
Live testnet evidence with transaction links: [docs/TESTNET-RESULTS.md](docs/TESTNET-RESULTS.md).
Toolchain: Rust 1.97.1 + wasm32-unknown-unknown (see rust-toolchain.toml), cargo-near 0.22.0, near-cli-rs 0.30.1.

Testnet deployment: vault `leash-vault-k21owo.testnet`, registry `leash-registry-k21owo.testnet`
```sh
near contract call-function as-read-only leash-registry-k21owo.testnet get_status json-args '{"account":"leash-drainer-k21owo.testnet"}' network-config testnet now
```

## Libraries
near-sdk-rs 5.x, cargo-near, near-cli-rs, near-api-js 5, near-workspaces 0.24 (tests), TypeScript 5 (type checking only). All code written during the hackathon window.

## License
MIT

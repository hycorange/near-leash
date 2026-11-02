# Leash — give an AI agent money, not the keys to everything (NEAR)

Work in progress for NEAR HACKATHON (track: AI Security & Defense).

Leash is a policy-bound NEAR wallet for AI agents. The agent holds only a function-call
access key that can call `pay` on its vault contract; the contract enforces per-payment caps,
a rolling 24h budget, a blocklist, and a human approval queue for large or first-time payments.

## Build & test the vault contract
```sh
cd contracts/vault
cargo test                              # unit tests
cargo near build non-reproducible-wasm  # -> target/near/leash_vault.wasm
```
Toolchain: Rust 1.97.1 + wasm32-unknown-unknown (see rust-toolchain.toml), cargo-near 0.22.0, near-cli-rs 0.30.1.

Testnet deployment (dev): `leash-dev-611136.testnet`
```sh
near contract call-function as-read-only leash-dev-611136.testnet get_policy json-args {} network-config testnet now
```

## Libraries
near-sdk-rs 5.x, cargo-near, near-cli-rs. All code written during the hackathon window.

## License
MIT

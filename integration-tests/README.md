# Sandbox integration tests (near-workspaces)

These tests run the real wasm of both contracts on a local NEAR sandbox node, which is downloaded automatically.

```sh
(cd ../contracts/vault && cargo near build non-reproducible-wasm)
(cd ../contracts/registry && cargo near build non-reproducible-wasm)
cargo test -- --test-threads=2
```
If `openssl-sys` can't find OpenSSL (no `pkg-config`), point it at the system copy:
`OPENSSL_LIB_DIR=/usr/lib/x86_64-linux-gnu OPENSSL_INCLUDE_DIR=/usr/include cargo test`.

Covered:
- a trusted payment moves exactly the amount
- a receiver flagged in the registry is blocked, moves nothing and uses no budget
- two independent reporters auto-flag an account
- a first-time receiver is queued; the agent key can't approve it, the owner can
- reject frees the budget
- the 24h budget is enforced
- the agent key can't transfer, add keys or call owner methods
- the vault fails closed when the registry is unreachable

Note: agent calls use 100 Tgas, not `max_gas()`. 1 PGas of prepaid gas costs about 1 NEAR, which is more
than the agent key's 0.25 NEAR allowance, so the node rejects the transaction with `NotEnoughAllowance`.

Don't run these under a virtual-memory cap such as `prlimit --as` or `ulimit -v`. The sandbox node
reserves a large address space, dies on start, and every test then fails with
`error sending request for url (http://127.0.0.1:…)`.

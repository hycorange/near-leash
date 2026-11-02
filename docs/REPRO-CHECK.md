# Clean-clone reproduction check (2026-11-02)

`git clone` of the repository into an empty directory, then every step from the README "Reproduce everything" table:

| Step | Result |
| --- | --- |
| `contracts/vault` `cargo test` | 11 passed |
| `contracts/registry` `cargo test` | 6 passed |
| `cargo near build non-reproducible-wasm` (both) | both wasm files built |
| `integration-tests` `cargo test -- --test-threads=2` | 8 passed (24 s). Fails if run under a virtual-memory cap, see integration-tests/README.md |
| `checker` `npm ci && npm test && npx tsc -p .` | 21 passed, typecheck clean |
| `agent` `npm ci && npm test && npx tsc -p .` | 6 passed, typecheck clean |
| `web` `npm test` | 4 passed |
| `scripts` `npm ci`, `node --check` on both scripts | ok |
| live `node src/cli.ts leash-drainer-k21owo.testnet 0.05` | `"verdict": "block"`, `registry_flagged` |

Toolchain used: rustc 1.97.1 (pinned), cargo-near 0.22.0, Node 24.

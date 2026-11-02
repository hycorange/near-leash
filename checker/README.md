# Leash checker: counterparty check for paying agents

Before an agent pays, it asks the checker about the receiver. The answer is `allow`, `warn` or `block`,
plus a list of reasons. The vault contract enforces the hard rules on-chain anyway. The checker adds
softer signals the chain can't judge, and it tells the agent *why* before it spends gas.

```sh
cd checker && npm install
node src/cli.ts leash-drainer-k21owo.testnet 0.05     # exit code 0 allow / 1 warn / 2 block
npm run serve                                         # http://127.0.0.1:8787/check?receiver=wrap.testnet&amount=0.05
npm test                                              # replays recorded testnet responses, no network
npm run typecheck
npm run record                                        # re-record fixtures from live testnet
```
Requires Node >= 23.6 (runs the TypeScript sources directly).

## Signals and where they come from

| Signal | Source | Effect |
| --- | --- | --- |
| Flagged in shared registry (curator-confirmed or 2+ reporters) | `registry.get_status` via RPC | block, with the reporters' reasons and evidence URLs |
| Reported but not confirmed | `registry.get_status` | warn |
| On the vault's own blocklist | `vault.is_blocked` | block |
| Amount over the per-payment cap | `vault.get_policy` | block (the contract would reject it anyway) |
| Amount over the review threshold | `vault.get_policy` | warn (the vault will queue it) |
| Vault never paid this receiver | `vault.is_known` | warn |
| Named account does not exist | RPC `view_account` | block |
| Implicit account never used | RPC `view_account` | warn |
| Contract code changed since last check | RPC `code_hash`, compared with the local memory file | warn |
| Contract deployed in the last 7 days | NearBlocks `/account/{id}/contract/deployments` | warn |
| Account younger than 7 days | NearBlocks `/account/{id}` (`created.block_timestamp`) | warn |
| Fewer than 5 transactions | NearBlocks `/account/{id}/txns/count` | warn |
| Not indexed yet (very new or unused) | NearBlocks | warn |
| Lookalike of a trusted receiver (`0/o`, `1/l`, `rn/m`, edit distance ≤ 2) | local | block |
| Registry, RPC or indexer unavailable | n/a | warn (the contract itself fails closed when the registry is down) |

The scoring is a pure function (`src/score.ts`), so the same signals always give the same verdict.
Defaults (vault, registry, trusted receiver) come from `deployments/testnet.json`. You can override
them with `LEASH_VAULT`, `LEASH_REGISTRY`, `LEASH_TRUSTED`, `NEAR_RPC` and `NEARBLOCKS_API`.

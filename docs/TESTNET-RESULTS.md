# Testnet results — M2 (2026-11-02)

Accounts (all testnet, created with the free near-cli faucet):

| Role | Account |
| --- | --- |
| Owner (human) | `leash-owner-k21owo.testnet` |
| Shared registry | `leash-registry-k21owo.testnet` |
| Vault (agent's spending account) | `leash-vault-k21owo.testnet` |
| Simulated bad actor | `leash-drainer-k21owo.testnet` |
| Trusted receiver | `leash-dev-611136.testnet` |

Agent key on the vault: `ed25519:GyEtJ2PAcJgkUMefgw5xHtsPZwSacji5UpT7BpzvPgcy`
Permission read back from RPC (`view_access_key_list`):
`{"FunctionCall":{"allowance":"0.25 NEAR (decreasing with gas used)","method_names":["pay"],"receiver_id":"leash-vault-k21owo.testnet"}}`

## Setup transactions
| Step | Tx |
| --- | --- |
| deploy + init registry (threshold 2 reporters) | [9D9ejgKm…](https://testnet.nearblocks.io/txns/9D9ejgKmnhnRW585Zdw7nL8U3oV8DQiL3EDndtVzN4ia) |
| deploy + init vault (cap 1 NEAR, 24h budget 3 NEAR, review > 0.5 NEAR or new receiver) | [7ioEYDpz…](https://testnet.nearblocks.io/txns/7ioEYDpzkNfNHqrn7SCzJSUVZDSuqQnhEHHM8YJ1HSYb) |
| add agent function-call key (pay only, 0.25 NEAR allowance) | [5RWmjvmt…](https://testnet.nearblocks.io/txns/5RWmjvmtPYEkddaW1epyP8PrMjjLuES6Ln4qWKTjrfT2) |
| report drainer with evidence URL | [5yentDNm…](https://testnet.nearblocks.io/txns/5yentDNmdwyb4G6BLPhU4dw1umJ5fmiW2TarmHyXh4Qo) |
| curator confirms -> FLAGGED | [4pTQpw9R…](https://testnet.nearblocks.io/txns/4pTQpw9Reom2JVGsRZdXPHuMBSxAuuAGizfaoV62j3Hg) |
| owner trusts receiver | [9Ru7gkSE…](https://testnet.nearblocks.io/txns/9Ru7gkSE3Erv8ATPx1kt6yrvEFuQGx9u8DEwqnw2knDs) |

## What the agent key cannot do
All signed with the agent key as `leash-vault-k21owo.testnet`. The network rejects these before
they reach a block, so there is no transaction hash. The error type comes from the RPC node.

| Attempt | Result |
| --- | --- |
| Transfer 0.001 NEAR straight to drainer | rejected: `RequiresFullAccess` |
| Transfer 1 NEAR straight to drainer | rejected: `NotEnoughAllowance` (also requires full access) |
| AddKey (new full-access key) | rejected: `RequiresFullAccess` |
| DeleteKey (owner's key) | rejected: `RequiresFullAccess` |
| call `set_policy` on the vault | rejected: `MethodNameMismatch` |
| call `pay` on a different contract | rejected: `ReceiverMismatch` |
| call `pay` with an attached deposit | rejected: `DepositWithFunctionCall` |

## What `pay` enforces (on-chain)
| Attempt | Result | Tx |
| --- | --- | --- |
| pay 0.05 NEAR to trusted receiver | SENT | [ESiw1f6a…](https://testnet.nearblocks.io/txns/ESiw1f6apoZLZtLMoKSSJaxjsoWsfVbkt8B1pyYA7vVb), [8De1GJn1…](https://testnet.nearblocks.io/txns/8De1GJn1FuAHs7CvYzFYExWmeAtKRi5umw2gJWhuuBcP) |
| pay 0.05 NEAR to drainer (flagged in registry) | panicked: `BLOCKED: receiver is flagged in the shared registry` | [2UsrKMqu…](https://testnet.nearblocks.io/txns/2UsrKMqubzrzAXENygbxr13XTJ98d7qUgMhuh14ZzHHN), [58UJtwoG…](https://testnet.nearblocks.io/txns/58UJtwoG6pSDVTA56kHhf5qb7kNhPzvX3nKCQQhyssvH) |
| pay 2 NEAR (cap is 1) | panicked: `BLOCKED: amount exceeds per-payment cap` | [D2QbJy6Z…](https://testnet.nearblocks.io/txns/D2QbJy6ZGQCmob7frL4cm7hVM8QRP7i4k8w76voNNuAW), [HeE7Uu2d…](https://testnet.nearblocks.io/txns/HeE7Uu2du7JZxWUxbQaofgzs8qXUtdcJ6BM6uWwmgaLm) |
| pay 0.1 NEAR to first-time receiver | QUEUED id=0 (no funds moved) | [98hJa8uT…](https://testnet.nearblocks.io/txns/98hJa8uTmnBdgNZYawuDXvbqonEkTU5oB3NMRNydVYZ) |
| owner `approve(0)` (registry re-checked) | SENT | [8seLnWzP…](https://testnet.nearblocks.io/txns/8seLnWzPstotmmNsFv5MyTFRNVcMAytoUM5rqJv1HdH4) |

Reproduce: `node scripts/setup-testnet.mjs` then `node scripts/prove-agent-key.mjs`
(writes `deployments/prove-agent-key.json`; second-run output kept in `deployments/prove-agent-key-run2.json`).

## Key caveats
- A function-call key can't transfer, add or delete keys, deploy, or attach deposits. It can call only the listed methods on one receiver.
- Its allowance pays only for gas. When the allowance runs out, the agent is locked out until the owner adds a new key. That is a safe failure, but it does stop the agent.
- The vault account still has one full-access key. It is held by the human (owner), and the agent never sees it.

## Run 3: fixed script, first-time-receiver queue path
The script now picks a receiver the vault has not paid yet. Output is in `deployments/prove-agent-key-run3.json`. All 12 checks passed.

| Attempt | Result | Tx |
| --- | --- | --- |
| pay 0.1 NEAR to first-time receiver `leash-registry-k21owo.testnet` | QUEUED id=1 (no funds moved) | [9zmRr6Y1…](https://testnet.nearblocks.io/txns/9zmRr6Y1t6pdfvT2dKqKjndYC8AEm1STb339rWLwLTMu) |
| owner `approve(1)` (registry re-checked) | SENT | [CdCv7gbh…](https://testnet.nearblocks.io/txns/CdCv7gbhFncB1X7HeGL8P1QbPd3SpKRd8sMtfQw9KnJA) |
| pay 0.05 NEAR to trusted receiver | SENT | [4vSK2ohA…](https://testnet.nearblocks.io/txns/4vSK2ohAMLyWEVFHyYNGEivKLioHxGbo7owXoq4365tm) |
| pay 0.05 NEAR to flagged drainer | BLOCKED (registry) | [4P1CFWar…](https://testnet.nearblocks.io/txns/4P1CFWar3XCBvdV4ZECE68PP3KwGQjobWRT8wxpGn3dE) |
| pay 2 NEAR | BLOCKED (cap) | [DQoG8b38…](https://testnet.nearblocks.io/txns/DQoG8b38uXS3HhrYEG4sTrDFitN82SeoMAzp1MJrBYW5) |

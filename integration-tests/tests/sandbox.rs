//! End-to-end tests on a local NEAR sandbox (near-workspaces).
//! Build the contracts first: `cargo near build non-reproducible-wasm` in contracts/vault and contracts/registry.
use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};

/// Gas for agent calls. Not max_gas(): 1 PGas of prepaid gas costs ~1 NEAR and would exceed
/// the agent key's 0.25 NEAR allowance (the node rejects it with NotEnoughAllowance).
const AGENT_GAS: Gas = Gas::from_tgas(100);
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const VAULT_WASM: &str = "../contracts/vault/target/near/leash_vault.wasm";
const REGISTRY_WASM: &str = "../contracts/registry/target/near/leash_registry.wasm";

struct Env {
    worker: Worker<Sandbox>,
    owner: Account,
    vault: Contract,
    registry: Contract,
    agent: Account, // the vault account, but signing with the agent's function-call key
    shop: Account,
}

fn near(n: f64) -> String {
    ((n * 1e6) as u128 * 1_000_000_000_000_000_000u128).to_string()
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.dev_create_account().await?;
    let shop = worker.dev_create_account().await?;
    let registry = worker.dev_deploy(&std::fs::read(REGISTRY_WASM)?).await?;
    registry
        .call("new")
        .args_json(json!({"owner": owner.id(), "auto_flag_reporters": 2}))
        .transact()
        .await?
        .into_result()?;
    let vault = worker.dev_deploy(&std::fs::read(VAULT_WASM)?).await?;
    vault
        .call("new")
        .args_json(json!({
            "owner": owner.id(), "agent": null, "registry": registry.id(),
            "policy": {"per_payment_cap": near(1.0), "daily_budget": near(3.0),
                       "review_above": near(0.5), "review_new_receivers": true}
        }))
        .transact()
        .await?
        .into_result()?;
    // agent key: function-call only, `pay` on the vault, 0.25 NEAR gas allowance
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    vault
        .as_account()
        .batch(vault.id())
        .add_key(
            agent_sk.public_key(),
            AccessKey::function_call_access(vault.id(), &["pay"], Some(NearToken::from_millinear(250))),
        )
        .transact()
        .await?
        .into_result()?;
    let agent = Account::from_secret_key(vault.id().clone(), agent_sk, &worker);
    owner
        .call(vault.id(), "trust")
        .args_json(json!({"account": shop.id()}))
        .transact()
        .await?
        .into_result()?;
    Ok(Env { worker, owner, vault, registry, agent, shop })
}

async fn pay(e: &Env, to: &near_workspaces::AccountId, amount: f64) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(e.agent
        .call(e.vault.id(), "pay")
        .args_json(json!({"receiver": to, "amount": near(amount), "memo": "test"}))
        .gas(AGENT_GAS)
        .transact()
        .await?)
}

fn failure_text(r: &near_workspaces::result::ExecutionFinalResult) -> String {
    format!("{:?}", r.clone().into_result().err())
}

#[tokio::test]
async fn trusted_payment_moves_funds() -> anyhow::Result<()> {
    let e = setup().await?;
    let before = e.shop.view_account().await?.balance;
    let r = pay(&e, e.shop.id(), 0.2).await?;
    assert!(r.is_success(), "{:?}", r.into_result());
    let after = e.shop.view_account().await?.balance;
    assert_eq!(after.as_yoctonear() - before.as_yoctonear(), NearToken::from_millinear(200).as_yoctonear());
    Ok(())
}

#[tokio::test]
async fn registry_flag_blocks_and_moves_nothing() -> anyhow::Result<()> {
    let e = setup().await?;
    let bad = e.worker.dev_create_account().await?;
    e.owner
        .call(e.vault.id(), "trust") // even a trusted receiver is blocked once flagged
        .args_json(json!({"account": bad.id()}))
        .transact()
        .await?
        .into_result()?;
    e.owner
        .call(e.registry.id(), "report")
        .args_json(json!({"account": bad.id(), "reason": "drainer", "evidence_url": "https://example.org/e"}))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    e.owner.call(e.registry.id(), "confirm").args_json(json!({"account": bad.id()})).transact().await?.into_result()?;
    let before = bad.view_account().await?.balance;
    let r = pay(&e, bad.id(), 0.1).await?;
    assert!(r.is_failure());
    assert!(failure_text(&r).contains("flagged in the shared registry"));
    assert_eq!(bad.view_account().await?.balance, before);
    let spent: String = e.vault.view("spent_in_window").await?.json()?;
    assert_eq!(spent, "0", "blocked payment must not consume budget");
    Ok(())
}

#[tokio::test]
async fn two_reporters_auto_flag() -> anyhow::Result<()> {
    let e = setup().await?;
    let bad = e.worker.dev_create_account().await?;
    for _ in 0..2 {
        let reporter = e.worker.dev_create_account().await?;
        reporter
            .call(e.registry.id(), "report")
            .args_json(json!({"account": bad.id(), "reason": "scam", "evidence_url": "https://example.org/e"}))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?
            .into_result()?;
    }
    let flagged: bool = e.registry.view("is_flagged").args_json(json!({"account": bad.id()})).await?.json()?;
    assert!(flagged);
    assert!(pay(&e, bad.id(), 0.1).await?.is_failure());
    Ok(())
}

#[tokio::test]
async fn first_time_receiver_is_queued_then_approved() -> anyhow::Result<()> {
    let e = setup().await?;
    let vendor = e.worker.dev_create_account().await?;
    let before = vendor.view_account().await?.balance;
    let r = pay(&e, vendor.id(), 0.1).await?;
    let out: serde_json::Value = r.json()?;
    assert_eq!(out["Queued"]["id"], 0);
    assert_eq!(vendor.view_account().await?.balance, before, "queued payment must not move funds");
    // the agent key cannot approve its own payment
    let self_approve = e.agent.call(e.vault.id(), "approve").args_json(json!({"id": 0})).gas(AGENT_GAS).transact().await;
    assert!(self_approve.is_err() || self_approve.unwrap().is_failure());
    e.owner.call(e.vault.id(), "approve").args_json(json!({"id": 0})).max_gas().transact().await?.into_result()?;
    let after = vendor.view_account().await?.balance;
    assert_eq!(after.as_yoctonear() - before.as_yoctonear(), NearToken::from_millinear(100).as_yoctonear());
    Ok(())
}

#[tokio::test]
async fn reject_frees_budget() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = pay(&e, e.shop.id(), 0.9).await?; // above review threshold -> queued
    assert!(r.json::<serde_json::Value>()?["Queued"].is_object());
    e.owner.call(e.vault.id(), "reject").args_json(json!({"id": 0})).transact().await?.into_result()?;
    let spent: String = e.vault.view("spent_in_window").await?.json()?;
    assert_eq!(spent, "0");
    Ok(())
}

#[tokio::test]
async fn daily_budget_enforced() -> anyhow::Result<()> {
    let e = setup().await?;
    for _ in 0..6 {
        assert!(pay(&e, e.shop.id(), 0.5).await?.is_success());
    }
    let r = pay(&e, e.shop.id(), 0.5).await?;
    assert!(failure_text(&r).contains("24h budget"), "{}", failure_text(&r));
    // 24h window reset is covered by the vault unit test `budget_resets_after_24h`
    // (fast-forwarding the sandbox clock a full day is too slow for CI).
    Ok(())
}

#[tokio::test]
async fn agent_key_cannot_escape_the_vault() -> anyhow::Result<()> {
    let e = setup().await?;
    // direct transfer
    let t = e.agent.transfer_near(e.shop.id(), NearToken::from_millinear(1)).await;
    assert!(t.is_err() || t.unwrap().is_failure(), "transfer must be refused");
    // add a full-access key
    let k = e
        .agent
        .batch(e.vault.id())
        .add_key(SecretKey::from_random(KeyType::ED25519).public_key(), AccessKey::full_access())
        .transact()
        .await;
    assert!(k.is_err() || k.unwrap().is_failure(), "add_key must be refused");
    // owner-only method
    let p = e
        .agent
        .call(e.vault.id(), "set_policy")
        .args_json(json!({"policy": {"per_payment_cap": near(100.0), "daily_budget": near(100.0),
                                    "review_above": near(100.0), "review_new_receivers": false}}))
        .transact()
        .await;
    assert!(p.is_err() || p.unwrap().is_failure(), "set_policy must be refused");
    // policy unchanged
    let pol: serde_json::Value = e.vault.view("get_policy").await?.json()?;
    assert_eq!(pol["per_payment_cap"], near(1.0));
    Ok(())
}

#[tokio::test]
async fn registry_down_fails_closed() -> anyhow::Result<()> {
    let e = setup().await?;
    e.owner
        .call(e.vault.id(), "set_registry")
        .args_json(json!({"registry": "no-such-registry.test.near"}))
        .transact()
        .await?
        .into_result()?;
    let r = pay(&e, e.shop.id(), 0.1).await?;
    assert!(failure_text(&r).contains("fail-closed"), "{}", failure_text(&r));
    Ok(())
}

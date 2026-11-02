//! Leash vault: an account an AI agent can spend from without holding a full-access key.
//!
//! The agent gets a function-call access key on this account that may call only `pay`.
//! Every `pay` is checked against the owner's policy:
//! - receiver on the blocklist -> rejected
//! - amount above the per-payment cap, or over the rolling 24h budget -> rejected
//! - amount above the review threshold, or receiver not yet seen -> queued for the owner
//! - receiver flagged in the shared Leash registry -> rejected (checked cross-contract, fail-closed)
//! - otherwise -> NEAR transferred immediately
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const GAS_REGISTRY_VIEW: Gas = Gas::from_tgas(5);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);

#[ext_contract(ext_registry)]
#[allow(dead_code)]
trait LeashRegistry {
    fn is_flagged(&self, account: AccountId) -> bool;
}

const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Policy {
    pub per_payment_cap: NearToken,
    pub daily_budget: NearToken,
    pub review_above: NearToken,
    pub review_new_receivers: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Pending {
    pub id: u64,
    pub receiver: AccountId,
    pub amount: NearToken,
    pub memo: String,
    pub reason: String,
    pub created_ns: u64,
}

#[near(serializers = [json])]
pub enum PayOutcome {
    Sent { amount: NearToken },
    Queued { id: u64, reason: String },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    agent: Option<AccountId>,
    registry: Option<AccountId>,
    policy: Policy,
    blocklist: IterableSet<AccountId>,
    known: IterableSet<AccountId>,
    pending: IterableMap<u64, Pending>,
    next_id: u64,
    window_start_ns: u64,
    window_spent: u128,
    paused: bool,
}

#[near]
impl Vault {
    #[init]
    pub fn new(
        owner: AccountId,
        agent: Option<AccountId>,
        registry: Option<AccountId>,
        policy: Policy,
    ) -> Self {
        Self {
            owner,
            agent,
            registry,
            policy,
            blocklist: IterableSet::new(b"b"),
            known: IterableSet::new(b"k"),
            pending: IterableMap::new(b"p"),
            next_id: 0,
            window_start_ns: env::block_timestamp(),
            window_spent: 0,
            paused: false,
        }
    }

    // ---------- agent entry point ----------

    /// Called by the agent (function-call key on this account, or the configured agent account).
    /// Cheap local checks run first; then the shared registry is asked about the receiver and
    /// the payment is decided in `on_registry_check`.
    pub fn pay(
        &mut self,
        receiver: AccountId,
        amount: NearToken,
        memo: String,
    ) -> PromiseOrValue<PayOutcome> {
        self.assert_agent();
        self.precheck(&receiver, amount);
        match self.registry.clone() {
            None => PromiseOrValue::Value(self.decide(receiver, amount, memo)),
            Some(reg) => PromiseOrValue::Promise(
                ext_registry::ext(reg)
                    .with_static_gas(GAS_REGISTRY_VIEW)
                    .is_flagged(receiver.clone())
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_CALLBACK)
                            .on_registry_check(receiver, amount, memo),
                    ),
            ),
        }
    }

    #[private]
    pub fn on_registry_check(
        &mut self,
        receiver: AccountId,
        amount: NearToken,
        memo: String,
        #[callback_result] flagged: Result<bool, PromiseError>,
    ) -> PayOutcome {
        match flagged {
            Ok(false) => {}
            Ok(true) => env::panic_str("BLOCKED: receiver is flagged in the shared registry"),
            Err(_) => env::panic_str("BLOCKED: registry unavailable (fail-closed)"),
        }
        // state may have changed while the registry call was in flight
        self.precheck(&receiver, amount);
        self.decide(receiver, amount, memo)
    }

    // ---------- owner controls ----------

    /// Owner approves a queued payment. The registry is checked again first.
    pub fn approve(&mut self, id: u64) -> PromiseOrValue<()> {
        self.assert_owner();
        let p = self.pending.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such pending id"));
        match self.registry.clone() {
            None => {
                self.release(id);
                PromiseOrValue::Value(())
            }
            Some(reg) => PromiseOrValue::Promise(
                ext_registry::ext(reg)
                    .with_static_gas(GAS_REGISTRY_VIEW)
                    .is_flagged(p.receiver)
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_CALLBACK)
                            .on_approve_check(id),
                    ),
            ),
        }
    }

    #[private]
    pub fn on_approve_check(&mut self, id: u64, #[callback_result] flagged: Result<bool, PromiseError>) {
        match flagged {
            Ok(false) => self.release(id),
            Ok(true) => env::panic_str("receiver was flagged in the shared registry meanwhile"),
            Err(_) => env::panic_str("registry unavailable (fail-closed)"),
        }
    }

    pub fn set_registry(&mut self, registry: Option<AccountId>) {
        self.assert_owner();
        self.registry = registry;
    }

    pub fn reject(&mut self, id: u64) {
        self.assert_owner();
        let p = self.pending.remove(&id).unwrap_or_else(|| env::panic_str("no such pending id"));
        self.window_spent = self.window_spent.saturating_sub(p.amount.as_yoctonear());
        env::log_str(&format!("REJECTED id={id}"));
    }

    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        self.policy = policy;
    }

    pub fn block(&mut self, account: AccountId) {
        self.assert_owner();
        self.blocklist.insert(account);
    }

    pub fn unblock(&mut self, account: AccountId) {
        self.assert_owner();
        self.blocklist.remove(&account);
    }

    pub fn trust(&mut self, account: AccountId) {
        self.assert_owner();
        self.known.insert(account);
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }

    // ---------- views ----------

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_pending(&self) -> Vec<Pending> {
        self.pending.values().cloned().collect()
    }

    pub fn is_blocked(&self, account: AccountId) -> bool {
        self.blocklist.contains(&account)
    }

    pub fn is_known(&self, account: AccountId) -> bool {
        self.known.contains(&account)
    }

    pub fn spent_in_window(&self) -> NearToken {
        if env::block_timestamp() >= self.window_start_ns + DAY_NS {
            NearToken::from_yoctonear(0)
        } else {
            NearToken::from_yoctonear(self.window_spent)
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_registry(&self) -> Option<AccountId> {
        self.registry.clone()
    }

    pub fn get_agent(&self) -> Option<AccountId> {
        self.agent.clone()
    }

    // ---------- internal ----------

    fn precheck(&self, receiver: &AccountId, amount: NearToken) {
        require!(!self.paused, "vault paused by owner");
        require!(amount.as_yoctonear() > 0, "amount must be > 0");
        require!(*receiver != env::current_account_id(), "cannot pay the vault itself");
        require!(!self.blocklist.contains(receiver), "BLOCKED: receiver is on the blocklist");
        require!(
            amount <= self.policy.per_payment_cap,
            "BLOCKED: amount exceeds per-payment cap"
        );
    }

    fn decide(&mut self, receiver: AccountId, amount: NearToken, memo: String) -> PayOutcome {
        self.roll_window();
        require!(
            self.window_spent + amount.as_yoctonear() <= self.policy.daily_budget.as_yoctonear(),
            "BLOCKED: 24h budget exhausted"
        );
        let reason = if amount > self.policy.review_above {
            Some("amount above review threshold")
        } else if self.policy.review_new_receivers && !self.known.contains(&receiver) {
            Some("first payment to this receiver")
        } else {
            None
        };
        // reserve budget now so queued items cannot overrun it later
        self.window_spent += amount.as_yoctonear();
        match reason {
            Some(r) => {
                let id = self.next_id;
                self.next_id += 1;
                self.pending.insert(
                    id,
                    Pending {
                        id,
                        receiver,
                        amount,
                        memo,
                        reason: r.to_string(),
                        created_ns: env::block_timestamp(),
                    },
                );
                env::log_str(&format!("QUEUED id={id} reason={r}"));
                PayOutcome::Queued { id, reason: r.to_string() }
            }
            None => {
                env::log_str(&format!(
                    "SENT {} to {} memo={}",
                    amount.exact_amount_display(),
                    receiver,
                    memo
                ));
                Promise::new(receiver).transfer(amount).detach();
                PayOutcome::Sent { amount }
            }
        }
    }

    fn release(&mut self, id: u64) {
        let p = self.pending.remove(&id).unwrap_or_else(|| env::panic_str("no such pending id"));
        require!(!self.blocklist.contains(&p.receiver), "receiver was blocklisted meanwhile");
        self.known.insert(p.receiver.clone());
        env::log_str(&format!("APPROVED id={id} SENT {} to {}", p.amount.exact_amount_display(), p.receiver));
        Promise::new(p.receiver).transfer(p.amount).detach();
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn assert_agent(&self) {
        let caller = env::predecessor_account_id();
        let ok = caller == env::current_account_id() || Some(&caller) == self.agent.as_ref();
        require!(ok, "agent only");
    }

    fn roll_window(&mut self) {
        let now = env::block_timestamp();
        if now >= self.window_start_ns + DAY_NS {
            self.window_start_ns = now;
            self.window_spent = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(pred: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("vault.testnet"))
            .predecessor_account_id(acc(pred))
            .account_balance(NearToken::from_near(10));
        testing_env!(b.build());
    }

    fn unwrap(r: PromiseOrValue<PayOutcome>) -> PayOutcome {
        match r {
            PromiseOrValue::Value(v) => v,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        }
    }

    fn setup() -> Vault {
        ctx("owner.testnet");
        Vault::new(
            acc("owner.testnet"),
            None,
            None,
            Policy {
                per_payment_cap: NearToken::from_near(1),
                daily_budget: NearToken::from_near(2),
                review_above: NearToken::from_millinear(500),
                review_new_receivers: true,
            },
        )
    }

    #[test]
    fn known_small_payment_is_sent() {
        let mut v = setup();
        v.trust(acc("shop.testnet"));
        ctx("vault.testnet");
        match unwrap(v.pay(acc("shop.testnet"), NearToken::from_millinear(100), "api call".into())) {
            PayOutcome::Sent { .. } => {}
            _ => panic!("expected Sent"),
        }
    }

    #[test]
    fn new_receiver_is_queued_then_approved() {
        let mut v = setup();
        ctx("vault.testnet");
        let id = match unwrap(v.pay(acc("new.testnet"), NearToken::from_millinear(100), "x".into())) {
            PayOutcome::Queued { id, .. } => id,
            _ => panic!("expected Queued"),
        };
        assert_eq!(v.get_pending().len(), 1);
        ctx("owner.testnet");
        let _ = v.approve(id);
        assert!(v.get_pending().is_empty());
        assert!(v.is_known(acc("new.testnet")));
    }

    #[test]
    #[should_panic(expected = "BLOCKED: receiver is on the blocklist")]
    fn blocklisted_receiver_panics() {
        let mut v = setup();
        v.block(acc("scam.testnet"));
        ctx("vault.testnet");
        let _ = v.pay(acc("scam.testnet"), NearToken::from_millinear(1), "x".into());
    }

    #[test]
    #[should_panic(expected = "per-payment cap")]
    fn over_cap_panics() {
        let mut v = setup();
        ctx("vault.testnet");
        let _ = v.pay(acc("a.testnet"), NearToken::from_near(2), "x".into());
    }

    #[test]
    #[should_panic(expected = "24h budget")]
    fn budget_enforced_across_payments() {
        let mut v = setup();
        v.trust(acc("a.testnet"));
        ctx("vault.testnet");
        let _ = v.pay(acc("a.testnet"), NearToken::from_millinear(400), "1".into());
        let _ = v.pay(acc("a.testnet"), NearToken::from_millinear(900), "2".into());
        let _ = v.pay(acc("a.testnet"), NearToken::from_millinear(900), "3".into());
    }

    #[test]
    #[should_panic(expected = "agent only")]
    fn stranger_cannot_pay() {
        let mut v = setup();
        ctx("mallory.testnet");
        let _ = v.pay(acc("a.testnet"), NearToken::from_millinear(1), "x".into());
    }

    #[test]
    fn reject_refunds_budget() {
        let mut v = setup();
        ctx("vault.testnet");
        let id = match unwrap(v.pay(acc("b.testnet"), NearToken::from_millinear(900), "x".into())) {
            PayOutcome::Queued { id, .. } => id,
            _ => panic!(),
        };
        ctx("owner.testnet");
        v.reject(id);
        assert_eq!(v.spent_in_window(), NearToken::from_yoctonear(0));
    }

    #[test]
    fn registry_path_returns_promise_and_callback_decides() {
        let mut v = setup();
        v.set_registry(Some(acc("registry.testnet")));
        ctx("vault.testnet");
        assert!(matches!(
            v.pay(acc("new.testnet"), NearToken::from_millinear(100), "x".into()),
            PromiseOrValue::Promise(_)
        ));
        match v.on_registry_check(acc("new.testnet"), NearToken::from_millinear(100), "x".into(), Ok(false)) {
            PayOutcome::Queued { .. } => {}
            _ => panic!("expected Queued"),
        }
    }

    #[test]
    #[should_panic(expected = "flagged in the shared registry")]
    fn registry_flag_blocks() {
        let mut v = setup();
        v.set_registry(Some(acc("registry.testnet")));
        ctx("vault.testnet");
        v.on_registry_check(acc("drainer.testnet"), NearToken::from_millinear(100), "x".into(), Ok(true));
    }

    #[test]
    #[should_panic(expected = "fail-closed")]
    fn registry_error_fails_closed() {
        let mut v = setup();
        v.set_registry(Some(acc("registry.testnet")));
        ctx("vault.testnet");
        v.on_registry_check(acc("a.testnet"), NearToken::from_millinear(100), "x".into(), Err(PromiseError::Failed));
    }
}

//! Leash registry: a shared blocklist that any agent or vault can report to.
//!
//! - Anyone can `report` an account with a reason and an evidence URL (small storage deposit).
//! - Curators (set by the owner) `confirm` or `dismiss` reports.
//! - An account is flagged when a curator confirmed a report, or when
//!   `auto_flag_reporters` distinct reporters reported it.
//! - Vaults call `is_flagged` before every payment.
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault};

pub const REPORT_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_TEXT: usize = 280;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub reporter: AccountId,
    pub reason: String,
    pub evidence_url: String,
    pub created_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Entry {
    pub reports: Vec<Report>,
    pub confirmed_by: Option<AccountId>,
    pub dismissed_by: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct Status {
    pub flagged: bool,
    pub confirmed: bool,
    pub dismissed: bool,
    pub distinct_reporters: u32,
    pub reports: Vec<Report>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    curators: IterableSet<AccountId>,
    entries: LookupMap<AccountId, Entry>,
    flagged_list: IterableSet<AccountId>,
    auto_flag_reporters: u32,
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId, auto_flag_reporters: u32) -> Self {
        require!(auto_flag_reporters >= 1, "threshold must be >= 1");
        Self {
            owner,
            curators: IterableSet::new(b"c"),
            entries: LookupMap::new(b"e"),
            flagged_list: IterableSet::new(b"f"),
            auto_flag_reporters,
        }
    }

    #[payable]
    pub fn report(&mut self, account: AccountId, reason: String, evidence_url: String) {
        require!(
            env::attached_deposit() >= REPORT_DEPOSIT,
            "attach 0.01 NEAR storage deposit"
        );
        require!(!reason.is_empty() && reason.len() <= MAX_TEXT, "reason: 1-280 chars");
        require!(
            evidence_url.starts_with("https://") && evidence_url.len() <= MAX_TEXT,
            "evidence_url must be an https URL (max 280 chars)"
        );
        let reporter = env::predecessor_account_id();
        require!(reporter != account, "cannot report yourself");
        let mut e = self.entries.get(&account).cloned().unwrap_or_default();
        require!(
            !e.reports.iter().any(|r| r.reporter == reporter),
            "already reported by you"
        );
        e.reports.push(Report {
            reporter: reporter.clone(),
            reason,
            evidence_url,
            created_ns: env::block_timestamp(),
        });
        env::log_str(&format!("REPORTED {account} by {reporter}"));
        self.entries.insert(account.clone(), e);
        self.refresh(&account);
    }

    pub fn confirm(&mut self, account: AccountId) {
        let c = self.assert_curator();
        let mut e = self.entries.get(&account).cloned().unwrap_or_default();
        e.confirmed_by = Some(c);
        e.dismissed_by = None;
        self.entries.insert(account.clone(), e);
        self.refresh(&account);
    }

    pub fn dismiss(&mut self, account: AccountId) {
        let c = self.assert_curator();
        let mut e = self
            .entries
            .get(&account)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no reports for account"));
        e.dismissed_by = Some(c);
        e.confirmed_by = None;
        self.entries.insert(account.clone(), e);
        self.refresh(&account);
    }

    pub fn add_curator(&mut self, account: AccountId) {
        self.assert_owner();
        self.curators.insert(account);
    }

    pub fn remove_curator(&mut self, account: AccountId) {
        self.assert_owner();
        self.curators.remove(&account);
    }

    pub fn set_threshold(&mut self, auto_flag_reporters: u32) {
        self.assert_owner();
        require!(auto_flag_reporters >= 1, "threshold must be >= 1");
        self.auto_flag_reporters = auto_flag_reporters;
    }

    // ---------- views ----------

    pub fn is_flagged(&self, account: AccountId) -> bool {
        self.flagged_list.contains(&account)
    }

    pub fn get_status(&self, account: AccountId) -> Status {
        let e = self.entries.get(&account).cloned().unwrap_or_default();
        Status {
            flagged: self.flagged_list.contains(&account),
            confirmed: e.confirmed_by.is_some(),
            dismissed: e.dismissed_by.is_some(),
            distinct_reporters: e.reports.len() as u32,
            reports: e.reports,
        }
    }

    pub fn get_flagged(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AccountId> {
        self.flagged_list
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_curators(&self) -> Vec<AccountId> {
        self.curators.iter().cloned().collect()
    }

    pub fn get_threshold(&self) -> u32 {
        self.auto_flag_reporters
    }

    // ---------- internal ----------

    fn refresh(&mut self, account: &AccountId) {
        let e = self.entries.get(account).cloned().unwrap_or_default();
        let flagged = e.dismissed_by.is_none()
            && (e.confirmed_by.is_some() || e.reports.len() as u32 >= self.auto_flag_reporters);
        if flagged {
            if self.flagged_list.insert(account.clone()) {
                env::log_str(&format!("FLAGGED {account}"));
            }
        } else if self.flagged_list.remove(account) {
            env::log_str(&format!("UNFLAGGED {account}"));
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn assert_curator(&self) -> AccountId {
        let c = env::predecessor_account_id();
        require!(c == self.owner || self.curators.contains(&c), "curator only");
        c
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
    fn ctx(pred: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("registry.testnet"))
            .predecessor_account_id(acc(pred))
            .attached_deposit(deposit);
        testing_env!(b.build());
    }
    fn setup(th: u32) -> Registry {
        ctx("owner.testnet", NearToken::from_yoctonear(0));
        let mut r = Registry::new(acc("owner.testnet"), th);
        r.add_curator(acc("cur.testnet"));
        r
    }
    const EV: &str = "https://testnet.nearblocks.io/txns/abc";

    #[test]
    fn report_then_confirm_flags() {
        let mut r = setup(3);
        ctx("agent1.testnet", REPORT_DEPOSIT);
        r.report(acc("drainer.testnet"), "phishing payout".into(), EV.into());
        assert!(!r.is_flagged(acc("drainer.testnet")));
        ctx("cur.testnet", NearToken::from_yoctonear(0));
        r.confirm(acc("drainer.testnet"));
        assert!(r.is_flagged(acc("drainer.testnet")));
        let s = r.get_status(acc("drainer.testnet"));
        assert!(s.confirmed && s.distinct_reporters == 1);
        assert_eq!(s.reports[0].evidence_url, EV);
    }

    #[test]
    fn threshold_reporters_auto_flag_and_dismiss_unflags() {
        let mut r = setup(2);
        for a in ["a1.testnet", "a2.testnet"] {
            ctx(a, REPORT_DEPOSIT);
            r.report(acc("bad.testnet"), "scam".into(), EV.into());
        }
        assert!(r.is_flagged(acc("bad.testnet")));
        assert_eq!(r.get_flagged(None, None).len(), 1);
        ctx("cur.testnet", NearToken::from_yoctonear(0));
        r.dismiss(acc("bad.testnet"));
        assert!(!r.is_flagged(acc("bad.testnet")));
    }

    #[test]
    #[should_panic(expected = "already reported by you")]
    fn duplicate_report_rejected() {
        let mut r = setup(2);
        ctx("a1.testnet", REPORT_DEPOSIT);
        r.report(acc("bad.testnet"), "scam".into(), EV.into());
        r.report(acc("bad.testnet"), "scam".into(), EV.into());
    }

    #[test]
    #[should_panic(expected = "storage deposit")]
    fn report_needs_deposit() {
        let mut r = setup(2);
        ctx("a1.testnet", NearToken::from_yoctonear(0));
        r.report(acc("bad.testnet"), "scam".into(), EV.into());
    }

    #[test]
    #[should_panic(expected = "https URL")]
    fn evidence_must_be_https() {
        let mut r = setup(2);
        ctx("a1.testnet", REPORT_DEPOSIT);
        r.report(acc("bad.testnet"), "scam".into(), "javascript:alert(1)".into());
    }

    #[test]
    #[should_panic(expected = "curator only")]
    fn stranger_cannot_confirm() {
        let mut r = setup(2);
        ctx("rando.testnet", NearToken::from_yoctonear(0));
        r.confirm(acc("bad.testnet"));
    }
}

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn requires_actor_auth_and_records_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let actor = Address::generate(&env);

    assert_eq!(client.authorize(&actor, &42), 42);
    assert_eq!(client.last(), Some((actor, 42)));
}

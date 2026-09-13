#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn authorize(env: Env, actor: Address, marker: u32) -> u32 {
        actor.require_auth();
        env.storage()
            .persistent()
            .set(&symbol_short!("last"), &(actor, marker));
        marker
    }

    pub fn last(env: Env) -> Option<(Address, u32)> {
        env.storage().persistent().get(&symbol_short!("last"))
    }
}

mod test;

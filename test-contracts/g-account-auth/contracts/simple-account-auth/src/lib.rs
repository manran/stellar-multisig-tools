#![no_std]

use soroban_sdk::{auth::Context, contract, contractimpl, contracttype, BytesN, Env, Vec};

#[contract]
pub struct SimpleAccountAuth;

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Owner,
}

#[contractimpl]
impl SimpleAccountAuth {
    pub fn __constructor(env: Env, public_key: BytesN<32>) {
        env.storage().instance().set(&DataKey::Owner, &public_key);
    }

    #[allow(non_snake_case)]
    pub fn __check_auth(
        env: Env,
        signature_payload: BytesN<32>,
        signature: BytesN<64>,
        _auth_context: Vec<Context>,
    ) {
        let public_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .expect("owner initialized");
        env.crypto()
            .ed25519_verify(&public_key, &signature_payload.into(), &signature);
    }
}

//! Optimistic oracle + prediction market contracts for Casper, built with Odra.
#![no_std]

extern crate alloc;

pub mod market;
pub mod oracle;
pub mod oracle_v2;

#[cfg(test)]
mod upgrade_demo_tests;

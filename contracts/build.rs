//! Sets the `odra_module` cfg flag from the `ODRA_MODULE` env var, used to select
//! which module's wasm entry points get compiled into `bin/build_contract.rs`.
/// Reads `ODRA_MODULE` and emits the `odra_module` cfg for the crate.
pub fn main() {
    odra_build::build();
}

#![no_main]
use libfuzzer_sys::fuzz_target;
use std::sync::Once;

fuzz_target!(|data: &[u8]| {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        // Tokio catches detached task panics. Abort so libFuzzer retains the
        // reproducer even if the panic happened in a connection/writer task.
        let default = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            default(info);
            std::process::abort();
        }));
    });
    session_server_fuzz::exercise(data);
});

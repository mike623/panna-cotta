use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use super::buffer::WordBuffer;
use super::state::AutocompleteState;

// CoreGraphics / CoreFoundation are already linked by Tauri; no extra [link] needed.
#[cfg(target_os = "macos")]
mod sys {
    use std::os::raw::{c_int, c_void};

    pub type CFMachPortRef = *mut c_void;
    pub type CFRunLoopRef  = *mut c_void;
    pub type CFRunLoopSourceRef = *mut c_void;
    pub type CFStringRef   = *const c_void;
    pub type CGEventRef    = *mut c_void;
    pub type CGEventTapProxy = *mut c_void;
    pub type CGEventTapCallBack = unsafe extern "C" fn(
        proxy:     CGEventTapProxy,
        etype:     u32,
        event:     CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    // kCGSessionEventTap = 1, kCGHeadInsertEventTap = 0, kCGEventTapOptionListenOnly = 1
    pub const KCG_SESSION_EVENT_TAP:        u32 = 1;
    pub const KCG_HEAD_INSERT_EVENT_TAP:    u32 = 0;
    pub const KCG_EVENT_TAP_OPTION_LISTEN:  u32 = 1;
    // CGEventMask bit for kCGEventKeyDown (= 10)
    pub const CG_EVENT_MASK_KEY_DOWN:       u64 = 1 << 10;
    pub const CG_EVENT_KEY_DOWN:            u32 = 10;
    // Sent when the system auto-disables the tap (shouldn't happen for listen-only, but handle it)
    pub const CG_TAP_DISABLED_BY_TIMEOUT:   u32 = 0xFFFFFFFE;
    pub const CG_TAP_DISABLED_BY_USER:      u32 = 0xFFFFFFFF;

    extern "C" {
        pub fn CGEventTapCreate(
            tap:                 u32,
            place:               u32,
            options:             u32,
            events_of_interest:  u64,
            callback:            CGEventTapCallBack,
            user_info:           *mut c_void,
        ) -> CFMachPortRef;

        pub fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);

        pub fn CGEventKeyboardGetUnicodeString(
            event:                CGEventRef,
            max_string_length:    u64,
            actual_string_length: *mut u64,
            unicode_string:       *mut u16,
        );

        pub fn CFMachPortCreateRunLoopSource(
            allocator: *mut c_void,
            port:      CFMachPortRef,
            order:     c_int,
        ) -> CFRunLoopSourceRef;

        pub fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        pub fn CFRunLoopAddSource(
            rl:     CFRunLoopRef,
            source: CFRunLoopSourceRef,
            mode:   CFStringRef,
        );
        pub fn CFRunLoopRun();

        pub static kCFRunLoopDefaultMode: CFStringRef;
    }
}

// Bundle state + key buffer for the C callback. Lives for the app lifetime.
#[cfg(target_os = "macos")]
struct TapContext {
    state:  Arc<AutocompleteState>,
    buffer: WordBuffer,
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn tap_callback(
    _proxy:    sys::CGEventTapProxy,
    etype:     u32,
    event:     sys::CGEventRef,
    user_info: *mut std::os::raw::c_void,
) -> sys::CGEventRef {
    let ctx = &mut *(user_info as *mut TapContext);

    // System auto-disabled the tap (rare for listen-only); re-enable it.
    if etype == sys::CG_TAP_DISABLED_BY_TIMEOUT || etype == sys::CG_TAP_DISABLED_BY_USER {
        let port = ctx.state.tap_port.load(Ordering::SeqCst);
        if port != 0 && !ctx.state.admin_focused.load(Ordering::Relaxed) {
            sys::CGEventTapEnable(port as sys::CFMachPortRef, true);
        }
        return event;
    }

    if etype != sys::CG_EVENT_KEY_DOWN {
        return event;
    }

    if !ctx.state.is_enabled() || ctx.state.admin_focused.load(Ordering::Relaxed) {
        return event;
    }

    let mut chars = [0u16; 8];
    let mut actual_len: u64 = 0;
    sys::CGEventKeyboardGetUnicodeString(
        event,
        chars.len() as u64,
        &mut actual_len,
        chars.as_mut_ptr(),
    );

    if actual_len == 0 {
        return event;
    }

    let s = String::from_utf16_lossy(&chars[..actual_len as usize]);
    if let Some(ch) = s.chars().next() {
        let was_boundary = ctx.buffer.push(ch);
        let (count, fallback) = {
            let cfg = ctx.state.config.lock().unwrap_or_else(|e| e.into_inner());
            (cfg.suggestion_count, cfg.fallback_phrases.clone())
        };
        if was_boundary {
            ctx.state.set_suggestions(fallback, String::new());
        } else {
            let partial = ctx.buffer.current();
            if partial.len() >= 2 {
                let completions = super::spell::get_completions(&partial, count);
                if completions.is_empty() {
                    ctx.state.set_suggestions(fallback, String::new());
                } else {
                    ctx.state.set_suggestions(completions, partial);
                }
            }
        }
    }

    event
}

/// Disable the CGEventTap while admin panel is focused.
/// No-op if the tap was never created (Accessibility permission denied).
#[cfg(target_os = "macos")]
pub fn disable_tap(state: &AutocompleteState) {
    let port = state.tap_port.load(Ordering::SeqCst);
    if port != 0 {
        tracing::debug!("disabling CGEventTap (admin focused)");
        unsafe { sys::CGEventTapEnable(port as sys::CFMachPortRef, false) };
    }
}

/// Re-enable the CGEventTap after admin panel loses focus.
/// No-op if the tap was never created (Accessibility permission denied).
#[cfg(target_os = "macos")]
pub fn enable_tap(state: &AutocompleteState) {
    let port = state.tap_port.load(Ordering::SeqCst);
    if port != 0 {
        tracing::debug!("enabling CGEventTap (admin unfocused)");
        unsafe { sys::CGEventTapEnable(port as sys::CFMachPortRef, true) };
    }
}

/// Create ONE CGEventTap that lives for the entire app lifetime.
/// Pause/resume via disable_tap/enable_tap — never stop/restart.
/// Safe to call from any thread.
pub fn start_monitor(state: Arc<AutocompleteState>) {
    // Idle-reset task: send fallback suggestions after 3s of keyboard inactivity.
    let idle_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            if !idle_state.monitor_running.load(Ordering::Relaxed) {
                break;
            }
            if !idle_state.is_enabled() {
                continue;
            }
            let elapsed = idle_state
                .last_keystroke
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .elapsed();
            if elapsed > Duration::from_secs(3) {
                idle_state.reset_to_fallback();
            }
        }
    });

    // Tap thread: blocks in CFRunLoopRun for the app lifetime.
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        unsafe {
            let ctx = Box::new(TapContext {
                state:  state.clone(),
                buffer: WordBuffer::new(),
            });
            let ctx_ptr = Box::into_raw(ctx) as *mut std::os::raw::c_void;

            let tap_port = sys::CGEventTapCreate(
                sys::KCG_SESSION_EVENT_TAP,
                sys::KCG_HEAD_INSERT_EVENT_TAP,
                sys::KCG_EVENT_TAP_OPTION_LISTEN,
                sys::CG_EVENT_MASK_KEY_DOWN,
                tap_callback,
                ctx_ptr,
            );

            if tap_port.is_null() {
                tracing::warn!(
                    "CGEventTapCreate returned NULL — check Accessibility permission \
                     in System Settings → Privacy & Security → Accessibility"
                );
                state.monitor_running.store(false, Ordering::SeqCst);
                drop(Box::from_raw(ctx_ptr as *mut TapContext));
                return;
            }

            state.tap_port.store(tap_port as usize, Ordering::SeqCst);
            state.monitor_running.store(true, Ordering::SeqCst);
            tracing::debug!(tap_port = tap_port as usize, "CGEventTap created — single tap, app lifetime");

            let source = sys::CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap_port, 0);
            let rl = sys::CFRunLoopGetCurrent();
            sys::CFRunLoopAddSource(rl, source, sys::kCFRunLoopDefaultMode);

            tracing::debug!("CFRunLoopRun starting (blocks until process exits)");
            sys::CFRunLoopRun();

            // Only reached on process exit; ctx intentionally leaked (app-lifetime allocation).
            state.tap_port.store(0, Ordering::SeqCst);
            state.monitor_running.store(false, Ordering::SeqCst);
        }

        #[cfg(not(target_os = "macos"))]
        state.monitor_running.store(false, Ordering::SeqCst);
    });
}

// Keeps a console window from opening next to Pia on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pia_lib::run()
}

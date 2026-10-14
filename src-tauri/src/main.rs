// src/main.rs
// 桌面端入口：真正的实现在 lib.rs 的 run() 里。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sophotask::run()
}

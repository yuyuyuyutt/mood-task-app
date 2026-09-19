// src/lib.rs
// 应用唯一入口：所有命令注册、插件挂载、数据库初始化都在这里。
// 桌面端 main.rs 只是这一层的薄封装（保证桌面/移动端只有一份命令注册）。
mod commands;
mod database;
mod http;

use commands::{
    create_task,
    delete_task,
    get_tasks,
    patch_task,
    plugin_data_clear,
    plugin_data_clear_namespace,
    plugin_data_delete,
    plugin_data_dump,
    plugin_data_get,
    plugin_data_list,
    plugin_data_put,
    search_bilibili,
    search_searxng,
    AppState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // 外链跳转（资源库 / 计划生成器的 B 站等资源）依赖该插件，前端走 openExternal()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 在 setup 阶段初始化数据库
            match database::init_db(app.handle()) {
                Ok(pool) => {
                    println!("数据库初始化成功");
                    app.manage(AppState { db_pool: pool });
                    Ok(())
                }
                Err(e) => {
                    eprintln!("数据库初始化失败: {}", e);
                    Err(Box::<dyn std::error::Error>::from(e))
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            create_task,
            patch_task,
            delete_task,
            plugin_data_list,
            plugin_data_get,
            plugin_data_put,
            plugin_data_delete,
            plugin_data_clear,
            plugin_data_clear_namespace,
            plugin_data_dump,
            search_bilibili,
            search_searxng,
        ])
        .run(tauri::generate_context!())
        .expect("运行Tauri应用失败");
}

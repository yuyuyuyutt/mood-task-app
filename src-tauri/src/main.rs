// src/main.rs
mod commands;
mod database;

use commands::{
    create_task,
    delete_mood,
    delete_task,
    get_moods,
    get_tasks,
    plugin_data_clear,
    plugin_data_clear_namespace,
    plugin_data_delete,
    plugin_data_get,
    plugin_data_list,
    plugin_data_put,
    save_mood,
    update_habit_completion, // 新增习惯完成更新
    update_task,
    AppState,
};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 在 setup 阶段初始化数据库
            match database::init_db(app.handle()) {
                Ok(pool) => {
                    println!("数据库初始化成功");
                    // 创建应用状态并管理
                    let app_state = AppState { db_pool: pool };
                    app.manage(app_state);
                    Ok(())
                }
                Err(e) => {
                    eprintln!("数据库初始化失败: {}", e);
                    // 在Tauri 2.0中，setup返回Result<(), Box<dyn std::error::Error>>
                    Err(Box::<dyn std::error::Error>::from(e))
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tasks,
            create_task,
            update_task,
            delete_task,
            update_habit_completion, // 注册习惯完成更新命令
            get_moods,
            save_mood,
            delete_mood,
            // 插件命名空间数据命令
            plugin_data_list,
            plugin_data_get,
            plugin_data_put,
            plugin_data_delete,
            plugin_data_clear,
            plugin_data_clear_namespace,
        ])
        .run(tauri::generate_context!())
        .expect("运行Tauri应用失败");
}

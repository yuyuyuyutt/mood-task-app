// src/migrate.rs
// 品牌更名（mood-task-app → sophotask）后的一次性数据搬迁。
//
// 为什么要做：Tauri 的 AppData / LocalAppData 目录名就是 bundle identifier，
// 标识符从 `com.moodtask.app` 改成 `com.sophotask.app` 之后，程序会去一个全新的空目录读写，
// 用户升级后就会看到"任务、心情、插件、头像全没了"。
//
// 策略：**只补缺失，绝不覆盖**。新目录里已有的文件一律保留（那才是当前数据），
// 旧目录保持原样不删除，方便用户核对或回退。
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 更名前的 bundle identifier（旧目录名）
const LEGACY_IDENTIFIER: &str = "com.moodtask.app";
/// 当前的 bundle identifier（新目录名，必须与 tauri.conf.json 一致）
const CURRENT_IDENTIFIER: &str = "com.sophotask.app";

/// 由当前目录推出更名前目录（同一父目录下的兄弟目录）。
///
/// 只有当目录名恰好是当前标识符时才推导 —— 否则说明这是用户自定义路径，
/// 不能想当然地把邻居目录当成旧数据。
fn legacy_dir_of(current: &Path) -> Option<PathBuf> {
    let name = current.file_name()?.to_str()?;
    if name != CURRENT_IDENTIFIER {
        return None;
    }
    Some(current.parent()?.join(LEGACY_IDENTIFIER))
}

/// 递归复制 `from` 下所有"目标不存在"的文件/目录，返回复制的文件数。
fn copy_missing(from: &Path, to: &Path) -> std::io::Result<usize> {
    if !from.is_dir() {
        return Ok(0);
    }
    std::fs::create_dir_all(to)?;

    let mut copied = 0;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if target.exists() {
            continue;
        }
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copied += copy_missing(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// 应用启动时调用：把旧标识符目录下的数据搬到新目录。
///
/// 幂等 —— 新目录已有内容时什么都不做，因此每次启动调用都安全。
/// 失败只记日志：迁移是"尽力而为"的兼容措施，不能让它阻塞应用启动。
pub fn migrate_legacy_app_dirs(app: &tauri::AppHandle) {
    for dir in [app.path().app_local_data_dir(), app.path().app_data_dir()] {
        let Ok(new_dir) = dir else { continue };
        let Some(old_dir) = legacy_dir_of(&new_dir) else {
            continue;
        };
        if !old_dir.is_dir() {
            continue;
        }

        match copy_missing(&old_dir, &new_dir) {
            Ok(0) => {}
            Ok(count) => println!(
                "[sophotask] 已从更名前的目录 {:?} 迁移 {} 个文件",
                old_dir, count
            ),
            Err(err) => eprintln!("[sophotask] 更名前目录迁移失败（已忽略）: {}", err),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("sophotask-migrate-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn legacy_dir_derived_only_for_current_identifier() {
        let root = PathBuf::from("/tmp/base");
        assert_eq!(
            legacy_dir_of(&root.join(CURRENT_IDENTIFIER)),
            Some(root.join(LEGACY_IDENTIFIER))
        );
        // 自定义路径不推导，避免把邻居目录当成旧数据
        assert_eq!(legacy_dir_of(&root.join("my-custom-dir")), None);
    }

    #[test]
    fn copy_missing_fills_gaps_without_overwriting() {
        let root = temp_root("copy");
        let old = root.join("old");
        let new = root.join("new");
        std::fs::create_dir_all(old.join("nested")).unwrap();
        std::fs::create_dir_all(&new).unwrap();

        std::fs::write(old.join("keep.txt"), "old-value").unwrap();
        std::fs::write(old.join("only-in-old.txt"), "old-only").unwrap();
        std::fs::write(old.join("nested/deep.txt"), "deep").unwrap();
        // 新目录里已经有的文件不能被旧值覆盖
        std::fs::write(new.join("keep.txt"), "new-value").unwrap();

        let copied = copy_missing(&old, &new).unwrap();

        assert_eq!(copied, 2, "只应复制 only-in-old.txt 与 nested/deep.txt");
        assert_eq!(
            std::fs::read_to_string(new.join("keep.txt")).unwrap(),
            "new-value"
        );
        assert_eq!(
            std::fs::read_to_string(new.join("only-in-old.txt")).unwrap(),
            "old-only"
        );
        assert_eq!(
            std::fs::read_to_string(new.join("nested/deep.txt")).unwrap(),
            "deep"
        );

        // 再跑一遍应无事可做（幂等）
        assert_eq!(copy_missing(&old, &new).unwrap(), 0);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_missing_is_noop_when_source_is_missing() {
        let root = temp_root("noop");
        assert_eq!(copy_missing(&root.join("nope"), &root.join("dst")).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}

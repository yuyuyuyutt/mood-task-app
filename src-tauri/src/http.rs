// src/http.rs
// 出站 HTTP 层：计划生成器的资源采集（B 站搜索 / SearXNG）统一走这里。
//
// 为什么放在 Rust 侧：
// - 浏览器 / WebView 受同源策略约束，api.bilibili.com 不返回 CORS 头，前端 fetch 必然失败；
//   Rust 侧的 reqwest 不受同源策略约束，可以正常访问。
// - 请求头（Origin / Referer / User-Agent）在浏览器里属受保护头，JS 无法设置；
//   Rust 侧可以自由设置，从而绕过 B 站的简单风控。
//
// 关键约束：
// - Client 必须全局复用（内部持有连接池 + TLS 会话），不要每次请求都新建；
// - 超时统一由调用方传入，默认 10 秒；
// - 本模块只负责「拿到 JSON」，不解析任何业务语义。
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

/// 模拟真实浏览器的 UA（B 站会对空 UA / 脚本 UA 返回 403）
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/// 全局复用的 HTTP 客户端
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// 默认超时（毫秒）
pub const DEFAULT_TIMEOUT_MS: u64 = 10_000;

fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            // 允许跟随重定向（B 站部分接口会跳转）
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("构建 HTTP 客户端失败")
    })
}

/// 请求一个 JSON 接口并返回解析后的值。
///
/// - `referer`：部分站点（如 B 站）校验来源，传 None 则不发送该头；
/// - `timeout_ms`：本次请求超时，传 None 用默认值；
/// - 失败返回可读的中文错误串，由上层决定是否静默降级。
pub async fn fetch_json(
    url: &str,
    referer: Option<&str>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let mut req = client()
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json, text/plain, */*")
        .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9");

    if let Some(r) = referer {
        req = req.header(reqwest::header::REFERER, r);
    }
    if let Some(ms) = timeout_ms {
        req = req.timeout(Duration::from_millis(ms.max(1000)));
    }

    let res = req
        .send()
        .await
        .map_err(|e| describe_reqwest_error(&e))?;

    let status = res.status();
    if !status.is_success() {
        // 403 是最常见的情况（B 站风控 / SearXNG 未开启 json 格式）
        return Err(format!("HTTP {}", status.as_u16()));
    }

    res.json::<Value>()
        .await
        .map_err(|e| format!("响应不是合法 JSON：{}", e))
}

/// 拉取**文本型**资源（正文抓取用）。
///
/// - `max_bytes`：下载后按字节截断，避免大页面同时拖垮内存与 IPC（截断可能切坏 UTF-8，
///   所以统一走 `from_utf8_lossy` 而不是报错）；
/// - 只接受文本类 content-type（HTML / 纯文本 / JSON / XML），图片视频直接拒绝；
/// - 调用方（命令层）必须已经做过 SSRF 判断，本函数不再重复。
pub async fn fetch_text(
    url: &str,
    timeout_ms: Option<u64>,
    max_bytes: usize,
) -> Result<(String, String), String> {
    let mut req = client()
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9");

    if let Some(ms) = timeout_ms {
        req = req.timeout(Duration::from_millis(ms.max(1000)));
    }

    let res = req
        .send()
        .await
        .map_err(|e| describe_reqwest_error(&e))?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let lower = content_type.to_ascii_lowercase();
    let is_text = lower.is_empty()
        || lower.contains("text/")
        || lower.contains("html")
        || lower.contains("json")
        || lower.contains("xml");
    if !is_text {
        return Err(format!("非文本内容（{}）", content_type));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| describe_reqwest_error(&e))?;
    let slice = if bytes.len() > max_bytes {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };
    Ok((content_type, String::from_utf8_lossy(slice).to_string()))
}

/// 把 reqwest 的错误翻译成用户能看懂的中文说明
fn describe_reqwest_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "请求超时".to_string();
    }
    if e.is_connect() {
        return "无法建立连接（服务未启动，或地址 / 端口不正确）".to_string();
    }
    format!("请求失败：{}", e)
}

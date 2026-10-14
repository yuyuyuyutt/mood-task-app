// src/content.rs
// 正文抓取的**纯函数部分**：SSRF 防护判断、HTML → 纯文本、标题提取。
//
// 为什么正文抓取要放在 Rust：
//   - 与 B 站 / SearXNG 同理，WebView 里的 fetch 受同源策略约束，抓任意站点必然被 CORS 拦；
//   - 顺便在 Rust 侧做**SSRF 防护**（拒绝本机 / 内网 / 链路本地地址），
//     这是一道硬安全边界，不能只依赖前端的域名白名单。
//
// 本模块不碰网络，命令层在 commands.rs，因此可以直接用 `cargo test` 覆盖。
/// 正文只用于检索增强，不需要整页；超出部分截断（同时限制 IPC 传输量）
pub const MAX_TEXT_CHARS: usize = 12_000;

/// 下载字节上限：超大的页面（视频页 / 聚合页）直接在 HTTP 层就被砍掉
pub const MAX_BYTES: usize = 800_000;

/// 是否允许抓取该 host。
/// 拒绝：localhost / .local / .internal / 私有网段 IPv4 / 环回与链路本地 IPv6。
pub fn is_public_host(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    if h.is_empty() {
        return false;
    }
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h.ends_with(".internal") {
        return false;
    }

    // IPv4 字面量：逐段判断私有 / 保留网段
    let parts: Vec<&str> = h.split('.').collect();
    if parts.len() == 4 {
        if let (Ok(a), Ok(b)) = (parts[0].parse::<u8>(), parts[1].parse::<u8>()) {
            let private = a == 0
                || a == 10
                || a == 127
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168);
            return !private;
        }
    }

    // IPv6 字面量（形如 [::1]）
    if h.starts_with('[') {
        let inner = h.trim_start_matches('[');
        if inner.starts_with("::1")
            || inner.starts_with("fe80")
            || inner.starts_with("fc")
            || inner.starts_with("fd")
        {
            return false;
        }
    }

    true
}

/// 去掉 script / style / noscript / head 与注释（大小写不敏感，容忍属性）
fn strip_hidden_blocks(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0usize;
    while i < html.len() {
        let rest = &lower[i..];
        let mut matched = false;
        for tag in ["<script", "<style", "<noscript", "<head", "<!--"] {
            if rest.starts_with(tag) {
                let closer = match tag {
                    "<!--" => "-->",
                    _ => ">",
                };
                // 找到该块的结束位置：注释找 -->，标签块找对应的 </tag>
                let end = if tag == "<!--" {
                    rest.find(closer).map(|p| i + p + closer.len())
                } else {
                    let name = &tag[1..];
                    rest.find(&format!("</{}", name))
                        .and_then(|p| rest[p..].find('>').map(|q| i + p + q + 1))
                };
                match end {
                    Some(e) => {
                        i = e;
                        matched = true;
                    }
                    // 没有闭合标签：整段丢弃
                    None => {
                        i = html.len();
                        matched = true;
                    }
                }
                break;
            }
        }
        if matched {
            continue;
        }
        // 按 UTF-8 字符边界推进
        let ch_len = utf8_len(bytes[i]);
        out.push_str(&html[i..i + ch_len]);
        i += ch_len;
    }
    out
}

fn utf8_len(first_byte: u8) -> usize {
    if first_byte < 0x80 {
        1
    } else if first_byte >> 5 == 0b110 {
        2
    } else if first_byte >> 4 == 0b1110 {
        3
    } else {
        4
    }
}

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&mdash;", "—")
        .replace("&hellip;", "…")
        .replace("&amp;", "&")
}

/// HTML → 纯文本。块级标签转换为换行，折叠空白，最后按字符数截断（不切坏 UTF-8）。
pub fn html_to_text(html: &str, max_chars: usize) -> String {
    let stripped = strip_hidden_blocks(html);

    let mut text = String::with_capacity(stripped.len() / 2);
    let mut in_tag = false;
    for ch in stripped.chars() {
        match ch {
            '<' => {
                in_tag = true;
                // 块级分隔：换成换行，保留段落感（后续会折叠多余空行）
                text.push('\n');
            }
            '>' => {
                in_tag = false;
                text.push('\n');
            }
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }

    let decoded = decode_entities(&text);

    // 折叠空白：行内多空白 → 单空格；连续空行 → 最多一个换行
    let mut collapsed = String::with_capacity(decoded.len());
    let mut pending_newline = false;
    for line in decoded.lines() {
        let cleaned = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if cleaned.is_empty() {
            pending_newline = true;
            continue;
        }
        if !collapsed.is_empty() {
            collapsed.push('\n');
            if pending_newline {
                // 段落之间只留一个换行，避免大量空白占满 prompt
                pending_newline = false;
            }
        }
        collapsed.push_str(&cleaned);
    }

    truncate_chars(&collapsed, max_chars)
}

/// 按字符数截断（不会切坏 UTF-8），并标记是否被截断
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect()
}

// ==================== HTML → Markdown（结构化子集） ====================
//
// 为什么需要它：`html_to_text` 会把结构全部抹平，于是"这段是标题""这里是重点""这是代码"
// 到了阅读界面就都变成了同一种灰字。阅读模式的全部价值就是**让重点看得出来**，
// 所以在同一份 HTML 上再产出一次 Markdown（保留标题层级 / 加粗 / 列表 / 代码块 / 引用 / 链接）。
//
// 分工：`html_to_text` 继续服务检索与证据（文本越干净越好，标记反而是噪声）；
//      `html_to_markdown` 只服务阅读展示。两者都是纯函数，互不影响。

/// 这些标签只表示"分段"，本身不产生 Markdown 标记
fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "main"
            | "aside"
            | "nav"
            | "tr"
            | "table"
            | "thead"
            | "tbody"
            | "tfoot"
            | "figure"
            | "figcaption"
            | "dl"
            | "dt"
            | "dd"
            | "form"
            | "fieldset"
            | "details"
            | "summary"
            | "label"
            | "address"
            | "center"
    )
}

/// 解析一个标签：返回（是否闭合、标签名、href、'<' 之后的下标）
fn parse_tag(html: &str, start: usize) -> Option<(bool, String, Option<String>, usize)> {
    let rest = &html[start + 1..];
    if rest.starts_with('!') || rest.starts_with('?') {
        return None;
    }
    let closing = rest.starts_with('/');
    let body = if closing { &rest[1..] } else { rest };
    let name_end = body
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .unwrap_or(body.len());
    let name = body[..name_end].to_ascii_lowercase();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let tag_end = start + html[start..].find('>')? + 1;
    let href = if name == "a" {
        extract_attr(&html[start..tag_end], "href")
    } else {
        None
    };
    Some((closing, name, href, tag_end))
}

/// 取属性值（支持双引号 / 单引号 / 无引号）
fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let key = format!("{}=", attr);
    let pos = lower.find(&key)? + key.len();
    let rest = &tag[pos..];
    let first = rest.chars().next()?;
    let value = if first == '"' || first == '\'' {
        let end = rest[1..]
            .find(first)
            .map(|p| p + 1)
            .unwrap_or(rest.len().saturating_sub(1));
        &rest[1..end]
    } else {
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        &rest[..end]
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 取出 `<pre>…</pre>` 的内容（丢掉语法高亮用的行内标签），返回（文本, `</pre>` 之后的下标）
fn extract_pre(html: &str, start: usize) -> (String, usize) {
    let after_open = match html[start..].find('>') {
        Some(p) => start + p + 1,
        None => return (String::new(), html.len()),
    };
    let lower = html[after_open..].to_ascii_lowercase();
    let (inner_end, next) = match lower.find("</pre") {
        Some(p) => {
            let inner_end = after_open + p;
            let next = html[inner_end..]
                .find('>')
                .map(|q| inner_end + q + 1)
                .unwrap_or(html.len());
            (inner_end, next)
        }
        None => (html.len(), html.len()),
    };

    let raw = &html[after_open..inner_end];
    let mut out = String::with_capacity(raw.len());
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    (out, next)
}

/// 只在 http(s) 下生成链接标记；相对链接 / javascript: 一律退化成纯文字
fn normalize_href(href: &str) -> Option<String> {
    let h = href.trim();
    if h.starts_with("http://") || h.starts_with("https://") {
        Some(h.to_string())
    } else if let Some(rest) = h.strip_prefix("//") {
        Some(format!("https://{}", rest))
    } else {
        None
    }
}

/// Markdown 写入器：维护"当前行 / 列表栈 / 引用深度"，最后统一成文
struct MdWriter {
    /// (引用深度, 行内容)
    lines: Vec<(usize, String)>,
    line: String,
    line_quote: usize,
    quote_depth: usize,
    /// true = 有序列表
    list_stack: Vec<bool>,
    counter_stack: Vec<usize>,
    link: Option<String>,
    /// 上一段文本是"纯空白"，下一段文本前需要补一个空格
    pending_space: bool,
}

impl MdWriter {
    fn new() -> Self {
        Self {
            lines: Vec::new(),
            line: String::new(),
            line_quote: 0,
            quote_depth: 0,
            list_stack: Vec::new(),
            counter_stack: Vec::new(),
            link: None,
            pending_space: false,
        }
    }

    fn flush_line(&mut self) {
        let line = self.line.trim_end().to_string();
        if !line.is_empty() {
            self.lines.push((self.line_quote, line));
        }
        self.line.clear();
        self.line_quote = self.quote_depth;
        self.pending_space = false;
    }

    /// 强制换行但不算空行（`<br>`）
    fn newline(&mut self) {
        self.flush_line();
    }

    /// 段落间隔：保证与上一行之间恰好一个空行
    fn blank(&mut self) {
        self.flush_line();
        self.pending_space = false;
        if !self.lines.is_empty() {
            self.lines.push((0, String::new()));
        }
    }

    /// 正文：折叠空白（换行在 Markdown 里没有意义，段落由 block 标签决定）。
    ///
    /// 空格的处理必须跟着**原文里到底有没有空白**走，不能"看到行内容就补一个空格"：
    /// 否则 `<strong>重点</strong>` 会变成 `** 重点**`（标记与内容被空格拆开，Markdown 失效）。
    fn text(&mut self, raw: &str) {
        if raw.is_empty() {
            return;
        }
        let tokens: Vec<&str> = raw.split_whitespace().collect();
        if tokens.is_empty() {
            // 纯空白片段：记下来，下一段文本前补一个空格
            if !self.line.is_empty() {
                self.pending_space = true;
            }
            return;
        }

        let leading = raw.starts_with(|c: char| c.is_whitespace());
        if (leading || self.pending_space) && !self.line.is_empty() && !self.line.ends_with(' ') {
            self.line.push(' ');
        }
        self.pending_space = false;
        self.line.push_str(&tokens.join(" "));
    }

    fn code_block(&mut self, code: &str) {
        self.blank();
        let depth = self.quote_depth;
        self.lines.push((depth, "```".to_string()));
        for line in code.replace("\r\n", "\n").split('\n') {
            self.lines.push((depth, line.trim_end().to_string()));
        }
        self.lines.push((depth, "```".to_string()));
        self.blank();
    }

    fn tag(&mut self, closing: bool, name: &str, href: Option<&str>) {
        match name {
            "br" => self.newline(),
            "hr" => {
                self.blank();
                self.lines.push((self.quote_depth, "---".to_string()));
                self.blank();
            }
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                if closing {
                    self.blank();
                } else {
                    self.blank();
                    let level = name[1..].parse::<usize>().unwrap_or(2).clamp(1, 6);
                    self.line.push_str(&"#".repeat(level));
                    self.line.push(' ');
                }
            }
            "strong" | "b" => self.line.push_str("**"),
            "em" | "i" => self.line.push('*'),
            "del" | "s" | "strike" => self.line.push_str("~~"),
            "code" => self.line.push('`'),
            "a" => {
                if closing {
                    if let Some(url) = self.link.take() {
                        self.line.push_str(&format!("]({})", url));
                    }
                } else {
                    let url = href.and_then(normalize_href);
                    if url.is_some() {
                        self.line.push('[');
                    }
                    self.link = url;
                }
            }
            "blockquote" => {
                self.blank();
                if closing {
                    self.quote_depth = self.quote_depth.saturating_sub(1);
                } else {
                    self.quote_depth += 1;
                }
            }
            "ul" | "ol" => {
                self.blank();
                if closing {
                    self.list_stack.pop();
                    self.counter_stack.pop();
                    self.line_quote = self.quote_depth;
                } else {
                    self.list_stack.push(name == "ol");
                    self.counter_stack.push(0);
                }
            }
            "li" => {
                if closing {
                    self.blank();
                } else {
                    self.flush_line();
                    self.line_quote = self.quote_depth;
                    let depth = self.list_stack.len().saturating_sub(1).min(3);
                    let ordered = *self.list_stack.last().unwrap_or(&false);
                    let marker = if ordered {
                        if let Some(counter) = self.counter_stack.last_mut() {
                            *counter += 1;
                            format!("{}. ", *counter)
                        } else {
                            "- ".to_string()
                        }
                    } else {
                        "- ".to_string()
                    };
                    self.line.push_str(&"  ".repeat(depth));
                    self.line.push_str(&marker);
                }
            }
            other if is_block_tag(other) => self.blank(),
            _ => {}
        }
    }

    /// 汇总：按引用深度加前缀，压缩连续空行（**围栏代码块内不压缩**，否则会破坏代码）
    fn finish(mut self) -> String {
        self.flush_line();
        let mut out = String::new();
        let mut in_fence = false;
        let mut pending_blank = false;

        for (depth, line) in self.lines {
            let is_fence = line.trim_start().starts_with("```");
            if is_fence {
                in_fence = !in_fence;
            }
            if line.is_empty() && !in_fence {
                if !out.is_empty() {
                    pending_blank = true;
                }
                continue;
            }
            if !out.is_empty() {
                out.push('\n');
                if pending_blank {
                    out.push('\n');
                }
            }
            pending_blank = false;
            for _ in 0..depth {
                out.push_str("> ");
            }
            out.push_str(&line);
        }
        out
    }
}

/// HTML → Markdown（结构化子集）。与 `html_to_text` 同源同策略：
/// 先剥掉 script/style/head/注释，再按标签映射标记，最后按字符数截断。
pub fn html_to_markdown(html: &str, max_chars: usize) -> String {
    let stripped = strip_hidden_blocks(html);
    let bytes = stripped.as_bytes();
    let mut writer = MdWriter::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while i < stripped.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }

        // 标签之前的正文
        if i > text_start {
            writer.text(&stripped[text_start..i]);
        }

        // <pre> 独立处理：代码里出现 '<' 不能当标签解析
        if matches!(parse_tag(&stripped, i), Some((false, ref name, _, _)) if name == "pre") {
            let (code, next) = extract_pre(&stripped, i);
            writer.code_block(&code);
            i = next;
            text_start = i;
            continue;
        }

        match parse_tag(&stripped, i) {
            Some((closing, name, href, end)) => {
                writer.tag(closing, &name, href.as_deref());
                i = end;
                text_start = i;
            }
            // 不是标签（正文里的孤立 '<'）：留在文本里，继续往后找
            None => i += 1,
        }
    }

    if i > text_start {
        writer.text(&stripped[text_start..]);
    }

    truncate_chars(&decode_entities(&writer.finish()), max_chars)
}

/// 从 <title> 提取标题（没有则返回空串）
pub fn extract_title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let start = match lower.find("<title") {
        Some(p) => p,
        None => return String::new(),
    };
    let inner_start = match lower[start..].find('>') {
        Some(p) => start + p + 1,
        None => return String::new(),
    };
    let inner_end = match lower[inner_start..].find("</title") {
        Some(p) => inner_start + p,
        None => return String::new(),
    };
    let raw = &html[inner_start..inner_end];
    decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_hosts_and_allows_public_ones() {
        for blocked in [
            "localhost",
            "127.0.0.1",
            "10.0.0.5",
            "192.168.1.10",
            "172.16.3.4",
            "169.254.0.1",
            "foo.local",
            "svc.internal",
            "[::1]",
            "",
        ] {
            assert!(!is_public_host(blocked), "应拒绝 {}", blocked);
        }
        for allowed in ["www.bilibili.com", "8.8.8.8", "example.com", "1.1.1.1"] {
            assert!(is_public_host(allowed), "应允许 {}", allowed);
        }
    }

    #[test]
    fn strips_scripts_styles_and_comments() {
        let html = r#"<html><head><title>标题</title><style>.a{color:red}</style></head>
            <body><!-- 注释 --><script>alert('x')</script><p>正文一</p><noscript>忽略</noscript></body></html>"#;
        let text = html_to_text(html, 1000);
        assert!(text.contains("正文一"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("注释"));
        assert!(!text.contains("忽略"));
        assert!(!text.contains("<p>"));
    }

    #[test]
    fn decodes_entities_and_collapses_blank_lines() {
        let text = html_to_text("<div>a &amp; b</div>\n\n\n<div>&lt;tag&gt;&nbsp;c</div>", 1000);
        assert_eq!(text, "a & b\n<tag> c");
    }

    #[test]
    fn truncates_on_char_boundary() {
        let html = format!("<p>{}</p>", "中文测试".repeat(50));
        let text = html_to_text(&html, 10);
        assert_eq!(text.chars().count(), 10);
        assert!(text.starts_with("中文测试"));
    }

    #[test]
    fn unclosed_script_block_is_dropped_entirely() {
        let text = html_to_text("<p>保留</p><script>var x = 1;", 1000);
        assert!(text.contains("保留"));
        assert!(!text.contains("var x"));
    }

    #[test]
    fn extracts_title_with_entities() {
        assert_eq!(
            extract_title("<html><head><TITLE> RAG &amp; Agent </TITLE></head>"),
            "RAG & Agent"
        );
        assert_eq!(extract_title("<html>无标题</html>"), "");
    }

    // ---------------- html_to_markdown ----------------

    #[test]
    fn markdown_keeps_heading_levels_and_paragraphs() {
        let md = html_to_markdown("<h1>总览</h1><h3>细节</h3><p>正文一</p><p>正文二</p>", 1000);
        assert!(md.contains("# 总览"), "实际：{}", md);
        assert!(md.contains("### 细节"), "实际：{}", md);
        assert!(md.contains("正文一"));
        assert!(md.contains("正文二"));
        // 段落之间留空行，避免粘成一坨
        assert!(md.contains("正文一\n\n正文二"), "实际：{}", md);
    }

    #[test]
    fn markdown_marks_emphasis_inline_code_and_strikethrough() {
        let md = html_to_markdown(
            "<p>这是<strong>重点</strong>，还有<em>强调</em>与<code>f(x)</code>，以及<del>过时</del></p>",
            1000,
        );
        assert!(md.contains("**重点**"), "实际：{}", md);
        assert!(md.contains("*强调*"), "实际：{}", md);
        assert!(md.contains("`f(x)`"), "实际：{}", md);
        assert!(md.contains("~~过时~~"), "实际：{}", md);
    }

    #[test]
    fn markdown_keeps_lists_with_markers() {
        let md = html_to_markdown("<ul><li>甲</li><li>乙</li></ul><ol><li>第一</li><li>第二</li></ol>", 1000);
        assert!(md.contains("- 甲"), "实际：{}", md);
        assert!(md.contains("- 乙"), "实际：{}", md);
        assert!(md.contains("1. 第一"), "实际：{}", md);
        assert!(md.contains("2. 第二"), "实际：{}", md);
    }

    #[test]
    fn markdown_code_block_is_verbatim_and_entity_decoded() {
        // 代码里出现 '<' 不能被当成标签；语法高亮的 span 要被剥掉
        let md = html_to_markdown(
            "<p>示例：</p><pre><span class=\"k\">const</span> a = 1 &lt; 2;\nif (a &amp;&amp; b) {}</pre>",
            1000,
        );
        assert!(md.contains("```"), "实际：{}", md);
        assert!(md.contains("const a = 1 < 2;"), "实际：{}", md);
        assert!(md.contains("if (a && b) {}"), "实际：{}", md);
        assert!(!md.contains("<span"), "实际：{}", md);
    }

    #[test]
    fn markdown_quotes_get_prefix() {
        let md = html_to_markdown("<blockquote><p>引用的话</p></blockquote><p>后面</p>", 1000);
        assert!(md.contains("> 引用的话"), "实际：{}", md);
    }

    #[test]
    fn markdown_links_only_for_absolute_http() {
        let md = html_to_markdown(
            "<p><a href=\"https://example.com/x\">外链</a> 与 <a href=\"/rel\">相对链接</a> 与 <a href=\"javascript:alert(1)\">坏链接</a></p>",
            1000,
        );
        assert!(md.contains("[外链](https://example.com/x)"), "实际：{}", md);
        assert!(md.contains("相对链接") && !md.contains("](/rel)"), "实际：{}", md);
        assert!(!md.contains("javascript:"), "实际：{}", md);
    }

    #[test]
    fn markdown_drops_scripts_styles_and_truncates_on_char_boundary() {
        let md = html_to_markdown(
            "<head><style>.a{}</style></head><script>var x = 1;</script><p>保留</p>",
            1000,
        );
        assert!(md.contains("保留"));
        assert!(!md.contains("var x"));
        assert!(!md.contains(".a{"));

        let long = format!("<p>{}</p>", "中文重点".repeat(50));
        let clipped = html_to_markdown(&long, 10);
        assert_eq!(clipped.chars().count(), 10);
    }
}

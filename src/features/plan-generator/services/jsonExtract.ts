// src/features/plan-generator/services/jsonExtract.ts
// 容错的 LLM JSON 解析：模型常返回代码块、前后解释文字、尾随逗号。
// 所有阶段（澄清/关键词/计划）共用，保证解析失败时能安全降级。

/** 去掉代码块围栏，截取第一个 { 到最后一个 } */
export function extractJsonText(text: string): string {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('未找到 JSON 对象');
  return cleaned.slice(start, end + 1);
}

/** 移除对象/数组末尾的多余逗号（模型常见错误） */
function stripTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1');
}

/** 解析为对象；失败时抛错（调用方负责降级） */
export function extractJsonObject<T = Record<string, unknown>>(text: string): T {
  const jsonText = extractJsonText(text);
  const attempts = [jsonText, stripTrailingCommas(jsonText)];
  let lastErr: unknown;
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as T;
      lastErr = new Error('JSON 根节点不是对象');
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`JSON 解析失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** 安全取字符串数组（过滤空值、夹紧长度与条数） */
export function asStringArray(value: unknown, maxItems = 8, maxLen = 120): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, maxItems)
    .map((v) => v.slice(0, maxLen));
}

/** 安全取非空字符串 */
export function asString(value: unknown, maxLen = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

/** 安全取数字并夹紧 */
export function asNumber(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

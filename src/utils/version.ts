// src/utils/version.ts
// 语义化版本比较的**唯一**实现。
// 此前 parser/validator.ts、plugins/builtin/index.ts、components/plugins/PluginListItem.tsx
// 各自维护了一份副本，行为虽一致但容易改漏，统一到这里。
// 忽略 pre-release（`-beta.1`）与 build 元数据（`+build`），与插件清单校验器语义保持一致。
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('-')[0]
      .split('+')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

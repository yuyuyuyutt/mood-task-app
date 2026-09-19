// src/utils/__tests__/version.test.ts
import { describe, expect, it } from 'vitest';
import { compareVersions } from '../version';

describe('compareVersions', () => {
  it('按段比较主版本号', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('长度不一致时短版本按 0 补齐', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });

  it('忽略 pre-release 与 build 元数据', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0+build.7', '1.0.0')).toBe(0);
  });

  it('非法段按 0 处理，不抛异常', () => {
    expect(compareVersions('1.x.0', '1.0.1')).toBe(-1);
    expect(compareVersions('', '0.0.0')).toBe(0);
  });
});

#!/usr/bin/env node
/**
 * 版本号同步脚本。
 * 唯一真源：src-tauri/tauri.conf.json 的 version 字段（安装包版本以它为准）。
 *
 * 用法：
 *   node scripts/sync-version.mjs          # 把真源版本写到 package.json / src-tauri/Cargo.toml
 *   node scripts/sync-version.mjs --check  # 只校验（CI 用），不一致则退出码 1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'src-tauri/tauri.conf.json';

/** 需要与真源保持一致的版本号声明位置 */
const TARGETS = [
  { file: 'package.json', pattern: /^(\s*"version"\s*:\s*)"([^"]*)"/m },
  { file: 'src-tauri/Cargo.toml', pattern: /^(version\s*=\s*)"([^"]*)"/m },
];

const sourceVersion = JSON.parse(fs.readFileSync(path.join(root, SOURCE), 'utf8')).version;
if (!sourceVersion) {
  console.error(`✗ ${SOURCE} 缺少 version 字段`);
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
let mismatched = 0;

for (const { file, pattern } of TARGETS) {
  const abs = path.join(root, file);
  const text = fs.readFileSync(abs, 'utf8');
  const match = pattern.exec(text);
  if (!match) {
    console.error(`✗ ${file}: 未找到 version 字段`);
    mismatched += 1;
    continue;
  }
  const current = match[2];
  if (current === sourceVersion) {
    console.log(`✓ ${file}: ${current}`);
    continue;
  }
  if (checkOnly) {
    console.error(`✗ ${file}: ${current}（真源 ${SOURCE} 为 ${sourceVersion}）`);
    mismatched += 1;
    continue;
  }
  fs.writeFileSync(abs, text.replace(pattern, `$1"${sourceVersion}"`), 'utf8');
  console.log(`↑ ${file}: ${current} -> ${sourceVersion}`);
}

if (mismatched > 0) {
  console.error(`版本号不一致（真源 ${SOURCE} = ${sourceVersion}）。执行 npm run version:sync 修复。`);
  process.exit(1);
}
console.log(`版本号一致：${sourceVersion}`);

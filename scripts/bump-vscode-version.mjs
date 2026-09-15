/**
 * 发布流程辅助：若 `changeset version` 未触及 packages/vscode（changesets
 * 不管理扩展包），对其 patch 版本 +1。版本进 Version Packages PR，随合并
 * 持久化 —— 下次发布从新基线继续递增，vsce 不再 "already exists"。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkgPath = 'packages/vscode/package.json';

// changeset version 已改过该文件（未来若扩展纳入 changesets）则跳过。
const changed = execSync(`git diff --name-only HEAD -- ${pkgPath}`, { encoding: 'utf8' }).trim();
if (changed !== '') {
  console.log('[bump-vscode-version] packages/vscode already modified by changeset version; skipping');
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[bump-vscode-version] nudo-vscode ${pkg.version} (patch +1)`);

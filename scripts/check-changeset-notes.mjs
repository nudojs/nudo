/**
 * Changeset 标注口径门禁（2026-11-05 产品裁决的回归钉）。
 *
 *   pnpm run check:release-notes
 *   pnpm run check:release-notes -- --allow-breaking
 *
 * 裁决：本批（Abs.facets / HARVEST_DISK_ABI v15 / 生成器身份校验器收紧）
 * **整批不判定为 breaking 变更** ⇒ `.changeset/*.md` 不得出现
 * `**BREAKING**:` 前缀或 `Migration:` 标题；兼容性注意点写成「兼容性：」。
 * 发布级别仍为 minor（见 docs/versioning.md 的「当前例外」）。
 *
 * 未来真有 breaking 时：先在 docs/versioning.md 更新例外并写明迁移要求，
 * 再给本脚本传 `--allow-breaking`（CI 的 lint:hygiene 默认不给）⇒ 裁决变更
 * 必须是一次显式动作，不会因为手写 changeset 悄悄回退口径。
 *
 * 顺带把 bump 类型打出来，便于 `changeset version` 前核对合并结果
 * （同包多个 changeset 取最高级别，patch 不会把 minor 拉低）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repoRoot, ".changeset");
const allowBreaking = process.argv.includes("--allow-breaking");
const BUMP = /^\s*['"]?([^'":]+)['"]?\s*:\s*['"]?(major|minor|patch|premajor|preminor|prepatch|prerelease)['"]?\s*$/i;
const BREAKING = /^\s*\*\*BREAKING\*\*\s*:/m;
const MIGRATION = /^\s*Migration(?:\s*\([^)]*\))?\s*[:：]/m;

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
  .sort();
let violations = 0;

for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8");
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  const frontmatter = end > 0 ? lines.slice(1, end) : [];
  const body = end > 0 ? lines.slice(end + 1).join("\n") : text;
  const bumps = [];
  for (const line of frontmatter) {
    const m = BUMP.exec(line);
    if (m) bumps.push(`${m[1]}=${m[2].toLowerCase()}`);
  }
  const breaking = BREAKING.test(body) || MIGRATION.test(body);
  if (breaking) violations++;
  const notes = breaking ? "BREAKING/Migration 标注" : "no-breaking-notes";
  const flag = breaking && !allowBreaking ? "FAIL" : "ok  ";
  console.log(`${flag} ${file.padEnd(44)} ${(bumps.join(", ") || "(no frontmatter)").padEnd(52)} ${notes}`);
}

if (files.length === 0) {
  console.log("ok: no pending changesets");
  process.exit(0);
}
if (violations > 0 && !allowBreaking) {
  console.error(
    `\n${violations} changeset(s) still carry BREAKING / Migration 标注 —— ` +
      `与 2026-11-05「整批不判定为 breaking」裁决冲突。` +
      `\n如确需 breaking：先更新 docs/versioning.md，再显式传 --allow-breaking。`,
  );
  process.exit(1);
}
if (violations > 0) {
  console.log(`note: --allow-breaking 已放行 ${violations} 条标注（请确认 docs/versioning.md 同步）`);
}
console.log(`ok: ${files.length} changeset(s) 标注口径一致`);

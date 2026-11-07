/**
 * 共享 tmp 脚手架（nudojs 测试面）：与 service `__tests__/tmp-project.ts`
 * 同口径 —— 独立 mkdtemp 目录 + 模块级 afterAll 清理，可带初始文件映射。
 *
 * 禁止在各测试文件里重新实现；需要固定 prefix 的薄适配可以保留一层，但
 * mkdtempSync / rmSync 只能出现在这里（scripts/check-hygiene.mjs 会兜住）。
 */
import { afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

export type TmpFiles = Record<string, string>;

export function writeTmpFiles(dir: string, files: TmpFiles): void {
  for (const [rel, content] of Object.entries(files)) writeTmpFile(dir, rel, content);
}

export function writeTmpFile(dir: string, rel: string, content: string): string {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
  return target;
}

export function tmpProject(prefix: string, files?: TmpFiles): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  if (files) writeTmpFiles(dir, files);
  return dir;
}

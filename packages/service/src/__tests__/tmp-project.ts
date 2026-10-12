/**
 * 共享 tmp 脚手架：消化 service 测试里三种手写临时目录风格——
 * dirs.push + afterAll rmSync / try-finally rmSync / beforeAll 根目录。
 *
 * - tmpProject(prefix, files?)：每次调用独立 mkdtemp 目录，注册进模块级
 *   afterAll 统一 rmSync 清理（可带初始文件映射，嵌套路径自动 mkdir）。
 * - withTmpProject(prefix, files?, fn)：内联 try/finally 立即清理，清理
 *   时机与原 try/finally 风格完全一致。
 * - writeTmpFiles / writeTmpFile：目录创建后按映射/单文件写入。
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

/** 向目录写入文件映射（嵌套路径自动 mkdir -p，utf-8）。 */
export function writeTmpFiles(dir: string, files: TmpFiles): void {
  for (const [rel, content] of Object.entries(files)) writeTmpFile(dir, rel, content);
}

/** 写入单个文件（嵌套路径自动 mkdir -p，utf-8），返回完整路径。 */
export function writeTmpFile(dir: string, rel: string, content: string): string {
  const target = join(dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
  return target;
}

/**
 * 独立 mkdtemp 临时目录（可带初始文件），模块级 afterAll 统一 rmSync 清理。
 * 等价于手写 `const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir);`
 * + 文件级 afterAll 循环 rmSync。
 */
export function tmpProject(prefix: string, files?: TmpFiles): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  if (files) writeTmpFiles(dir, files);
  return dir;
}

/**
 * try/finally 内联清理版本：mkdtemp（可带初始文件）→ fn(dir) → finally 立即
 * rmSync。需要保持逐测试清理时机的用例用这个。
 */
export function withTmpProject<T>(prefix: string, fn: (dir: string) => T): T;
export function withTmpProject<T>(prefix: string, files: TmpFiles, fn: (dir: string) => T): T;
export function withTmpProject<T>(
  prefix: string,
  filesOrFn: TmpFiles | ((dir: string) => T),
  fn?: (dir: string) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    if (typeof filesOrFn === "function") return filesOrFn(dir);
    if (filesOrFn) writeTmpFiles(dir, filesOrFn);
    return fn!(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

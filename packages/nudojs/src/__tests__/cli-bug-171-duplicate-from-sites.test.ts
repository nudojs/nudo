/**
 * BUG-171 回归：同一个 `--from` 路径给两次不是两个现场。
 *
 * 改前 `collectExternalRecords` 逐项处理、不去重 ⇒ 同一路径登记两次错误、
 * 跑两次求值探针，human 面还把同一文件说成「2 usage-site files」。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectExternalRecords } from "../commands/shared.ts";
import type { PathError } from "@nudojs/service";



/** 独立临时目录（模块级 afterAll 清理）。 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tmpProject(prefix: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  return dir;
}

describe("BUG-171 — --from 路径去重", () => {
  it("同一缺失路径给两次 ⇒ 只登记一条错误", () => {
    const dir = tmpProject("nudo-171-");
    const missing = join(dir, "nope.js");
    const sink: PathError[] = [];
    collectExternalRecords([missing, missing], sink);
    expect(sink).toHaveLength(1);
  });

  it("同一现场文件给两次 ⇒ 记录不重复（按调用点身份各一条）", () => {
    const dir = tmpProject("nudo-171-dup-", {
      "site.js": 'import { f } from "./lib.js";\nexport const v = f(1);\n',
      "lib.js": "export function f(a) { return a + 1; }\n",
    });
    const site = join(dir, "site.js");
    const once = collectExternalRecords([site], []);
    const twice = collectExternalRecords([site, site], []);
    expect(twice?.length ?? 0).toBe(once?.length ?? 0);
  });
});

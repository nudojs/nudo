/**
 * BUG-036：`nudo health` 的见证身份把「不同现场文件里的**同号**调用点」折叠成
 * 一个（`call@a.js:L2` 与 `call@b.js:L2` 都归一成 `call@L2`）⇒ **调用点被删除**
 * 这种最典型的漂移完全看不见（「调用被挪走抓得住、调用被删掉抓不住」）。
 *
 * 修复：见证身份 = **现场 + 行号**；「命名方案归一」（`call@<site>:L<n>` vs
 * `call@L<n>`）只在一侧带现场、另一侧不带时成立。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string): string => join(dir, f);

/** 两条已冻结的见证：同一行号、**两个不同**现场文件 */
const LIB = `/**
 * @nudo:case "call@a.js:L2" ("Hello World")
 * @nudo:case "call@b.js:L2" ("Goodbye World")
 */
export function slugify(s) {
  return String(s).trim().toLowerCase();
}
`;

const A_CALL = `import { slugify } from "./lib.js";
slugify("Hello World");
`;

const B_CALL = `import { slugify } from "./lib.js";
slugify("Goodbye World");
`;

/** b.js 的调用点已被**删除**（同一行号上只剩一个类型探针） */
const B_DELETED = `import { slugify } from "./lib.js";
console.log(typeof slugify);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-036-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("a.js"), A_CALL);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-036: 见证身份必须保留现场组件（同号不同现场 ≠ 同一调用点）", () => {
  it("另一现场文件的调用点被**删除** ⇒ 报 drift + exit 1（旧行为：0 drift / OK / exit 0）", () => {
    writeFileSync(p("b.js"), B_DELETED);
    const r = runCliTsx(["health", p("lib.js"), "--from", p("a.js"), p("b.js")], { cwd: dir });
    // 删除类漂移必须可见（旧口径：newKeys 里 `call@L2` 命中 ⇒ removed = 0）
    expect(r.stdout, r.stdout).toContain("drift:");
    expect(r.stdout).toMatch(/-1 removed\)/);
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.status).toBe(1);
  }, 60_000);

  it("对照组：两个现场文件的调用点都在 ⇒ 0 case drift / exit 0", () => {
    writeFileSync(p("b.js"), B_CALL);
    const r = runCliTsx(["health", p("lib.js"), "--from", p("a.js"), p("b.js")], { cwd: dir });
    expect(r.stdout, r.stdout).toContain("0 case drift");
    expect(r.stdout).not.toContain("drift:");
    expect(r.status).toBe(0);
  }, 60_000);
});

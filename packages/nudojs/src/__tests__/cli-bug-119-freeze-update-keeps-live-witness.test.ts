/**
 * BUG-119（CLI 面）：`nudo test --freeze=update` **静默删除**一条**仍然活着**的
 * 见证（`call@site.js:L2`），删除汇总还谎报「0 directive(s)」，事后 health 转绿
 * （假绿）；而 `nudo health --from` 推荐的刷新动作正是这个破坏动作。
 *
 * 契约：
 * - update 后**仍活着**的调用点见证一条都不少（剥离 → 重算 → 回写往返闭合）；
 * - 真的发生删除时，汇总如实报出条数与名字（不再印「0 directive(s)」）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliTsx } from "./helpers/run-cli.ts";

// ⚠ cwd 必须留在 repo 根：tsx 按 **cwd** 找 tsconfig 的 paths 别名；
// cwd 指向临时目录 ⇒ `@nudojs/service/emit` 落回 package.json exports 的
// **dist**（陈旧产物）⇒ 测试验的不是本次源码。路径一律用绝对路径。

const LIB = `/**
 * @nudo:case "call@site.js:L2" (5, 6)
 * @nudo:case "mine" (3, 4) => 7
 */
export function add(a, b) { return a + b; }
`;

const SITE = `import { add } from "./lib.js";
const r = add(5, 6);
console.log(r);
`;

function project(libSource = LIB): { dir: string; lib: string; site: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-119-cli-"));
  writeFileSync(join(dir, "lib.js"), libSource, "utf-8");
  writeFileSync(join(dir, "site.js"), SITE, "utf-8");
  return { dir, lib: join(dir, "lib.js"), site: join(dir, "site.js") };
}

describe("BUG-119（CLI）— update 不得净删除活着的见证", () => {
  it("update 后仍活着的见证一条都不少（旧行为：静默删除 call@site.js:L2）", () => {
    const { dir, lib, site } = project();
    try {
      const dry = runCliTsx(["test", lib, "--from", site, "--freeze=update", "--dry-run"]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("freeze: no changes.");
      // 旧行为：diff 里删掉 `call@site.js:L2`
      expect(dry.stdout).not.toContain("- * @nudo:case \"call@site.js:L2\"");

      const upd = runCliTsx(["test", lib, "--from", site, "--freeze=update"]);
      expect(upd.status, upd.stderr).toBe(0);
      const after = readFileSync(lib, "utf-8");
      expect(after).toBe(LIB);
      expect(after).toContain('@nudo:case "call@site.js:L2" (5, 6)');
      expect(after).toContain('@nudo:case "mine" (3, 4) => 7');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health 推荐的刷新动作不再是破坏动作：照做一遍见证一条不少", () => {
    const { dir, lib, site } = project();
    try {
      const h = runCliTsx(["health", lib, "--from", site]);
      // health 可能仍报 drift（drift 口径是既有实现，本条只修「照做即丢证据」）
      expect(h.stdout).toMatch(/Result: (OK|FAIL)/);
      const upd = runCliTsx(["test", lib, "--from", site, "--freeze=update"]);
      expect(upd.stdout).toContain("freeze: no changes.");
      // 旧行为：这一步删掉 call@site.js:L2（不可恢复）⇒ 事后 health 转绿（假绿）
      expect(readFileSync(lib, "utf-8")).toBe(LIB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("真的删除时不谎报：汇总报出条数与被删见证名（旧行为：「0 directive(s)」）", () => {
    // 该块**没有**手写 case ⇒ update 照常重同步：陈旧见证（行号已漂）被改写
    const { dir, lib } = project(`/**
 * @nudo:case "call@L1" (1, 2)
 */
export function add(a, b) { return a + b; }
add(3, 4);
`);
    try {
      const upd = runCliTsx(["test", lib, "--freeze=update"]);
      expect(upd.status, upd.stderr).toBe(0);
      const after = readFileSync(lib, "utf-8");
      expect(after).toContain("call@L5");
      // 旧行为：只数新写出的条数 ⇒ 净删除被印成「0 directive(s)」/完全不出现在汇总里
      expect(upd.stdout).toContain("removed");
      expect(upd.stdout).toContain("call@L1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

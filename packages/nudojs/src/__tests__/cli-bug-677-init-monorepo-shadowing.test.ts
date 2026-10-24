/**
 * Bug 677 — `nudo init` 在 monorepo 子包写 `nudo` 键 ⇒ **遮蔽**仓库根配置，
 * 门禁由红翻绿（假绿）。
 *
 * 加载器的查找口径（packages/service/src/evaluator/config.ts）：取「最近的、
 * **含 nudo 键**的 package.json」⇒ 子包一旦有了自己的 `nudo` 键，根配置
 * 整段不可见（文档 packages/website/docs/reference/config.md:10 承诺根配置
 * 对「无自有 nudo 键」的子包保持可见）。
 *
 * 改前：`nudo init packages/foo` 静默写入 `nudo` 键 ⇒ 根的 strict 档消失、
 * L2 由 error 变 warning ⇒ 红的 CI 门禁被**静默**解除。
 * 改后：祖先已有可继承的 nudo 配置 ⇒ **拒绝写遮蔽键**（error:/fix: 引导 +
 * exit 1），根配置继续生效。
 *
 * 反向闸：换回 HEAD 只读副本 ⇒ 「init exit=1」「子包 package.json 未被写」
 * 「check 仍然 exit 1」三条断言**必红**（HEAD 写入子包 ⇒ check 变 exit 0）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../commands/init.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** monorepo：根有 strict nudo 配置，子包没有 nudo 键 */
function monoRepo(): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-677-"));
  dirs.push(root);
  const sub = join(root, "packages", "foo");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{ "name": "root", "nudo": { "check": { "profile": "strict" }, "env": ["node"] } }\n',
    "utf-8",
  );
  writeFileSync(join(sub, "package.json"), '{ "name": "foo" }\n', "utf-8");
  writeFileSync(join(sub, "a.js"), "export function getName(user){ return user.name; }\n", "utf-8");
  return { root, sub };
}

describe("Bug 677 — init 不得用 nudo 键遮蔽祖先配置", () => {
  it("祖先有 nudo 配置 ⇒ init 拒绝写盘（exit 1）且子包 package.json 逐字不变", () => {
    const { sub } = monoRepo();
    const before = readFileSync(join(sub, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(sub, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("error:");
    expect(errors.join("\n")).toContain("inherits a nudo config from");
    expect(errors.join("\n")).toContain("fix:");
  });

  it("拒绝之后根配置仍然生效（门禁不翻绿）：nudo check 仍然 exit 1", { timeout: 30_000 }, () => {
    const { sub } = monoRepo();
    const before = runCliTsx(["check", join(sub, "a.js")]);
    expect(before.status, before.stderr).toBe(1);
    const init = runCliTsx(["init", sub]);
    expect(init.status, init.stderr).toBe(1);
    const after = runCliTsx(["check", join(sub, "a.js")]);
    expect(after.status, after.stderr).toBe(1);
    expect(after.stdout).toContain("nudo:entry-may-throw");
  });

  it("没有祖先配置时 init 照常写基线（不得过度拦截）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-677-ok-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), '{ "name": "solo" }\n', "utf-8");
    expect(runInit(dir, { out: () => {}, err: () => {} })).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  });
});

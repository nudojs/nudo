/**
 * Bug 1144 —— `nudo init` 的「祖先配置继承」口径必须与**配置加载器**一致，
 * 且不得死锁。
 *
 * 加载器真源（`packages/service/src/evaluator/config.ts` 的
 * `findProjectConfig`）：从目标目录向上找**最近的、含 `nudo` 键**的
 * package.json；键存在即**截断**祖先搜索（#936）——
 * - 键存在且形状**有效** ⇒ 用它（= 继承成功）；
 * - 键存在但形状**非法**（null / 标量 / 数组）⇒ stderr 提示后按
 *   「无配置」处理，并**不继承**祖先配置（fail-closed）。
 *
 * 旧行为（`packages/nudojs/src/commands/init.ts` 的 `runInit`）：**无论**本包
 * 有没有 `nudo` 键，都调用 `findInheritableAncestorConfig`；祖先有**有效**
 * `nudo` 配置时一律以「it inherits a nudo config from …」拒绝写盘。
 * ⇒ 本包的 `nudo` 值**形状非法** + 祖先有有效配置时：
 *   - 加载器**不继承**祖先（假话：「it inherits」）；
 *   - init 又以「遮蔽祖先」为由拒绝写盘 ⇒ **死锁**：文档承诺
 *     「无效值以基线替换并告警」，实现却拒绝 ⇒ 用户无法自行修复该值。
 *
 * 新行为：只有「本包**没有** `nudo` 键」（= 祖先配置真的会被继承）时，
 * 才用「it inherits」当拒绝理由；本包已有 `nudo` 键但形状非法 ⇒ 按文档
 * **以基线替换并告警**（加载器本来就不继承祖先，不存在遮蔽）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfig } from "@nudojs/service";
import { runInit } from "../commands/init.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 祖先（容器根）有**有效** nudo 配置；子包的 nudo 值形状非法 */
function ancestorWithInvalidChild(): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-"));
  dirs.push(root);
  const sub = join(root, "pkg");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    '{ "name": "root", "nudo": { "check": { "profile": "strict" } } }\n',
    "utf-8",
  );
  writeFileSync(join(sub, "package.json"), '{ "name": "pkg", "nudo": "oops" }\n', "utf-8");
  return { root, sub };
}

describe("Bug 1144 —— init 的祖先继承口径 = 加载器口径（不得死锁）", () => {
  it("加载器口径：本包 nudo 键形状非法 ⇒ **不继承**祖先配置（fail-closed）", () => {
    const { sub } = ancestorWithInvalidChild();
    // 加载器：本包的 nudo 键存在 ⇒ 截断祖先搜索 ⇒ 无配置
    expect(findProjectConfig(sub)).toBeNull();
  });

  it("死锁回归：无效 nudo 值 + 祖先有有效配置 ⇒ 以基线替换并告警（不得拒绝）", () => {
    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(sub, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
    expect(errors.join("\n")).toContain("replaced with the adoption baseline");
  });

  it("死锁回归：拒绝信息不得谎称「it inherits」（加载器并不继承）", () => {
    const { sub } = ancestorWithInvalidChild();
    const errors: string[] = [];
    runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(errors.join("\n")).not.toContain("it inherits a nudo config from");
  });

  it("反向闸：本包**没有** nudo 键 + 祖先有有效配置 ⇒ 仍拒绝遮蔽（loader 口径）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-shadow-"));
    dirs.push(root);
    const sub = join(root, "pkg");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      '{ "name": "root", "nudo": { "check": { "profile": "strict" } } }\n',
      "utf-8",
    );
    writeFileSync(join(sub, "package.json"), '{ "name": "pkg" }\n', "utf-8");
    // 加载器口径：本包无 nudo 键 ⇒ 向上找 ⇒ 继承祖先
    expect(findProjectConfig(sub)?.config?.check?.profile).toBe("strict");
    const before = readFileSync(join(sub, "package.json"), "utf-8");
    const errors: string[] = [];
    const code = runInit(sub, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(sub, "package.json"), "utf-8")).toBe(before);
    // 拒绝理由与加载器口径一致（确实继承）
    expect(errors.join("\n")).toContain("it inherits a nudo config from");
  });

  it("显式 init <容器根>：写盘 + 作用域告警（不越界）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-container-"));
    dirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
    const pkg = join(root, "packages", "foo");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{ "name": "foo" }\n', "utf-8");
    const errors: string[] = [];
    const code = runInit(root, { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
    // 作用域必须说清（nudo 键对下层所有包生效）
    expect(errors.join("\n")).toContain("workspace / container root");
  });

  it("从容器根的子目录 init：拒绝越界写盘（exit 1）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cli-1144-cross-"));
    dirs.push(root);
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
    writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
    const pkg = join(root, "packages", "foo");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{ "name": "foo" }\n', "utf-8");
    const before = readFileSync(join(root, "package.json"), "utf-8");
    const errors: string[] = [];
    // 从容器根的**子目录**发起 ⇒ 最近 package.json 是容器根 ⇒ 越界 ⇒ 拒绝
    const code = runInit(join(root, "packages"), { out: () => {}, err: (l) => errors.push(l) });
    expect(code).toBe(1);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(before);
    expect(errors.join("\n")).toContain("workspace / container root");
  });
});

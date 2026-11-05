/**
 * Bug 593 — `nudo migrate verify` 的**分析注入**缺失（无模块图 / 无 mock）⇒ 与
 * `nudo check` **判相反**（两个方向都相反）：
 *
 * - 方向 A（跨模块 ⇒ **假绿**）：被调函数的 throws 面不传播给调用点 ⇒
 *   `nudo check` 判红（entry-may-throw），verify 判绿 ⇒ 迁移闸门放行了 CI 门禁
 *   拒绝的文件 ⇒ `retire` 会在 check 仍红的情况下把 tsc 退役。
 * - 方向 B（`@nudo:mock` ⇒ **假红** + 误导诊断）：verify 侧不施加 mock ⇒
 *   helper 未定义 ⇒ 报「may throw ReferenceError」，cause 文案把用户引向
 *   「你用了 `export { x } from` 重导出写法」——照着改永远不会好。
 *
 * 根因：`migrateVerify` 的 `checkSource` 调用既不传 `modules` 也不传 `inject`
 * （对照 `packages/nudojs/src/commands/check.ts` 的 `{ modules, inject }`）。
 *
 * 判据（闸②）：`migrate verify` 与 `nudo check` 对同一份源码给出**同一结论**。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const root = join(tmpdir(), `nudo-migrate-593-${process.pid}`);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(repoRoot, "tmp", `nudo-migrate-593-env-${process.pid}`), {
    recursive: true,
    force: true,
  });
});

/** 方向 A：跨模块调用（dep 的 throws 面应传播给调用点） */
const cross = join(root, "cross");
mkdirSync(cross, { recursive: true });
writeFileSync(
  join(cross, "dep.js"),
  "export function risky(x) {\n  return x.toFixed(2);\n}\n",
  "utf-8",
);
writeFileSync(
  join(cross, "main.js"),
  'import { risky } from "./dep.js";\nexport function entry(a) {\n  return risky(a);\n}\n',
  "utf-8",
);

/** 方向 B：`@nudo:mock`（mock 生效 ⇒ helper 已知 ⇒ 绿） */
const mock = join(root, "mock");
mkdirSync(mock, { recursive: true });
writeFileSync(join(mock, "mock.js"), "export const helper = (a) => a;\n", "utf-8");
writeFileSync(
  join(mock, "mocked.js"),
  '/**\n * @nudo:mock helper from "./mock.js"\n */\nexport function entryMock(a) {\n  return helper(a);\n}\n',
  "utf-8",
);

/** 方向 C：坏 `@nudo:mock`（mock 文件缺失 ⇒ 双方都必须判红） */
const badMock = join(root, "badmock");
mkdirSync(badMock, { recursive: true });
writeFileSync(
  join(badMock, "mocked.js"),
  '/**\n * @nudo:mock dep from "./missing-mock.js"\n * @nudo:throws TypeError\n */\nexport function entryBad(a) {\n  return dep(a);\n}\n',
  "utf-8",
);

/**
 * 方向 D：path 型 `@nudo:env`（env 文件必须满足 defineEnv() 契约）。
 * 夹具放在**仓库内**的 tmp/ 下：env 文件要 `import { strLit } from "@nudojs/core"`
 * ⇒ 必须能解析到工作区包（仓库外的 tmp 目录解析不到）。
 */
const envPath = join(repoRoot, "tmp", `nudo-migrate-593-env-${process.pid}`);
mkdirSync(envPath, { recursive: true });
writeFileSync(
  join(envPath, "env.ts"),
  'import { strLit } from "@nudojs/core";\nexport function defineEnv() {\n  return { globals: { MODE: strLit("on") } };\n}\n',
  "utf-8",
);
writeFileSync(
  join(envPath, "lib.js"),
  "/// @nudo:env ./env.ts\nexport function mode() {\n  return MODE;\n}\n",
  "utf-8",
);

function verdict(args: string[]): { status: number; out: string } {
  const r = runCliTsx(args);
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("migrate verify — 分析注入与 nudo check 同源（Bug 593）", () => {
  it("跨模块：verify 不再假绿（与 check 同判红）", { timeout: 120_000 }, () => {
    const file = join(cross, "main.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(1);
    // 旧行为：verify 判绿（exit 0）⇒ 迁移闸门放行 CI 门禁拒绝的文件
    expect(verify.status).toBe(1);
    expect(verify.out).toContain("FAIL");
  });

  it("@nudo:mock：verify 不再假红（与 check 同判绿）", { timeout: 120_000 }, () => {
    const file = join(mock, "mocked.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(0);
    // 旧行为：verify 判红（mock 没被注入 ⇒ may throw ReferenceError）
    expect(verify.status).toBe(0);
    expect(verify.out).not.toContain("ReferenceError");
  });

  it("path 型 @nudo:env：verify 与 check 同判绿（env 预载必须同口径）", { timeout: 120_000 }, () => {
    const file = join(envPath, "lib.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(0);
    // 旧行为：verify 判红（env 没被预载 ⇒ may throw ReferenceError）
    expect(verify.status).toBe(0);
    expect(verify.out).not.toContain("ReferenceError");
  });

  it("坏 @nudo:mock：verify 与 check 同判红（mock 解析失败必须可见）", { timeout: 120_000 }, () => {
    const file = join(badMock, "mocked.js");
    const check = verdict(["check", file]);
    const verify = verdict(["migrate", "verify", file]);
    expect(check.status).toBe(1);
    expect(verify.status).toBe(1);
  });
});

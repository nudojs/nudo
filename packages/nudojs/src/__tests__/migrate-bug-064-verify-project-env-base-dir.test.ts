/**
 * BUG-064 —— `nudo migrate verify` 把**项目级** `package.json#nudo.env` 的相对
 * 路径按「被检文件所在目录」解析 ⇒ 子目录里的文件**永远拿不到**项目级 env
 * ⇒ 误报红（`may throw ReferenceError`），而 `nudo check` 判绿。
 *
 * 既定契约（Bug 647）：**项目级** path env 按**项目根**解析；**文件级**
 * `@nudo:env` 才按被分析文件所在目录解析。
 *
 * 修复：verify 侧照抄 check 的分层口径（项目级按 `proj.projectDir` 绝对化 +
 * 文件级按 `dirname(file)`），并把 env 加载失败并入报告（`nudo:env-unresolved`）。
 *
 * 反向闸：文件级 `@nudo:env` 仍按文件目录解析（Bug 593 口径不变）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateVerify } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENV_SRC = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

function project(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-064-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "envp",
      version: "1.0.0",
      type: "module",
      nudo: { env: ["./env/web.ts"] },
    }),
    "utf-8",
  );
  mkdirSync(join(root, "env"), { recursive: true });
  writeFileSync(join(root, "env", "web.ts"), ENV_SRC, "utf-8");
  mkdirSync(join(root, "src"), { recursive: true });
  const file = join(root, "src", "lib.js");
  writeFileSync(file, "export function magic() {\n  return MAGIC;\n}\n", "utf-8");
  return { root, file };
}

describe("Bug 064: 项目级 path env 必须按项目根解析（与 nudo check 同口径）", () => {
  it("子目录文件拿得到项目级 env 全局 ⇒ verify 判绿", async () => {
    const { file } = project();
    const rows = await migrateVerify([file], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：文件级 @nudo:env 仍按**文件目录**解析", async () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-064-file-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "envpf", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    mkdirSync(join(root, "src", "env"), { recursive: true });
    writeFileSync(join(root, "src", "env", "web.ts"), ENV_SRC, "utf-8");
    const file = join(root, "src", "lib.js");
    writeFileSync(
      file,
      '/// @nudo:env ./env/web.ts\nexport function magic() {\n  return MAGIC;\n}\n',
      "utf-8",
    );
    const rows = await migrateVerify([file], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});

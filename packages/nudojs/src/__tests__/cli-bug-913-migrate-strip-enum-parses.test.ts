/**
 * Bug 913 —— TS 的 `enum` 被整段删除 ⇒ 成员引用退化成**未绑定全局**读取 ⇒
 * 门禁报 error 级 `nudo:entry-may-throw`（**假红**）+ dts / zod / standard /
 * guard 四个产物面把返回类型落成 `never`。
 *
 * **真源**：`packages/core/src/strip-types.ts`（把 TS enum **合成成运行时
 * 对象**，逐形态对齐 tsc 的 emit）。本钉是**产物面**的回归钉：
 * ① 产物必须是可加载的运行时对象（不是空模块）；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**都绿**，签名都是 `f() => 1`
 *    （不再是 `never` + ReferenceError 的假红）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENUM_TS = `export enum E { A = 1 }
export function f() {
  return E.A;
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 真 ESM 加载并读 enum 成员（运行时语义面） */
function esmReadEnum(path: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(`file://${path}`)}).then(m=>console.log("VALUE:", m.E.A)).catch(e=>{console.log("LOAD ERROR:", e.constructor.name+":", e.message); process.exitCode=1;});`,
    ],
    { encoding: "utf-8" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("Bug 913 —— TS enum 被合成成运行时对象（产物面 + 门禁行为）", () => {
  it("产物含运行时 enum 对象 ⇒ `node --check` 过且 `E.A === 1`", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "enum.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // enum 不得被整段删除：绑定 `E` 必须**有声明**（只剩引用 `E.A` ⇒ 运行时
    // 未绑定全局读取 ⇒ ReferenceError）
    expect(code).toMatch(/\b(var|const|let)\s+E\b/);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);

    // 运行时语义面：enum 成员必须取得到值（tsc 同口径：E.A === 1）
    const load = esmReadEnum(product);
    expect(load.status, `${load.stdout}\n${load.stderr}`).toBe(0);
    expect(load.stdout).toContain("VALUE: 1");
  });

  it("门禁行为正确：`.ts` 源与 `.js` 产物都绿，签名是 `f() => 1`（不再是 never）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["enum.ts", "enum.js"]) {
      const c = runCliTsx(["check", join(dir, name)]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(0);
      expect(c.stdout).toContain("f() => 1");
      expect(c.stdout).not.toContain("never");
      expect(c.stdout).not.toContain("ReferenceError");
    }
  });
});

/**
 * BUG-075 —— `export --format all` 的 stdout 平铺**跨段去重只认「导出声明」**
 * ⇒ 与 zod 段的 `import { z }` / standard 段的非导出 helper 撞名
 * （TS2440 + `z.object` 被解析到用户自己的 `z` ⇒ **语义串味**）。
 *
 * 修法：去重表登记**每一段的全部顶层标识符**（导出声明 + 非导出声明 + import
 * 绑定）；撞名时**工具让位**（import 绑定改名为别名 `z as zZod`，导出名加方言
 * 后缀），用户导出名恒占。
 *
 * 钉：用户导出 `z` 的模块 ⇒ 平铺产物**能过 `tsc --strict`**（rc 0），且用户的
 * `export declare function z` 仍是原名。
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function z(x) {\n  return x;\n}\nz(1);\n";

/** zod 桩：平铺产物只 import `{ z }`，类型面 any 即可（编译面判的是作用域冲突）。 */
const ZOD_STUB = "export declare const z: any;\n";

describe("BUG-075 — stdout 平铺的顶层标识符互不冲突", () => {
  it("用户导出 `z` + zod 段 import ⇒ 产物可编译（tsc --strict rc 0）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b075-"));
    dirs.push(dir);
    writeFileSync(join(dir, "zname.js"), SRC, "utf-8");
    mkdirSync(join(dir, "node_modules", "zod"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "zod", "index.d.ts"), ZOD_STUB, "utf-8");
    writeFileSync(
      join(dir, "node_modules", "zod", "package.json"),
      '{"name":"zod","version":"0.0.0-stub","types":"index.d.ts","main":"index.js"}\n',
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler","noEmit":true,"skipLibCheck":true}}\n',
      "utf-8",
    );

    const r = runCliTsx(["export", join(dir, "zname.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // 用户的导出名恒占（工具侧让位）
    expect(r.stdout).toContain("export declare function z(x: number): number;");
    writeFileSync(join(dir, "out.ts"), r.stdout, "utf-8");

    const tsc = spawnSync(join(repoRoot, "node_modules/.bin/tsc"), ["-p", join(dir, "tsconfig.json")], {
      cwd: dir,
      encoding: "utf8",
    });
    // 改前：out.ts(4,10) TS2440 + 一片 TS2339（z.object 解析到用户的 z 上）
    expect(`${tsc.stdout}${tsc.stderr}`).not.toContain("TS2440");
    expect(`${tsc.stdout}${tsc.stderr}`).not.toContain("TS2339");
    expect(tsc.status).toBe(0);
  }, 90000);

  it("用户导出 `__nudoCheck`（standard 段的非导出 helper 同名）⇒ 不重复声明", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b075-helper-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "helper.js"),
      "export function __nudoCheck(x) {\n  return x;\n}\n__nudoCheck(1);\n",
      "utf-8",
    );
    const r = runCliTsx(["export", join(dir, "helper.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // helper 在前、用户导出在后 ⇒ 用户侧让位（`Dts` 后缀），helper 只声明一次
    const helperDecls = (r.stdout.match(/^function __nudoCheck\b/gm) ?? []).length;
    expect(helperDecls).toBe(1);
    const nameDecls = (r.stdout.match(/__nudoCheck/g) ?? []).length;
    expect(nameDecls).toBeGreaterThan(1);
    // 没有「同名两份顶层声明」：用户导出被改名后不再与 helper 撞名
    expect(r.stdout).not.toMatch(/^export declare function __nudoCheck\(/m);
  }, 60000);
});

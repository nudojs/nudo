/**
 * BUG-253 回归（harvester 全局面）：顶层「值位置接口声明」的接口成员
 * **不得**提升成全局符号。
 *
 * `export declare const o: Opts;` 里的成员在 TypeScript 中只在 `Opts` 内部
 * 可见（模块外 / 全局作用域根本没有这些名字）。此前 `expandInterfaceAsModuleMembers`
 * 无条件提升进 `p.scope`，顶层声明的 `p.scope` 就是全局作用域 ⇒ 造出
 * TypeScript 判 **TS2304** 的幽灵全局（`@types/lodash` 实测泄漏 60 个方法名，
 * 如 `clone` / `isEqual` / `now`）⇒ nudo 对不存在的名字给出具体类型（假绿）。
 *
 * 口径：提升只对**模块作用域**成立（`@types/node` 24 `path` 形态、
 * lodash `LoDashStatic` 形态都是模块级成员）；全局面只保留 var 本体。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug253-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const TOP_LEVEL = `export interface Opts { x?: number; y: string; }
export declare const o: Opts;
`;

const MODULE_SCOPE = `declare module "m" {
  export interface Opts { x?: number; y: string; }
  export declare const o: Opts;
}
`;

describe("BUG-253 —— 顶层值位置接口声明不得产生幽灵全局", () => {
  it("控制组：单独声明 interface 不产生任何全局（基线）", () => {
    const p = writeTemp("ctl.d.ts", `export interface Opts { x?: number; y: string; }\n`);
    const env = harvestDts([p]);
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  });

  it("顶层 `export declare const o: Opts;` ⇒ 成员不进全局面（修前：x / y 都是全局）", () => {
    const p = writeTemp("top.d.ts", TOP_LEVEL);
    const env = harvestDts([p]);
    // var 本体仍在全局面（default/namespace 消费）
    expect(env.globals.o).toBeDefined();
    // 成员是接口内部名字：全局作用域不存在
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  });

  it("模块作用域的同一形态仍然提升（提升路径本身不被削弱）", () => {
    const p = writeTemp("mod.d.ts", MODULE_SCOPE);
    const env = harvestDts([p]);
    const m = env.modules.m!;
    expect(m).toBeDefined();
    expect(m.x).toBeDefined();
    expect(m.y).toBeDefined();
    // 模块成员不得外溢到全局面
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
  });
});

/**
 * Bug 807 回归（harvester 收割面）：同一个接口方法被收割成**两个不同类型**
 * （brand 成员 vs 模块级提升全局）。
 *
 * 两条收割路径：
 *   - brand 面（`instanceFor`）：接口成员 → brand 槽位；
 *   - 提升面（`expandInterfaceAsModuleMembers`）：接口成员 → 模块级 fn/var。
 * 此前两条路径用了**两套不同的重载合并策略** ⇒ 同一方法、同一份 .d.ts，两个类型。
 *
 * 改前（报告 tmp/probe/r15h/ifmeth.d.ts）：
 *   brand `M.three` = (number) => string            ← 只剩第一个 overload
 *   全局 `three`    = (number) => string | number | boolean
 * 改后：两条路径给出**同一个**形态（返回位并集 / 参数位逐位并集）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o807.ts）：exit=0
 *   ⇒ TS 侧三个 overload 都在契约里（按实参类型选分支）。
 *
 * 泛型接口的补充口径：提升路径**看不到类型实参** ⇒ 提升出来的是未绑定 α，
 * 与 brand 面（实参已代入）不是同一个类型 ⇒ 泛型接口的成员不提升。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug807-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

const OVERLOADS = `declare module "m" {
  export interface M {
    three(a: number): string;
    three(a: string): number;
    three(a: boolean): boolean;
  }
  export declare const m: M;
}
`;

describe("Bug 807 —— 同一接口方法在两条收割路径上必须是同一个类型", () => {
  it("brand 成员与**模块级**提升成员的形态完全一致（BUG-253：提升只对模块作用域成立）", () => {
    const p = writeTemp("ifmeth.d.ts", OVERLOADS);
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.m!).three!;
    const promoted = env.modules.m!.three!;
    expect(promoted).toBeDefined();
    expect(JSON.stringify(promoted.shape)).toBe(JSON.stringify(member.shape));
  });

  it("重载集保留全部返回类型（不是只剩第一个 overload）", () => {
    const p = writeTemp("ifmeth.d.ts", OVERLOADS);
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.m!).three!;
    expect(member.shape.k).toBe("fn");
    if (member.shape.k !== "fn") return;
    const ret = formatShape(member.shape.returnType!);
    expect(ret).toContain("string");
    expect(ret).toContain("number");
    expect(ret).toContain("boolean");
  });

  it("对照：单签名方法两条路径同样一致", () => {
    const p = writeTemp(
      "single.d.ts",
      `declare module "m" {
  export interface S { one(a: number): string; }
  export declare const s: S;
}
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.s!).one!;
    const promoted = env.modules.m!.one!;
    expect(promoted).toBeDefined();
    expect(JSON.stringify(promoted.shape)).toBe(JSON.stringify(member.shape));
    expect(formatShape(member.shape.k === "fn" ? member.shape.returnType! : member)).toBe("string");
  });

  it("泛型接口：brand 面用类型实参（string），提升面不产出未绑定 α", () => {
    const p = writeTemp(
      "gen.d.ts",
      `declare module "m" {
  export interface Box<T> { get(): T; }
  export declare const box: Box<string>;
}
`,
    );
    const env = harvestDts([p]);
    const member = slots(env.modules.m!.box!).get!;
    expect(member.shape.k).toBe("fn");
    if (member.shape.k !== "fn") return;
    // brand 面：T 已被实参 string 代入
    expect(formatShape(member.shape.returnType!)).toBe("string");
    // 提升路径看不到实参 ⇒ 泛型接口的成员不提升（否则两条路径分叉）
    expect(env.modules.m!.get).toBeUndefined();
    expect(env.globals.get).toBeUndefined();
  });
});

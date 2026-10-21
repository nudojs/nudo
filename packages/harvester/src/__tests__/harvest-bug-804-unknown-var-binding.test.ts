/**
 * Bug 804 回归（harvester 收割面）：映射类型 / 模板字面量类型 / 索引访问类型
 * （以及 `keyof` / `typeof`）落 `unknown` 后，**`declare const` 整条绑定被丢弃**
 * ⇒ 用户代码引用它时被判「**确定抛 ReferenceError**」（L2 假红）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/unknown/）：
 * - `declare const mappedLit: { [K in "a" | "b"]: number };` 等在 .d.ts 里是
 *   **运行时存在的全局**（TS 编译通过，exit 0）⇒ 引擎不得判 ReferenceError。
 *
 * 收割侧契约：
 *   1. 类型判不出（退成 `unknown`）时**绑定仍要保留** —— 收割 env 是分析面
 *      唯一的全局事实来源，绑定被删 ⇒ 引擎判决与事实相反；
 *   2. 「类型未建模」是**降级**（值域未知），不是「符号不存在」。
 *
 * 改前（实测）：`globals` 里 m1 / m3 / m4 / m5 / m6 一个都没有，
 * `stats.skipped` 8 → 13（+5 正好是这 5 条）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug804-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const FIXTURE = `export interface Box { a: string; b: number; }
export declare const mappedLit: { [K in "a" | "b"]: number };
export declare const tplStr: \`a\${string}\`;
export declare const idxA: Box["a"];
export declare const keyOfBox: keyof Box;
export declare const typeOfIdx: typeof idxA;
`;

describe("Bug 804 —— 类型判不出时 `declare const` 绑定仍保留（不判 ReferenceError）", () => {
  it("映射类型 / 模板字面量 / 索引访问 / keyof / typeof 的绑定全部保留", () => {
    const p = writeTemp("fx.d.ts", FIXTURE);
    const env = harvestDts([p]);
    for (const name of ["mappedLit", "tplStr", "idxA", "keyOfBox", "typeOfIdx"]) {
      // 反向断言：改前这些绑定整个不在 globals 里 ⇒ 引擎判「确定抛 ReferenceError」
      expect(Object.hasOwn(env.globals, name)).toBe(true);
      expect(env.globals[name]).toBeDefined();
    }
  });

  it("值域未知时退成 unknown（降级，不是符号不存在）", () => {
    const p = writeTemp("fx.d.ts", FIXTURE);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["mappedLit"]!)).toBe("unknown");
    expect(formatShape(env.globals["tplStr"]!)).toBe("unknown");
    expect(formatShape(env.globals["idxA"]!)).toBe("unknown");
  });

  it("可判定的类型不受影响（对照组：仍是确切类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: number;
export declare const named: string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["plain"]!)).toBe("number");
    expect(formatShape(env.globals["named"]!)).toBe("string");
  });

  it("没有类型标注的 `declare const` 也保留绑定", () => {
    const p = writeTemp("fx.d.ts", `export declare const untyped;\n`);
    const env = harvestDts([p]);
    expect(Object.hasOwn(env.globals, "untyped")).toBe(true);
  });
});

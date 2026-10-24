/**
 * Bug 242 产物面回归：`new Intl.Collator('en')` 等**未建模子构造器**返回内部
 * 伪名 brand（`__nudoFnParentN`），该伪名泄漏进产品面产物 ⇒
 * - dts 产物：`export declare function f(): __nudoFnParent1;` —— 伪名是**合法
 *   JS 标识符**却从未声明 ⇒ 消费方 tsc 报 **TS2304**；
 * - schema 产物：`z.instanceof(__nudoFnParent1)` —— 生成模块**import 即崩**
 *   （ReferenceError），整个产物作废。
 *
 * 本文件钉住**产物面**：产物里不得出现内部伪名，也不得引用未声明的绑定；
 * zod 产物必须可求值（import 即用）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Abs } from "@nudojs/core";
import { analyzeFile, resetAllAnalysisCaches } from "../index.ts";
import { generateDts } from "../emit/dts-generator.ts";
import { absToZodSchemaModule } from "../emit/schema-generator.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

const SRC = `export function newCollator() {\n  return new Intl.Collator('en');\n}\n`;

/** 内部伪名（实现细节，不得出现在任何产物面上） */
function isInternalPseudoName(name: string): boolean {
  return /^__nudoFnParent\d*$/.test(name);
}

function newCollatorOutputAbs(): Abs {
  const result = analyzeFile("/t/bug242-intl.js", SRC);
  const fn = result.functions[0]!;
  const out = fn.combinedAbs ?? fn.cases[0]?.abs;
  if (!out) throw new Error("no output abs for Intl fixture");
  return out;
}

/** zod 桩：链式可调用（只为验证「模块求值期不炸」） */
function zodStub(): unknown {
  const stub: unknown = new Proxy(function () {} as unknown as object, {
    get: () => stub,
    apply: () => stub,
  });
  return stub;
}

/** 把 zod 产物当模块求值一次（去 import / export 后 new Function 跑） */
function evaluateZodModule(source: string, exportNames: string[]): { ok: boolean; error?: string } {
  const body =
    source
      .replace(/^import \{ z \} from "zod";$/m, "")
      .replace(/^export const /gm, "const ") + `\nreturn { ${exportNames.join(", ")} };`;
  try {
    new Function("z", body)(zodStub());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

describe("Bug 242 — 产物面不得出现内部伪名 brand（Intl 未建模子构造器）", () => {
  it("引擎侧：实例 brand 名不是内部伪名", () => {
    const out = newCollatorOutputAbs();
    const name = out.shape.k === "brand" ? (out.shape.name ?? "") : "";
    expect(isInternalPseudoName(name)).toBe(false);
  });

  it("dts 产物：不得出现内部伪名（改前：TS2304——伪名从未声明）", () => {
    const dts = generateDts(analyzeFile("/t/bug242-intl.js", SRC));
    expect(dts).not.toMatch(/__nudoFnParent/);
    // 消费方 tsc 不得见到未声明的类型名
    expect(dts).not.toMatch(/:\s*__nudo/);
  });

  it("schema 产物：不得 z.instanceof(内部伪名)（改前：import 即 ReferenceError）", () => {
    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    expect(source).not.toMatch(/__nudoFnParent/);
    expect(source).not.toMatch(/z\.instanceof\(\s*__nudo/);
  });

  it("schema 产物可求值（import 即用——改前 ReferenceError）", () => {
    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    const r = evaluateZodModule(source, ["newCollatorOutput"]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("负控制：产物里的 z.instanceof 实参都是运行时全局构造器", () => {
    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    const names = [...source.matchAll(/z\.instanceof\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const name of names) {
      const v = (globalThis as Record<string, unknown>)[name];
      expect(typeof v, name).toBe("function");
    }
  });
});

/**
 * 生成代码/展示串里的标识符必须安全引用或清洗。
 * 回归背景：z.object({ foo-bar: … }) 非法 JS；export const my-key = … 非法；
 * export function $x(data) 的 $ 在标识符里合法，但 formatShape 对
 * `a, b` / `foo-bar` 这类键裸插会让展示串本身不可解析。
 * dts 的 formatPropKey 已有同口径（JSON 引号），其余生成器漏网。
 */
import { describe, it, expect } from "vitest";
import { abs, num, str, formatShape, obj as objOf } from "@nudojs/core";
import {
  absToSchemaSource,
  absToStandardSchemaModule,
  generateGuardFunctionFromAbs,
} from "@nudojs/service/emit";

function objAbs(slots: Record<string, unknown>) {
  const built: Record<string, { value: unknown }> = {};
  for (const [k, v] of Object.entries(slots)) {
    built[k] = { value: v };
  }
  return abs({ k: "obj", slots: built as never }, undefined, undefined, "exact");
}

describe("generated identifiers / object keys are safely quoted", () => {
  it("zod object keys quote non-identifiers", () => {
    const a = objAbs({
      "foo-bar": num(),
      "a b": str(),
      "123abc": num(),
      ok: str(),
    });
    const src = absToSchemaSource(a);
    expect(src).toContain('"foo-bar"');
    expect(src).toContain('"a b"');
    expect(src).toContain('"123abc"');
    expect(src).toContain("ok:");
    // must not emit unquoted hyphen key
    expect(src).not.toMatch(/\{\s*foo-bar:/);
    expect(src).not.toMatch(/,\s*a b:/);
  });

  it("zod module with hyphenated export name sanitizes the identifier", () => {
    const a = objAbs({ x: num() });
    const mod = absToStandardSchemaModule({ "my-key": a });
    expect(mod.source).toMatch(/export const [A-Za-z_$]/);
    expect(mod.source).not.toContain("export const my-key");
  });

  it("guard function name is a valid identifier", () => {
    const a = objAbs({ x: num() });
    const g = generateGuardFunctionFromAbs("my-guard", a);
    expect(g).toMatch(/export function [A-Za-z_$][\w$]*\(/);
    expect(g).not.toContain("export function my-guard");
  });

  it("formatShape quotes ambiguous object keys", () => {
    const a = objAbs({ "foo-bar": num(), "a, b: 1": str() });
    const s = formatShape(a);
    expect(s).toContain('"foo-bar"');
    // key containing `:` and `,` must not be bare
    expect(s).not.toMatch(/\{\s*a, b: 1:/);
  });

  it("plain identifier keys stay bare", () => {
    const a = objAbs({ a: num(), $x: num(), _y: str() });
    const s = formatShape(a);
    expect(s).toContain("a:");
    expect(s).toContain("$x:");
    expect(s).toContain("_y:");
    expect(absToSchemaSource(a)).toContain("a:");
    expect(absToSchemaSource(a)).toContain("$x:");
  });
});

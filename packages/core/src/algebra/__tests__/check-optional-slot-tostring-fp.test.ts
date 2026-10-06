/**
 * entry-may-throw 误报回归（issue #119）。
 *
 * #119：optional()/nullable() 槽的裸模板插值误报
 * `ToString coercion of abstract operand (Symbol)`，签名折成
 * `=> string throws TypeError`。复现（1.3.10）：
 *   shape({ file: string().optional() }) 下 `${f.file}`
 *   nullable(string()) 下 `${s}`
 * 原生语义：`${undefined}`/`${null}` 输出 "undefined"/"null"（ToString 对
 * nullish 恒 total），只有 Symbol 抛——契约已把槽限为 string|undefined，
 * 不存在 Symbol 可能性。
 *
 * 根因：optional 槽读出 joinAbs(slot, undef)（exec/runtime/containers.ts），
 * nullable() 编码 sum [T, lit(null), lit(undefined)]——nullish 成员是
 * shape k:"unknown" + term lit(null/undefined)（null/undefined 无 prim 名，
 * 见 absShapeKey-null-unknown.test.ts）。arithmetic.ts isMaybeBigintOperand
 * 的 sum 成员递归把这些 total 字面量按 shape.k==="unknown" 连坐成
 * maybe-bigint/Symbol → noteCoercionMayThrow 记假 L2。
 * 修复：isMaybeBigintOperand 排除 lit(null)/lit(undefined) 操作数（顶层 +
 * 递归成员同口径；与 builtins/shared.ts mayCoerceThrowOperand 的「lit 项
 * 恒 total」同原则，但只排 nullish——bigint 字面量保持原判定）。只去
 * may-throw 打点，值域（concatString 等）不变。
 *
 * 对照组（防过修）：无契约 any 参数的 `${x}` 仍报（入口无约束 = any =
 * 诚实 may-throw，既定 policy）；sum 成员含 obj/fn/brand 臂的模板插值
 * 仍报（对象经 @@toPrimitive 确可返 Symbol）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

/** issue 原始 sidecar：string().optional() / number().optional() 槽 + nullable(string()) */
const LIB = `import { shape, string, number, nullable } from "@nudojs/core";
export const fView = shape({ file: string().optional(), line: number().optional() });
export const nullableStr = nullable(string());`;

function check(src: string) {
  return checkSource("/t/optional-slot-tostring-fp.js", src, pTrue, {
    loadModule: (spec) => (spec.endsWith(".nudo.js") ? LIB : undefined),
    fromFile: "/test/file.js",
  });
}

/** L2 entry-may-throw 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

const IMPORT = `/// @nudo:import { fView, nullableStr } from "./std.nudo.js"\n`;

describe("#119 optional()/nullable() 槽模板插值不报 entry-may-throw", () => {
  it("plainTemplate：`${f.file}` 契约 string|undefined 零 L2，签名不 throws", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function plainTemplate(f) { return \`\${f.file}\`; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "plainTemplate")).toBe("string  #path");
    expect(sigOf(r, "plainTemplate")).not.toContain("throws");
  });

  it("nestedTernary：嵌套三元模板（issue 第二形态）零 L2", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function nestedTernary(f) { return f.file ? \`\${f.file}\${f.line ? \`:\${f.line}\` : ''}\` : '-'; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "nestedTernary")).not.toContain("throws");
  });

  it("nullable(string()) 槽同样零 L2（lit(null)+lit(undefined) 双 nullish 成员）", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract s nullableStr
 */
export function nullableTpl(s) { return \`[\${s}]\`; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "nullableTpl")).toBe("string  #path");
  });

  it("`??` 回退形态保持干净（issue 对照组，修复前已干净）", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function fallback(f) { return \`\${f.file ?? '-'}\`; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("同源修复面：number|undefined 槽的关系比较零 L2（ToPrimitive 对 nullish 恒 total）", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function rel(f) { return f.line > 0; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("surface.ts 同口径副本：一元 + / 位运算 |0 对 number|undefined 槽零 L2（ToNumber(null)=0、ToNumber(undefined)=NaN，均 total）", () => {
    const r = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function unaryPlus(f) { return +f.line; }
`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    const r2 = check(`${IMPORT}/**
 * @nudo:contract f fView
 */
export function bitOr(f) { return f.line | 0; }
`);
    expect(l2Count(r2)).toBe(0);
    expect(r2.summary.errors).toBe(0);
  });
});

describe("#119 对照组：may-throw 打点不越界", () => {
  it("无契约 any 参数的 `${x}` 仍报 L2（既定 policy）", () => {
    const r = check(`export function anyTpl(x) { return \`\${x}\`; }`);
    expect(l2Count(r, "anyTpl")).toBeGreaterThan(0);
  });

  it("无契约 any 参数的一元 + / 位运算仍报 L2（surface 通道对照）", () => {
    const r = check(`export function anyUnary(x) { return +x; }`);
    expect(l2Count(r, "anyUnary")).toBeGreaterThan(0);
    const r2 = check(`export function anyBit(x) { return x | 0; }`);
    expect(l2Count(r2, "anyBit")).toBeGreaterThan(0);
  });

  it.each([
    [
      "obj",
      `export function objArm(v) { const x = v ? { a: 1 } : undefined; return \`\${x}\`; }`,
    ],
    [
      "fn",
      `export function fnArm(v) { const g = v ? () => 1 : undefined; return \`\${g}\`; }`,
    ],
    [
      "brand",
      `class C { constructor() { this.n = 1; } }\nexport function brandArm(v) { const c = v ? new C() : undefined; return \`\${c}\`; }`,
    ],
  ])("%s 臂 sum 的模板插值仍报 L2（nullish 兄弟成员不稀释 obj/fn/brand 臂）", (_name, fnSrc) => {
    const r = check(fnSrc);
    const fn = fnSrc.match(/export function (\w+)/)![1]!;
    expect(l2Count(r, fn)).toBeGreaterThan(0);
    // 打点来源就是 Symbol ToString 强转（同一条 noteCoercionMayThrow 通道）
    expect(
      r.issues.some(
        (i) =>
          i.code === "nudo:entry-may-throw" &&
          i.fn === fn &&
          (i.suggestion ?? "").includes("ToString coercion of abstract operand"),
      ),
    ).toBe(true);
  });
});

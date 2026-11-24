/**
 * 注解入口域的回归钉（根因根除台账的仓内落点）。
 *
 * 三个构造的入口 Abs 此前分别退化成 `any`（连带假 `nudo:entry-may-throw`）
 * 或 `never throws TypeError`：
 * - 构造器参数属性带默认值 ⇒ 参数域取默认值的类型；
 * - 构造签名函数类型（`new (x: number) => A`）⇒ `new C(…)` 不是对普通函数 `new`；
 * - 迭代协议注解（`Iterable<T>` / `Iterator<T>` / `AsyncIterable<T>`）⇒ 注解可解析。
 *
 * 每条带一变量对照（确实该报的同形输入仍然上屏），证明诊断通道没有被整体关掉。
 * 缺陷编号只出现在 it 标题的 provenance。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, resetCheckSourceMemo, pTrue } from "../index.ts";

type Report = ReturnType<typeof checkSource>;

const FILE = "/t/annotation-entry-domain.ts";

/** 某入口上的诊断码（severity 无关，按出现顺序）。 */
const codesOf = (r: Report, fn: string): string[] =>
  r.issues.filter((i) => i.fn === fn).map((i) => i.code);

/** 签名行：`name(p: T, …) => display`（display 已含 `throws X`；与 check 人类面同形的判据文本）。 */
function sigOf(r: Report, name: string): string {
  const s = r.signatures.find((x) => x.name === name);
  if (!s) return `<no signature ${name}>`;
  const params = s.params.map((p, i) => `${p}: ${s.paramTypes?.[i] ?? "?"}`).join(", ");
  return `${s.name}(${params}) => ${s.display}`;
}

beforeEach(() => {
  resetCheckSourceMemo();
});

describe("迭代协议注解的入口域", () => {
  const SRC = `export function sumIter(xs: Iterable<number>): number { let n = 0; for (const x of xs) n += x; return n; }
export function sumIt(xs: Iterator<number>): number { let n = 0; for (const x of xs) n += x; return n; }
export async function sumAsync(xs: AsyncIterable<number>): Promise<number> { let n = 0; for await (const x of xs) n += x; return n; }
`;

  it("BUG-497 `Iterable<T>` / `Iterator<T>` / `AsyncIterable<T>` 形参注解可解析：三个入口零诊断（不再有假 `nudo:entry-may-throw` / `nudo:annotation-unresolved`），形参不再是 any", () => {
    const r = checkSource(FILE, SRC, pTrue);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).not.toContain("nudo:annotation-unresolved");
    for (const name of ["sumIter", "sumIt", "sumAsync"]) {
      expect(codesOf(r, name), name).not.toContain("nudo:entry-may-throw");
      // 改前：整条注解解析失败 ⇒ 形参退 any
      expect(r.signatures.find((s) => s.name === name)?.paramTypes?.[0], name).not.toBe("any");
    }
  });

  it("BUG-497 一变量对照：未声明的泛型注解（`Foo<T>`）仍然解析失败——形参退 any，并上屏 `nudo:annotation-unresolved` 与 `nudo:entry-may-throw`", () => {
    const r = checkSource(
      FILE,
      "export function sumFoo(xs: Foo<number>): number { let n = 0; for (const x of xs) n += x; return n; }\n",
      pTrue,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("nudo:annotation-unresolved");
    expect(codesOf(r, "sumFoo")).toEqual(["nudo:entry-may-throw"]);
    expect(sigOf(r, "sumFoo")).toBe("sumFoo(xs: any) => number | string throws TypeError");
  });
});

describe("构造器参数属性的默认值域", () => {
  const SRC = `export class WithDefault {
  constructor(public z = 1) {}
  inc(): number { return this.z + 1; }
}
`;

  it("BUG-435 `constructor(public z = 1)`：类入口签名 `WithDefault(z: number)`（不是 any），零诊断；`inc() => number` 不记 may-throw", () => {
    const r = checkSource(FILE, SRC, pTrue);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(sigOf(r, "WithDefault")).toBe("WithDefault(z: number) => WithDefault");
    expect(sigOf(r, "WithDefault.inc")).toBe("WithDefault.inc() => number");
  });

  it("BUG-435 一变量对照：`constructor(public z)`（无默认值无注解）的参数域仍是 any；`constructor(public z: number = 1)` 与默认值口径同宽", () => {
    const bare = checkSource(FILE, "export class NoDefault {\n  constructor(public z) {}\n}\n", pTrue);
    expect(sigOf(bare, "NoDefault")).toBe("NoDefault(z: any) => NoDefault");

    const annotated = checkSource(FILE, "export class AnnDefault {\n  constructor(public z: number = 1) {}\n}\n", pTrue);
    expect(sigOf(annotated, "AnnDefault")).toBe("AnnDefault(z: number) => AnnDefault");
  });
});

describe("构造签名函数类型的入口域", () => {
  const SRC = `export interface A { a: number }
export type Ctor = new (x: number) => A;
export function viaNew(C: new (x: number) => A): number { return new C(1).a; }
export function viaAlias(C: Ctor): number { return new C(2).a; }
export function viaCallAsNew(C: (x: number) => A): number { return new C(1).a; }
`;

  it("BUG-423 `new (x: number) => A` 形参：`new C(1).a` 不记 may-throw，入口签名 `=> number`（不再 `never throws TypeError`）；同文件别名 `type Ctor = new (x: number) => A` 同口径", () => {
    const r = checkSource(FILE, SRC, pTrue);
    expect(sigOf(r, "viaNew")).toBe("viaNew(C: (number) => { a: number }) => number");
    expect(sigOf(r, "viaAlias")).toBe("viaAlias(C: (number) => { a: number }) => number");
    expect(codesOf(r, "viaNew")).toEqual([]);
    expect(codesOf(r, "viaAlias")).toEqual([]);
  });

  it("BUG-423 一变量对照：`new` 作用在普通函数类型（`(x: number) => A`）上仍记 `nudo:entry-may-throw`（TypeError），整个报告不通过", () => {
    const r = checkSource(FILE, SRC, pTrue);
    expect(r.ok).toBe(false);
    expect(codesOf(r, "viaCallAsNew")).toEqual(["nudo:entry-may-throw"]);
    expect(sigOf(r, "viaCallAsNew")).toBe(
      "viaCallAsNew(C: (number) => { a: number }) => number throws TypeError",
    );
  });
});

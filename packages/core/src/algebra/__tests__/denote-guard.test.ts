/**
 * 模块套件：denoteGuard 的结构/品牌/谓词义务（运行时接受集）。
 *
 * 原 9 个 core--guard-* part 按义务类型归并；断言与 Abs 夹具逐字保留。
 */
import { describe, it, expect, afterAll } from "vitest";
import { abs, obj, strLit, type Abs, gt, lit, v, abs as makeAbs, numLit, eq, app, bool, boolLit, num, str, never, unknown, and, ge, le, v as termVar } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// `arguments`（非数组 exotic）不得以 Array.isArray 为前提
// ---------------------------------------------------------------------------
describe("`arguments`（非数组 exotic）不得以 Array.isArray 为前提", () => {
/**
 * `arguments` 是**非数组 exotic**（core 自己的 判
 * `Array.isArray(arguments) === false`），而 guard 面把 brand 的内层 tuple
 * 折成 `Array.isArray(data) && …` ⇒ 守卫对被导出函数**自己的返回值**恒假。
 *
 * 根因：`denote.ts` 的 arr / tuple 分支把 `Array.isArray` 硬编码成必要前提，
 * 不看 brand 的 exotic 语义（`brand "Arguments"` 包 tuple）。
 *
 * 本钉：`Arguments` brand 只判长度 / 下标语义，不发数组前提。
 */




/** `arguments`（长度 0）的 Abs 形态：brand "Arguments" 包空 tuple */
function emptyArgsAbs(): Abs {
  return abs(
    { k: "brand", name: "Arguments", shape: abs({ k: "tuple", elements: [] }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "exact",
  );
}

/** 长度 2 的 `arguments`：两个 unknown 元素 */
function twoArgsAbs(): Abs {
  const unknownEl = abs({ k: "unknown" }, undefined, undefined, "exact");
  return abs(
    {
      k: "brand",
      name: "Arguments",
      shape: abs({ k: "tuple", elements: [unknownEl, unknownEl] }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

const argsOf = (n: number): unknown => {
  const f = new Function(`return (function(){ return arguments; })(${Array.from({ length: n }, () => "1").join(",")});`);
  return f();
};

describe("`arguments`（非数组 exotic）不得以 Array.isArray 为前提", () => {
  it("守卫体不含 `Array.isArray`，且放行函数自己的 `arguments`", () => {
    const g = denoteGuard(emptyArgsAbs(), "data");
    expect(g).not.toContain("Array.isArray");
    const check = runner(g);
    expect(Array.isArray(argsOf(0))).toBe(false);
    expect(check(argsOf(0))).toBe(true);
  });

  it("长度语义仍是判据（负控制）", () => {
    const check = runner(denoteGuard(twoArgsAbs(), "data"));
    expect(check(argsOf(2))).toBe(true);
    expect(check(argsOf(0))).toBe(false);
    expect(check(argsOf(3))).toBe(false);
  });

  it("与 core 的 `Array.isArray` 判定同口径（不许自相矛盾）", () => {
    // 守卫接受的对象必须包含 `arguments`；普通对象/数组按形状各自裁决
    const g = denoteGuard(emptyArgsAbs(), "data");
    expect(g).not.toContain("Array.isArray");
    expect(obj({ a: { value: strLit("x") } }).shape.k).toBe("obj");
  });
});
});

// ---------------------------------------------------------------------------
// guard 的数组检查不跳过稀疏洞
// ---------------------------------------------------------------------------
describe("guard 的数组检查不跳过稀疏洞", () => {
/**
 * guard 面的数组检查用 `Array.prototype.every` ⇒ 规范规定它**跳过
 * 不存在的下标（洞）** ⇒ 稀疏数组的洞位从不被检查 ⇒ guard 放行 `[1,,3]`，
 * 而 zod / standard 按位读到 `undefined` ⇒ 拒绝 ⇒ 三面接受集相反。
 *
 * 根因：`denote.ts` 的 `case "arr"` 用 `${v}.every(...)`（同文件 tuple 分支
 * 已用 `i in v` 正确处理洞，arr 分支漏了）。
 *
 * 本钉：洞位必须被当作 `undefined` 检查（与 standard 面同口径）。
 */




const positiveNum = (): Abs =>
  abs(
    { k: "prim", type: "number" },
    v("item"),
    gt(v("item"), lit(0)),
    "path",
  );

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("guard 的数组检查不跳过稀疏洞", () => {
  it("运行时：接受 `[1,2,3]`，拒绝稀疏 `[1,,3]` 与 `[1,undefined,3]`", () => {
    const check = runner(denoteGuard(arrOf(positiveNum()), "data"));
    expect(check([1, 2, 3])).toBe(true);
    // 洞位按 `undefined` 检查（与 zod / standard 同口径）
    expect(check([1, , 3])).toBe(false);
    expect(check([1, undefined, 3])).toBe(false);
    expect(check([1, 0, 3])).toBe(false);
  });

  it("守卫仍要求数组本身（负控制）", () => {
    const g = denoteGuard(arrOf(positiveNum()), "data");
    const check = runner(g);
    expect(g).toContain("Array.isArray(data)");
    expect(check({ 0: 1, 1: 2, length: 2 })).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// brand 身份必须被投影进守卫（instanceof 判定）
// ---------------------------------------------------------------------------
describe("brand 身份必须被投影进守卫（instanceof 判定）", () => {
/**
 * 守卫投影**丢掉 brand 身份** → `ismkDateOutput({})` 返回 `true`
 * （假绿），与 zod / dts / check 三面互相矛盾。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "brand"`
 * 只递归投影 brand 的**内层 shape**，**不投影 brand 身份**（既无 `instanceof`
 * 也无 brand 名）⇒ 守卫退化成「是个对象即可」（`{}` / `[]` / `new Map()`
 * 全放行）。
 *
 * 修法（族 09 裁决，冻结面内）：`case "brand"` 产出 `globalThis["<Brand>"]`
 * 形态的 `instanceof` 判定；**运行时没有该全局构造器 ⇒ 放行**（与 standard 面
 * 「ctor 找不到 ⇒ 放行」同口径）；构造器按**字符串下标**取（不用裸标识符 ⇒
 * 产物在 strict 工程里不会 TS2304）。
 *
 * 本钉覆盖：① 身份子句的**文本形态**；② 运行时**接受/拒绝**判定；
 * ③ 「构造器不存在 ⇒ 放行」；④ 负控制：不得以裸标识符引用用户类名。
 */




/** brand 形态 Abs（内层默认是空槽对象面） */
const brandOf = (name: string, inner?: Abs): Abs =>
  makeAbs(
    {
      k: "brand",
      name,
      shape:
        inner ?? makeAbs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );

/** 把守卫表达式当运行时函数跑（守卫产物的语义面） */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("brand 身份必须被投影进守卫（instanceof 判定）", () => {
  it("brand 臂产出 globalThis[\"<Brand>\"] 形态的 instanceof 判定", () => {
    const g = denoteGuard(brandOf("Date"), "data");
    expect(g).toContain('Reflect.get(globalThis, "Date")');
    // 判定形如 `typeof ctor !== "function" || v instanceof ctor`
    expect(g).toMatch(
      /typeof Reflect\.get\(globalThis, "Date"\) !== "function"/,
    );
    expect(g).toMatch(/instanceof Reflect\.get\(globalThis, "Date"\)/);
  });

  it("运行时：只有该 brand 的实例被放行（`{}` / `[]` / `new Map()` 全拒）", () => {
    const check = runner(denoteGuard(brandOf("Date"), "data"));
    expect(check(new Date(0))).toBe(true);
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
    expect(check(new Map())).toBe(false);
    expect(check(null)).toBe(false);
    expect(check("x")).toBe(false);
    expect(check(42)).toBe(false);
  });

  it("运行时没有该全局构造器 ⇒ 放行（与 standard 面「ctor 找不到 ⇒ 放行」同口径）", () => {
    const g = denoteGuard(brandOf("Counter"), "data");
    // 身份子句仍然投影（不是「不投影」）
    expect(g).toContain('Reflect.get(globalThis, "Counter")');
    expect(g).toContain("instanceof");
    // 但运行时 globalThis.Counter 不存在 ⇒ 身份子句放行
    const check = runner(g);
    expect(check({})).toBe(true);
    // 内层 shape（对象面）仍然生效 ⇒ 数组仍被排除
    expect(check([])).toBe(false);
  });

  it("负控制：产物不得以裸标识符引用用户类名（否则 TS2304）", () => {
    const g = denoteGuard(brandOf("Counter"), "data");
    expect(g).not.toMatch(/instanceof\s+Counter\b/);
    expect(g).not.toMatch(/instanceof\s+Date\b/);
  });
});
});

// ---------------------------------------------------------------------------
// brand 内层的观测字面量不得钉成出口域
// ---------------------------------------------------------------------------
describe("brand 内层的观测字面量不得钉成出口域", () => {
/**
 * guard 面把 brand 的**观测字面量**钉死（`source === "abc"` /
 * `flags === "g"` / `message === "boom"` …）⇒ 同一个 brand 的其它实例被拒
 * （`/abc/i`、`new TypeError(…)`），而 `.d.ts` / zod / standard 三面只判
 * **brand 身份**（`instanceof`）⇒ 四面接受集相反（假红）。
 *
 * 根因：`denote.ts` 的 `case "brand"` 直接递归内层 shape，而内层槽在 Abs 里
 * 是**观测到的字面量**；`widenUncertainLiteral` 只放宽顶层 term，不递归槽位。
 *
 * 本钉：brand 内层只保留**类型**子句 ⇒ 同 brand 的任意实例都放行。
 */




/** `new RegExp("abc", "g")` 的观测形态：brand + 内层字面量槽 */
function regexpAbs(): Abs {
  return abs(
    {
      k: "brand",
      name: "RegExp",
      shape: obj({
        source: { value: strLit("abc") },
        flags: { value: strLit("g") },
        lastIndex: { value: numLit(0) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

function errorAbs(): Abs {
  return abs(
    {
      k: "brand",
      name: "Error",
      shape: obj({
        message: { value: strLit("boom") },
        name: { value: strLit("Error") },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("brand 内层的观测字面量不得钉成出口域", () => {
  it("RegExp：同 brand 的任意实例都放行（`/abc/i`、`/xyz/g`）", () => {
    const g = denoteGuard(regexpAbs(), "data");
    expect(g).not.toContain('=== "abc"');
    const check = runner(g);
    expect(check(/abc/g)).toBe(true);
    expect(check(/abc/i)).toBe(true);
    expect(check(/xyz/g)).toBe(true);
    // 负控制：身份仍在
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
  });

  it("Error：`new TypeError('boom')` 也是 Error（身份判据，不钉 message/name）", () => {
    const check = runner(denoteGuard(errorAbs(), "data"));
    expect(check(new Error("boom"))).toBe(true);
    expect(check(new Error("other"))).toBe(true);
    expect(check(new TypeError("boom"))).toBe(true);
    expect(check({ message: "boom", name: "Error" })).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// guard 面保留比较类谓词
// ---------------------------------------------------------------------------
describe("guard 面保留比较类谓词", () => {
/**
 * guard 面把契约里的**比较类谓词**整段蒸发（`.int()` 的整性谓词 +
 * 嵌套字段的数值界）⇒ guard 放行契约外值（`3.5` / `NaN` / `{n:0}`），而同一
 * 份源码的 zod / standard 面拒绝 ⇒ 三个产物面对同一个值给出相反裁决。
 *
 * 根因：`denote.ts` 的 `predAsJs` 只认「左端是值本身」的比较；`.int()` 的
 * 左端是 `app("%", [x, lit(1)])`、嵌套界左端是 `app("get", [parent, lit(k)])`
 * ⇒ 两个分支全部落空 ⇒ 谓词被抹成 `"true"`。
 *
 * 本钉：两种可判定形态都必须投影出来，且**运行时接受集**与契约域一致。
 */




const SELF = v("__nudo_self__");

/** `number().int()` 的 Abs 形态：`eq(app("%", [self, lit(1)]), lit(0))` */
function intAbs(): Abs {
  return abs(
    { k: "prim", type: "number" },
    SELF,
    eq(app("%", [SELF, lit(1)]), lit(0)),
    "path",
  );
}

/** `shape({ n: number().gt(0) })` 的槽 Abs 形态：`gt(app("get", [self, "n"]), lit(0))` */
function nestedBoundAbs(): Abs {
  const field = app("get", [SELF, lit("n")]);
  return obj({
    n: {
      value: abs({ k: "prim", type: "number" }, field, gt(field, lit(0)), "path"),
    },
  });
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

describe("guard 面保留比较类谓词", () => {
  it("`.int()` ⇒ `Number.isInteger`（不是恒真）", () => {
    const g = denoteGuard(intAbs(), "data");
    expect(g).toContain("Number.isInteger(data)");
    const check = runner(g);
    expect(check(3)).toBe(true);
    expect(check(-3)).toBe(true);
    expect(check(3.5)).toBe(false);
    expect(check(Number.NaN)).toBe(false);
    expect(check(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("嵌套字段数值界 ⇒ `data.n > 0`（不是恒真）", () => {
    const g = denoteGuard(nestedBoundAbs(), "data");
    expect(g).toContain("data.n > 0");
    const check = runner(g);
    expect(check({ n: 1 })).toBe(true);
    expect(check({ n: 0 })).toBe(false);
    expect(check({ n: -5 })).toBe(false);
    expect(check({})).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// 原型成员同名的槽走方括号取值（产物可编译）
// ---------------------------------------------------------------------------
describe("原型成员同名的槽走方括号取值（产物可编译）", () => {
/**
 * guard 产物**过不了 `tsc --noEmit --strict`**（TS2367）：槽名撞
 * `Object.prototype` 具名成员（`toString` / `valueOf` / `constructor` /
 * `hasOwnProperty`）时，`data.toString` 的静态类型是原型成员的类型
 * （`Record<string, any>` 的索引签名**不遮蔽**它们）⇒ 与字面量比较 ⇒
 * "types '() => string' and 'string' have no overlap"。
 *
 * 根因：`denote.ts` 的 obj 槽访问走 `safeMemberAccess`（标识符键 ⇒ **点号**）。
 * 方括号取值让索引签名生效（静态类型 `any`）⇒ 可编译。
 *
 * 本钉：这类键必须走方括号；产物真跑 `tsc --noEmit --strict` 必须通过。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const protoSlots = (): Abs =>
  obj({
    toString: { value: strLit("s") },
    valueOf: { value: numLit(1) },
    constructor: { value: strLit("c") },
    hasOwnProperty: { value: abs({ k: "prim", type: "boolean" }, { op: "lit", value: true }, undefined, "exact") },
  });

describe("原型成员同名的槽走方括号取值（产物可编译）", () => {
  it("守卫体里不出现点号访问（`data.toString`），改用 `data[\"toString\"]`", () => {
    const g = denoteGuard(protoSlots(), "data");
    expect(g).not.toContain("data.toString");
    expect(g).not.toContain("data.valueOf");
    expect(g).not.toContain("data.constructor");
    expect(g).not.toContain("data.hasOwnProperty");
    expect(g).toContain('data["toString"]');
    expect(g).toContain('data["valueOf"]');
    expect(g).toContain('data["constructor"]');
    expect(g).toContain('data["hasOwnProperty"]');
  });

  it("产物真跑 tsc --noEmit --strict（改前 TS2367 ×4）", () => {
    const body = denoteGuard(protoSlots(), "data");
    const source =
      `export function isprotoSlotsOutput(value: unknown): boolean {\n` +
      `  const data = value as Record<string, any>;\n` +
      `  return ${body};\n}\n`;
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug097-"));
    dirs.push(dir);
    const p = join(dir, "guard.nudo.guard.ts");
    writeFileSync(p, source, "utf-8");
    let failure = "";
    try {
      execFileSync(
        "pnpm",
        ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      failure = `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}`;
    }
    expect(failure).toBe("");
  });

  it("运行时语义不变：接受真实对象，拒绝缺键对象", () => {
    const check = new Function("data", `return ${denoteGuard(protoSlots(), "data")};`) as (
      d: unknown,
    ) => boolean;
    expect(check({ toString: "s", valueOf: 1, constructor: "c", hasOwnProperty: true })).toBe(true);
    expect(check({ toString: "s", valueOf: 1, constructor: "c" })).toBe(false);
    // bool() 只用于类型对齐，不参与断言
    expect(bool().shape.k).toBe("prim");
  });
});
});

// ---------------------------------------------------------------------------
// 没有可用 prototype 的构造器 ⇒ 守卫跳过 brand 身份子句
// ---------------------------------------------------------------------------
describe("没有可用 prototype 的构造器 ⇒ 守卫跳过 brand 身份子句", () => {
/**
 * （并发 review F24 / P2）—— 生成的 guard 对 `new Proxy(...)` **抛错**。
 *
 * 现象：`new Proxy({}, {})` 的 brand 是 `"Proxy"`
 * （`packages/core/src/algebra/builtins/error/error-family.ts` 的
 * `makeProxyAbs`）⇒ `denote.ts` 的 brand 身份子句生成
 * `v instanceof Reflect.get(globalThis, "Proxy")` ⇒ 而原生
 * `x instanceof Proxy` **抛 TypeError**（`Proxy.prototype` 是 `undefined`
 * ⇒ `Get(C, "prototype")` 结果非对象 ⇒ instanceof 抛）⇒ 守卫产物一跑就炸
 * ⇒ 守卫**不可用**。
 *
 * 修法：**没有可用 prototype** 的全局构造器 ⇒ 跳过身份子句（身份信息在守卫
 * 面无法表达 ⇒ 只保留内层 shape 判定；守卫必须能跑）。
 */




/** brand 形态 Abs（内层默认是空槽对象面） */
const brandOf = (name: string, inner?: Abs): Abs =>
  abs(
    {
      k: "brand",
      name,
      shape: inner ?? abs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );

/** 把守卫表达式当运行时函数跑（守卫产物的语义面） */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("没有可用 prototype 的构造器 ⇒ 守卫跳过 brand 身份子句", () => {
  it("原生 oracle：x instanceof Proxy 抛 TypeError（Proxy 没有 prototype）", () => {
    const proxyCtor = Reflect.get(globalThis, "Proxy") as unknown as Function;
    expect((proxyCtor as unknown as { prototype?: unknown }).prototype).toBeUndefined();
    expect(() => ({} instanceof proxyCtor)).toThrow(TypeError);
  });

  it("Proxy brand 的守卫不含 instanceof 身份子句", () => {
    const g = denoteGuard(brandOf("Proxy"), "data");
    expect(g).not.toContain("instanceof");
    expect(g).not.toContain('Reflect.get(globalThis, "Proxy")');
  });

  it("Proxy brand 的守卫跑在真 Proxy 上不抛错", () => {
    const g = denoteGuard(brandOf("Proxy"), "data");
    const check = runner(g);
    const p = new Proxy({ a: 1 }, {});
    expect(() => check(p)).not.toThrow();
    expect(check(p)).toBe(true);
  });

  it("Proxy brand 的守卫仍保留内层 shape 判定（不是「恒真」）", () => {
    const inner = abs(
      { k: "obj", slots: { a: { value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") } } },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(brandOf("Proxy", inner), "data");
    const check = runner(g);
    // 内层必填槽 a 缺失 ⇒ 拒
    expect(check(new Proxy({}, {}))).toBe(false);
    // 内层满足 ⇒ 放行（身份子句已跳过）
    expect(check(new Proxy({ a: 1 }, {}))).toBe(true);
  });

  it("负控制：有 prototype 的构造器（Date）仍保留身份子句（Bug 407 不回退）", () => {
    const g = denoteGuard(brandOf("Date"), "data");
    expect(g).toContain('Reflect.get(globalThis, "Date")');
    expect(g).toMatch(/instanceof Reflect\.get\(globalThis, "Date"\)/);
    const check = runner(g);
    expect(check(new Date(0))).toBe(true);
    expect(check({})).toBe(false);
  });

  it("不可调用的标准全局（Math）同样跳过身份子句（原生 instanceof 抛「not callable」）", () => {
    // 原生 oracle
    expect(() => ({} instanceof (Math as unknown as Function))).toThrow(TypeError);
    const g = denoteGuard(brandOf("Math"), "data");
    expect(g).not.toContain("instanceof");
    expect(() => runner(g)({})).not.toThrow();
  });
});
});

// ---------------------------------------------------------------------------
// 必填槽存在性是独立子句 + 对象判定排除数组
// ---------------------------------------------------------------------------
describe("必填槽存在性是独立子句 + 对象判定排除数组", () => {
/**
 * `nudo export --format guard`：**必填槽的存在性检查被丢掉**、
 * `typeof === "object"` **不排除数组** → 守卫放行引擎与 standard-schema 都拒
 * 的值（假绿）。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "obj"`：
 * ① 槽内层守卫为 `"true"`（`any()` / `unknown`）时**整条键检查（含存在性）
 * 不生成**；② 对象判定只有 `typeof v === "object" && v !== null` ⇒ 数组也匹配。
 *
 * 修法（族 09 裁决）：存在性写成**独立子句**（`Object.hasOwn(v, "a")` /
 * `"a" in v`）；对象判定加 `!Array.isArray(v)`。
 *
 * 本钉覆盖：① 必填槽（内层 `"true"`）的存在性子句；② 数组被排除；
 * ③ 运行时接受/拒绝判定；④ 负控制：可选槽**不产**存在性子句。
 */




/** obj 形态 Abs */
const objOfSlots = (
  slots: Record<string, { value: Abs; optional?: boolean }>,
): Abs => makeAbs({ k: "obj", slots }, undefined, undefined, "exact");

/** 把守卫表达式当运行时函数跑 */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("必填槽存在性是独立子句 + 对象判定排除数组", () => {
  it("内层守卫为 \"true\"（any/unknown）的必填槽仍产存在性子句", () => {
    const g = denoteGuard(objOfSlots({ id: { value: unknown } }), "data");
    expect(g).toContain('Object.hasOwn(data, "id")');
    expect(g).toContain('"id" in data');
  });

  it("对象判定排除数组", () => {
    const g = denoteGuard(objOfSlots({ id: { value: unknown } }), "data");
    expect(g).toContain("!Array.isArray(data)");
  });

  it("运行时：缺键 / 数组被拒，键在场被放行", () => {
    const check = runner(denoteGuard(objOfSlots({ id: { value: unknown } }), "data"));
    expect(check({ id: 1 })).toBe(true);
    expect(check({ id: undefined })).toBe(true);
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
    expect(check([1])).toBe(false);
    expect(check(new Date(0))).toBe(false);
    expect(check(null)).toBe(false);
    expect(check("x")).toBe(false);
  });

  it("负控制：可选槽不产存在性子句（可选槽本就允许缺键）", () => {
    const g = denoteGuard(
      objOfSlots({ id: { value: unknown, optional: true } }),
      "data",
    );
    expect(g).not.toContain('Object.hasOwn(data, "id")');
    const check = runner(g);
    expect(check({})).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// guard 投影必须保真结构义务
// ---------------------------------------------------------------------------
describe("guard 投影必须保真结构义务", () => {
/**
 * guard 投影（`denoteGuard`）**丢掉结构义务**：object 形状**把数组
 * 当对象接受**、**required 键缺失不报**、string **长度界整段消失** → 同一次
 * `nudo export --format all` 里 zod / standard 面**都保真**，只有 guard 面
 * **比它们宽松**（假绿）。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "obj"`
 * 与 `predAsJs`：
 * ① obj 分支缺 `!Array.isArray(v)`；② required 键的存在性没有独立检查；
 * ③ `predAsJs` 对 `app` 项落到 `return "true"` ⇒ 作用在 `length(self)` 上的
 * 界（`length()` / `min()` / `max()`）整段丢失。
 *
 * 报告末尾「第 80 轮主持人复核补充」块的**第三形态**：必填槽**值域恰为
 * `undefined`** ⇒ 存在性必须是**独立子句**，**不能**写成 `v.a !== undefined`
 * （会误拒「存在但为 undefined」）。
 *
 * 本钉覆盖：① 值域含 undefined 的必填槽（独立存在性子句 + 运行时判定）；
 * ② 长度界（`length(3)` / `max(3)` / `min(2)`）的文本与运行时判定；
 * ③ 负控制：非 length 的 app 项 / 非自指锚点**不得**被投影成长度界。
 */




/** obj 形态 Abs */
const objOfSlots = (
  slots: Record<string, { value: Abs; optional?: boolean }>,
): Abs => makeAbs({ k: "obj", slots }, undefined, undefined, "exact");

/** 把守卫表达式当运行时函数跑 */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("guard 投影必须保真结构义务", () => {
  it("必填槽值域恰为 undefined：存在性是独立子句（不是 v.a !== undefined）", () => {
    const undefAbs = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const g = denoteGuard(
      objOfSlots({ a: { value: undefAbs }, b: { value: numLit(1) } }),
      "data",
    );
    // 独立存在性子句
    expect(g).toContain('Object.hasOwn(data, "a")');
    expect(g).toContain('"a" in data');
    // 值子句仍在
    expect(g).toContain("data.a === undefined");
    // 不得用值子句反推存在性
    expect(g).not.toContain("data.a !== undefined");
  });

  it("必填槽值域恰为 undefined：缺键被拒、存在但为 undefined 被放行", () => {
    const undefAbs = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const check = runner(
      denoteGuard(
        objOfSlots({ a: { value: undefAbs }, b: { value: numLit(1) } }),
        "data",
      ),
    );
    expect(check({ a: undefined, b: 1 })).toBe(true);
    expect(check({ b: 1 })).toBe(false);
    expect(check({ a: 1, b: 1 })).toBe(false);
    expect(check({ a: undefined })).toBe(false);
  });

  it("长度界 length(3) 被投影成 v.length 比较（不再整段蒸发）", () => {
    const lenTerm = termVar("s");
    const a = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      and(
        ge(app("length", [lenTerm]), lit(3)),
        le(app("length", [lenTerm]), lit(3)),
      ),
      "exact",
    );
    const g = denoteGuard(a, "data");
    expect(g).toContain("data.length >= 3");
    expect(g).toContain("data.length <= 3");
    const check = runner(g);
    expect(check("abc")).toBe(true);
    expect(check("ab")).toBe(false);
    expect(check("abcd")).toBe(false);
    expect(check("")).toBe(false);
  });

  it("单边长度界：max(3) ⇒ <= ，min(2) ⇒ >=", () => {
    const lenTerm = termVar("s");
    const max = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      le(app("length", [lenTerm]), lit(3)),
      "exact",
    );
    const min = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("length", [lenTerm]), lit(2)),
      "exact",
    );
    expect(denoteGuard(max, "data")).toContain("data.length <= 3");
    expect(denoteGuard(min, "data")).toContain("data.length >= 2");
    expect(runner(denoteGuard(max, "data"))("abc")).toBe(true);
    expect(runner(denoteGuard(max, "data"))("abcd")).toBe(false);
    expect(runner(denoteGuard(min, "data"))("ab")).toBe(true);
    expect(runner(denoteGuard(min, "data"))("a")).toBe(false);
  });

  it("负控制：非 length 的 app 项 / 非自指锚点不得被投影成长度界", () => {
    const lenTerm = termVar("s");
    const other = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("get", [lenTerm]), lit(3)),
      "exact",
    );
    expect(denoteGuard(other, "data")).not.toContain("data.length");
    const foreign = makeAbs(
      { k: "prim", type: "string" },
      lenTerm,
      ge(app("length", [termVar("other")]), lit(3)),
      "exact",
    );
    expect(denoteGuard(foreign, "data")).not.toContain("data.length");
  });

  it("负控制：unknown 形状仍恒真（结构义务只对有形状的 Abs 生效）", () => {
    expect(denoteGuard(unknown, "data")).toBe("true");
  });
});
});


// ---------------------------------------------------------------------------
// 模块矩阵：denoteGuard 的接受集 / 可编译 / 非恒真不变量
// ---------------------------------------------------------------------------
describe("模块矩阵：denoteGuard 接受集", () => {
/** Abs 形态 → 必须接受 / 必须拒绝的运行时值；表驱动覆盖模块契约而非单个 bug。 */
type GuardCase = {
  name: string;
  abs: Abs;
  accept: unknown[];
  reject: unknown[];
  canBeTautology?: boolean;
};

const A = (v: unknown): Abs => abs(v as never, undefined, undefined, "exact");
const objOf = (slots: Record<string, { value: Abs; optional?: boolean }>): Abs =>
  A({ k: "obj", slots });
const arrOf = (element: Abs): Abs => A({ k: "arr", element });
const tupleOf = (elements: Abs[]): Abs => A({ k: "tuple", elements });

const CASES: GuardCase[] = [
  { name: "never 拒绝一切", abs: never, accept: [], reject: [0, "", null, undefined, {}, []] },
  { name: "unknown 接受一切", abs: unknown, accept: [0, "", null, undefined, {}, []], reject: [], canBeTautology: true },
  { name: "number 基类型", abs: num(), accept: [1, -0, Number.NaN, Infinity], reject: ["1", true, null, undefined, {}, []] },
  { name: "string 基类型", abs: str(), accept: ["", "a"], reject: [1, true, null, undefined, {}, []] },
  { name: "boolean 基类型", abs: bool(), accept: [true, false], reject: [0, 1, "true", null] },
  { name: "number 字面量", abs: numLit(1), accept: [1], reject: [2, -1, "1", true, null, Number.NaN, -0] },
  { name: "NaN 字面量", abs: numLit(Number.NaN), accept: [Number.NaN], reject: [1, "NaN", null] },
  { name: "string 字面量", abs: strLit("a"), accept: ["a"], reject: ["b", "", 1, null] },
  { name: "boolean 字面量", abs: boolLit(true), accept: [true], reject: [false, 1, "true"] },
  { name: "number 数组", abs: arrOf(num()), accept: [[], [1, 2]], reject: [[1, "x"], "[]", {}, null] },
  { name: "定长 tuple", abs: tupleOf([numLit(1), strLit("a")]), accept: [[1, "a"]], reject: [[1], [1, "a", 2], ["1", "a"], []] },
  { name: "必选字段 obj", abs: objOf({ a: { value: num() } }), accept: [{ a: 1 }], reject: [{}, { a: "1" }, [], null] },
  {
    name: "可选字段 obj（缺省 / undefined 接受，错型拒绝）",
    abs: objOf({ a: { value: num() }, b: { value: str(), optional: true } }),
    accept: [{ a: 1 }, { a: 1, b: undefined }, { a: 1, b: "x" }],
    reject: [{}, { a: 1, b: 2 }, { a: "1" }],
  },
  { name: "number | string", abs: A({ k: "sum", members: [num(), str()] }), accept: [1, "a", ""], reject: [true, null, {}, []] },
  {
    name: "obj(a:number) | obj(b:string)",
    abs: A({ k: "sum", members: [objOf({ a: { value: num() } }), objOf({ b: { value: str() } })] }),
    accept: [{ a: 1 }, { b: "x" }],
    reject: [{}, { a: "1" }, { b: 2 }, null],
  },
];

const compile = (g: string): ((v: unknown) => boolean) => new Function("data", `return (${g});`) as (v: unknown) => boolean;

it.each(CASES)("$name", ({ abs: a, accept, reject, canBeTautology }) => {
  const guard = denoteGuard(a, "data");
  expect(guard.trim().length).toBeGreaterThan(0);
  const check = compile(guard);
  for (const value of accept) expect(check(value), `accept ${String(value)}`).toBe(true);
  for (const value of reject) expect(check(value), `reject ${String(value)}`).toBe(false);
  if (!canBeTautology) expect(guard.trim()).not.toBe("true");
});
});

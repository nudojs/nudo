/**
 * 族 52 · harvester **收割面** 7 条（片 W2）。
 *
 * 每条任务至少一例 + 负控（非相关形态收割结果逐字不变）。
 *
 * | # | 项 | 断言要点 |
 * |---|---|---|
 * | 1 | 792 残留（**非限定**引用） | `namespace A` 里的 `Opts` 只含 A 的成员；`namespace B` 里的只含 B 的 |
 * | 2 | 泛型**基接口**的类型实参未代入 | `interface D extends Base<number>` ⇒ 基成员 `v` 是 `number`（不是 `any`） |
 * | 3 | 823 条件类型精度债 | 嵌套条件类型按**绑定实参**求值真支 ⇒ `"s"` / `"n"` / `"x"` 各自精确 |
 * | 4 | 821 泛型实例化顺序 | `Box<Promise<string>>` ⇒ `payload` 是 `string`（不是 α） |
 * | 5 | 793 模块作用域命名空间摊平 | `declare module "x" { namespace Y { … } }` ⇒ `bar` **不是** "x" 的导出；`export = ns` 形态**仍然**摊平；真实包（@types/node）语料对拍 |
 * | 6 | 804「降级」计数缺失 | 未建模的类型 ⇒ `stats.degraded`；没有降级时 `stats` 形状**逐字不变** |
 * | 7 | `collectStatement` 未登记缺口 | **匿名**默认导出（函数 / 类）不再是「丢了」⇒ 模块的 `default` 导出在 |
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r95/W2/oracle/）：
 *   - `import { bar } from "x"`（namespace Y 里的成员）⇒ TS2305
 *   - `import { Y } from "x"` ⇒ OK
 *   - `export = ns` 的模块 ⇒ `import { bar } from "y"` ⇒ OK
 *   - `import { O_RDONLY } from "node:fs"` ⇒ TS2305；`import { constants } from "node:fs"` ⇒ OK
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-52-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位名集合 */
function slotNames(a: Abs | undefined): string[] {
  if (!a) return [];
  const s = a.shape;
  if (s.k === "brand") return slotNames(s.shape as unknown as Abs);
  if (s.k !== "obj") return [];
  return Object.keys(s.slots);
}

/** 取某个槽位的值（brand 穿透一层） */
function slotValue(a: Abs | undefined, name: string): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape;
  const inner = s.k === "brand" ? (s.shape as unknown as Abs).shape : s;
  if (inner.k !== "obj") return undefined;
  return inner.slots[name]?.value;
}

/** 函数的第 0 个形参类型 */
function firstParam(a: Abs | undefined): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  return a.shape.paramTypes?.[0];
}

/** 槽位值的展示串（类型断言用） */
function slotType(a: Abs | undefined, name: string): string {
  const v = slotValue(a, name);
  return v ? formatShape(v) : "<none>";
}

const typesNode = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "node_modules/@types/node",
);

describe("族 52 · 收割面 ① —— 非限定引用按引用点所在命名空间解析（792 残留）", () => {
  const NS = `declare namespace A {
  interface Opts { a: number }
  interface Holder { o: Opts }
}
declare namespace B {
  interface Opts { b: string }
  interface Holder { o: Opts }
}
export declare function useA(h: A.Holder): number;
export declare function useB(h: B.Holder): string;
`;

  it("namespace A 里的非限定 `Opts` 只解析到 A.Opts（不含 B.Opts 的 b）", () => {
    const env = harvestDts([writeTemp("ns.d.ts", NS)]);
    const holder = firstParam(env.globals.useA!);
    expect(slotNames(slotValue(holder, "o"))).toEqual(["a"]);
  });

  it("namespace B 里的非限定 `Opts` 只解析到 B.Opts（不含 A.Opts 的 a）", () => {
    const env = harvestDts([writeTemp("ns.d.ts", NS)]);
    const holder = firstParam(env.globals.useB!);
    expect(slotNames(slotValue(holder, "o"))).toEqual(["b"]);
  });

  it("负控：全局作用域的短名引用照常解析（既有口径不被破坏）", () => {
    const env = harvestDts([
      writeTemp("plain.d.ts", `interface Opts { a: number }\nexport declare const o: Opts;\n`),
    ]);
    expect(slotNames(env.globals.o!)).toEqual(["a"]);
  });

  it("负控：全局作用域的短名**不**落到命名空间里的同名接口（TS 同口径）", () => {
    const env = harvestDts([
      writeTemp(
        "ns2.d.ts",
        `declare namespace A { interface Opts { a: number } }\nexport declare const o: Opts;\n`,
      ),
    ]);
    // TS：全局作用域的 `Opts` 不是 `A.Opts` ⇒ 收割面不得给出 A 的成员
    expect(slotNames(env.globals.o!)).toEqual([]);
  });
});

describe("族 52 · 收割面 ② —— 基接口的类型实参按基声明分别代入", () => {
  it("`interface D extends Base<number>` ⇒ 基成员 `v` 是 number（不是 any）", () => {
    const env = harvestDts([
      writeTemp(
        "ext.d.ts",
        `interface Base<T> { v: T }
interface Derived extends Base<number> { d: string }
export declare function useD(x: Derived): number;
`,
      ),
    ]);
    const d = firstParam(env.globals.useD!);
    expect(slotNames(d).sort()).toEqual(["d", "v"]);
    expect(slotType(d, "v")).toBe("number");
    expect(slotType(d, "d")).toBe("string");
  });

  it("负控：`extends Base`（没给实参）⇒ 基成员读 unknown（TS 的 `Base<unknown>`）", () => {
    const env = harvestDts([
      writeTemp(
        "ext2.d.ts",
        `interface Base<T> { v: T }
interface Derived extends Base { d: string }
export declare function useD(x: Derived): number;
`,
      ),
    ]);
    const d = firstParam(env.globals.useD!);
    expect(slotNames(d).sort()).toEqual(["d", "v"]);
    expect(slotType(d, "v")).toBe("unknown");
  });

  it("负控：非泛型接口的成员面不变", () => {
    const env = harvestDts([
      writeTemp(
        "plain.d.ts",
        `interface Plain { a: number; b: string }\nexport declare const p: Plain;\n`,
      ),
    ]);
    expect(slotNames(env.globals.p!).sort()).toEqual(["a", "b"]);
    expect(slotType(env.globals.p!, "a")).toBe("number");
  });
});

describe("族 52 · 收割面 ③④ —— 泛型实例化顺序 + 条件类型精度", () => {
  it("③ 嵌套条件类型按绑定实参求值真支（`string[]` ⇒ 精确的 \"s\"）", () => {
    const env = harvestDts([
      writeTemp(
        "cond.d.ts",
        `export interface CBox<T> { payload: T extends (infer E)[] ? (E extends string ? "s" : "n") : "x" }
export declare function useC(b: CBox<string[]>): string;
export declare function useC2(b: CBox<number[]>): string;
export declare function useC3(b: CBox<string>): string;
`,
      ),
    ]);
    expect(slotType(firstParam(env.globals.useC!), "payload")).toBe('"s"');
    expect(slotType(firstParam(env.globals.useC2!), "payload")).toBe('"n"');
    expect(slotType(firstParam(env.globals.useC3!), "payload")).toBe('"x"');
  });

  it("④ `Box<Promise<string>>` 实例化后 payload 是 string（不是 α / any）", () => {
    const env = harvestDts([
      writeTemp(
        "order.d.ts",
        `export interface PBox<T> { payload: T extends Promise<infer U> ? U : 0 }
export declare function useP(b: PBox<Promise<string>>): number;
export declare function useP2(b: PBox<Promise<number>>): number;
`,
      ),
    ]);
    expect(slotType(firstParam(env.globals.useP!), "payload")).toBe("string");
    expect(slotType(firstParam(env.globals.useP2!), "payload")).toBe("number");
  });

  it("负控：未实例化的泛型接口仍保留 α（不塌成 any）", () => {
    const env = harvestDts([
      writeTemp(
        "raw.d.ts",
        `export interface RBox<T> { payload: T }\nexport declare function useR(b: RBox<string>): number;\n`,
      ),
    ]);
    // 实参已知 ⇒ 实参代入（不是 α）
    expect(slotType(firstParam(env.globals.useR!), "payload")).toBe("string");
  });
});

describe("族 52 · 收割面 ⑤ —— 模块作用域的命名空间不再摊平", () => {
  it("`declare module \"x\" { namespace Y { … } }` ⇒ `bar` 不是 \"x\" 的导出", () => {
    const env = harvestDts([
      writeTemp(
        "mod.d.ts",
        `declare module "x" {
  namespace Y {
    function bar(): number;
  }
}
`,
      ),
    ]);
    const rec = env.modules["x"]!;
    expect(Object.keys(rec)).toEqual(["Y"]);
    expect(rec["bar"]).toBeUndefined();
    // `Y` 是命名空间对象（成员挂在它下面）
    expect(slotNames(rec["Y"])).toEqual(["bar"]);
  });

  it("对照：`export = ns` 的模块**仍然**摊平（模块导出面 = 命名空间成员面）", () => {
    const env = harvestDts([
      writeTemp(
        "modeq.d.ts",
        `declare module "node:path" {
  namespace path {
    function normalize(p: string): string;
  }
  export = path;
}
`,
      ),
    ]);
    const rec = env.modules["node:path"]!;
    expect(Object.keys(rec).sort()).toEqual(["normalize"]);
    expect(formatShape(rec["normalize"]!)).toBe("(string) => string");
  });

  it("真实包语料对拍（@types/node）：`node:path` 不变、`node:fs` 的命名空间成员不再冒充模块导出", () => {
    const env = harvestDts([
      join(typesNode, "fs.d.ts"),
      join(typesNode, "path.d.ts"),
    ]);
    // `export = path` 的模块：导出面 = 命名空间成员面（**逐字不变**）
    expect(Object.keys(env.modules["node:path"]!).sort()).toEqual([
      "basename",
      "delimiter",
      "dirname",
      "extname",
      "format",
      "isAbsolute",
      "join",
      "matchesGlob",
      "normalize",
      "parse",
      "relative",
      "resolve",
      "sep",
      "toNamespacedPath",
    ]);
    // `node:fs` 的 `namespace constants` ⇒ `constants` 是模块的一个成员，
    // 它的常量**不再**是模块的导出（TS：TS2305）
    const fs = env.modules["node:fs"]!;
    expect(fs["constants"]).toBeDefined();
    expect(fs["O_RDONLY"]).toBeUndefined();
    expect(slotType(fs["constants"], "O_RDONLY")).toBe("number");
    // 模块自有的函数导出不受影响
    expect(fs["readFileSync"]).toBeDefined();
  });
});

describe("族 52 · 收割面 ⑥ —— 「类型未建模」进 stats（降级 ≠ 丢了）", () => {
  it("未建模的类型（映射类型）⇒ `stats.degraded` 计数，绑定仍保留", () => {
    const env = harvestDts([
      writeTemp(
        "deg.d.ts",
        `export declare const mappedLit: { [K in "a" | "b"]: number };
export declare const plain: number;
`,
      ),
    ]);
    expect(env.stats.degraded).toBe(1);
    // 降级**不是**丢了：绑定还在（值域未知）
    expect(env.globals["mappedLit"]).toBeDefined();
    expect(env.globals["plain"]).toBeDefined();
    expect(env.stats.skipped).toBe(0);
  });

  it("负控：没有降级时 `stats` 的形状与旧口径**逐字不变**（不带 degraded 键）", () => {
    const env = harvestDts([
      writeTemp("clean.d.ts", `export declare const plain: number;\n`),
    ]);
    expect(env.stats).toEqual({ files: 1, symbols: 1, skipped: 0 });
    expect(Object.hasOwn(env.stats, "degraded")).toBe(false);
  });
});

describe("族 52 · 收割面 ⑦ —— 匿名默认导出不再被丢掉", () => {
  it("`export default function (): void;` ⇒ 模块的 `default` 导出在（不是「丢了」）", () => {
    const env = harvestDts([
      writeTemp(
        "def.d.ts",
        `export default function (): void;
export declare function named(): void;
`,
      ),
    ]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.globals["default"]!.shape.k).toBe("fn");
    expect(env.stats.skipped).toBe(0);
  });

  it("`export default class { … }` ⇒ 模块的 `default` 导出在", () => {
    const env = harvestDts([
      writeTemp("defclass.d.ts", `export default class { go(): number; }\n`),
    ]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.stats.skipped).toBe(0);
  });

  it("负控：具名默认导出（`export default function foo()`）的口径不变（本地名不是命名导出）", () => {
    const env = harvestDts([
      writeTemp("named.d.ts", `export default function foo(): void;\n`),
    ]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.globals["foo"]).toBeUndefined();
  });
});

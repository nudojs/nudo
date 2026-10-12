/**
 * Bug 84：私有槽泄漏为可枚举自有属性——internal 槽标志，全 introspection 面。
 *
 * 私有字段（#x）此前存为实例内层 obj 的普通 "#x" 字符串槽：for-in 枚举出
 * "#x"、hasOwnProperty("#x") → true、gOPN/keys/spread/assign/stringify 全部
 * 可见。native 私有字段是内部槽，对所有属性 introspection 不可见。
 *
 * 修复数据流：transpile 期 PrivateName 打 private 标记（计算键公共字段
 * ["#x"] 不带）→ applyInstanceFields 落地槽打 Slot.internal（覆写保留）→
 * 各 introspection 面查标剔除。合法公共字符串键 {"#x":1} 与私有槽同键空间
 * 共存，不得误伤（"#x" in obj 的接受歧义是 Bug 78 混淆键设计权衡）。
 *
 * 不变量：$get/$set(obj, "#x", …) 直连键访问照常（Bug 78 语义）；$in 的槽
 * 存在性查询不受 internal 影响（#x in this → true）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  transpileSource,
  litValue,
  formatAbs,
  type Abs,
} from "@nudojs/core";
import { getPropFlags } from "../builtins.ts";

/** concrete 抽取（differential/harness.ts 口径）：lit 值 / tuple / obj 逐槽
 *  （getPropFlags 过滤 enumerable:false 非枚举键），非具体 → undefined */
function concrete(a: Abs | undefined): unknown {
  if (!a || typeof a !== "object") return a;
  const lvR = litValue(a);
  if (lvR.ok) return lvR.value;
  const k = a.shape?.k;
  if (k === "tuple") {
    const els = a.shape.elements.map((e: Abs) => concrete(e));
    if (els.some((e: unknown) => e === undefined)) return undefined;
    return els;
  }
  if (k === "obj") {
    const out: Record<string, unknown> = {};
    const flags = getPropFlags(a);
    for (const [key, s] of Object.entries(a.shape.slots as Record<string, never>)) {
      if (flags?.get(key)?.enumerable === false) continue;
      const v = concrete((s as { value: Abs }).value);
      if (v === undefined) return undefined;
      out[key] = v;
    }
    return out;
  }
  return undefined;
}

/** exec 求值：f() 返回值 concrete 抽取（非具体退 formatShape 串） */
function exec(src: string): unknown {
  const run = runTranspiled(`export function f() { ${src} }`, {
    mode: "exec",
    maxLoopIters: 2000,
  });
  const r = callTranspiledExportFull(run, "f", []).result as Abs | undefined;
  const c = concrete(r);
  return c !== undefined ? c : `abs=${formatAbs(r!)}`;
}

describe("Bug 84: private fields are internal slots — invisible to introspection", () => {
  it("for-in over instance enumerates only public fields", () => {
    expect(exec(`class A { #x = 1; pub = 2; } let s = ""; for (const k in new A()) { s += k; } return s;`)).toBe("pub");
  });

  it("hasOwnProperty('#x') → false (internal slot), hasOwnProperty('pub') → true", () => {
    expect(exec(`class A { #x = 1; pub = 2; } return new A().hasOwnProperty("#x");`)).toBe(false);
    expect(exec(`class A { #x = 1; pub = 2; } return new A().hasOwnProperty("pub");`)).toBe(true);
  });

  it("Object.keys / Object.getOwnPropertyNames → ['pub']", () => {
    expect(exec(`class A { #x = 1; pub = 2; } return Object.keys(new A());`)).toEqual(["pub"]);
    expect(exec(`class A { #x = 1; pub = 2; } return Object.getOwnPropertyNames(new A());`)).toEqual(["pub"]);
  });

  it("JSON.stringify drops private fields", () => {
    expect(exec(`class A { #x = 1; pub = 2; } return JSON.stringify(new A());`)).toBe('{"pub":2}');
  });

  it("spread {...instance} copies public fields only (was {} — publics lost)", () => {
    expect(exec(`class A { #x = 1; pub = 2; } return { ...new A() };`)).toEqual({ pub: 2 });
  });

  it("Object.assign({}, instance) copies public fields only", () => {
    expect(exec(`class A { #x = 1; pub = 2; } return Object.assign({}, new A());`)).toEqual({ pub: 2 });
  });

  it("private methods do not leak into for-in either", () => {
    expect(exec(`class A { #m() {} pub = 2; } let s = ""; for (const k in new A()) { s += k; } return s;`)).toBe("pub");
  });
});

describe("Bug 84: invariants — direct access, $in, public '#'-string keys", () => {
  it("this.#x direct read still works (Bug 78 semantics)", () => {
    expect(exec(`class A { #x = 1; m() { return this.#x; } } return new A().m();`)).toBe(1);
  });

  it("this.#x = v overwrite keeps the slot internal (invisible after write)", () => {
    expect(
      exec(
        `class A { #x = 1; pub = 2; m(v) { this.#x = v; } }
         const a = new A(); a.m(5);
         return Object.hasOwn(a, "#x");`,
      ),
    ).toBe(false);
    expect(
      exec(
        `class A { #x = 1; pub = 2; m(v) { this.#x = v; } }
         const a = new A(); a.m(5);
         let s = ""; for (const k in a) { s += k; } return s;`,
      ),
    ).toBe("pub");
  });

  it("'#x in this' stays true (slot presence, not introspection view)", () => {
    expect(exec(`class A { #x = 1; m() { return #x in this; } } return new A().m();`)).toBe(true);
  });

  it("public string key '#x' on plain object still enumerates / reads", () => {
    expect(exec(`let s = ""; for (const k in {"#x": 1}) { s += k; } return s;`)).toBe("#x");
    expect(exec(`const o = {"#x": 7}; return o["#x"];`)).toBe(7);
  });

  it("computed public field ['#x'] on a class stays enumerable (no name-prefix filtering)", () => {
    expect(exec(`class A { ["#x"] = 9; } let s = ""; for (const k in new A()) { s += k; } return s;`)).toBe("#x");
  });
});

describe("Bug 84: transpile emits the private flag on instanceFields spec", () => {
  it("PrivateName → { name, private: true }; computed/public keys unflagged", () => {
    const code = transpileSource(
      `export function f() { class A { #x = 1; ["#y"] = 2; pub = 3; } return new A(); }`,
    );
    // init thunk 内含 '}'，不能用单列正则——按 entry 边界切片逐条断言
    const fields = code.slice(code.indexOf("instanceFields: ["), code.indexOf("],", code.indexOf("instanceFields: [")));
    const entryOf = (name: string): string => {
      const start = fields.indexOf(`{ name: "${name}",`);
      expect(start, `entry ${name} emitted`).toBeGreaterThan(-1);
      const next = fields.indexOf("{ name:", start + 1);
      return fields.slice(start, next === -1 ? undefined : next);
    };
    expect(entryOf("#x")).toContain("private: true");
    expect(entryOf("#y")).not.toContain("private");
    expect(entryOf("pub")).not.toContain("private");
  });
});

describe("Bug 84 precision: class-instance gOPD / JSON fold", () => {
  it("gOPD on public field → exact data descriptor (native: all-true flags)", () => {
    expect(
      exec(
        `class A { #x = 1; pub = 2; } return Object.getOwnPropertyDescriptor(new A(), "pub");`,
      ),
    ).toEqual({ value: 2, writable: true, enumerable: true, configurable: true });
  });
  it("gOPD on private slot → undefined (internal slot, not an own property)", () => {
    expect(
      exec(
        `class A { #x = 1; pub = 2; } return Object.getOwnPropertyDescriptor(new A(), "#x") === undefined;`,
      ),
    ).toBe(true);
  });
  it("gOPD on absent key → undefined (closed inner)", () => {
    expect(
      exec(
        `class A { pub = 2; } return Object.getOwnPropertyDescriptor(new A(), "nope") === undefined;`,
      ),
    ).toBe(true);
  });
  it("gOPD on runtime defineProperty field → exact descriptor with flags", () => {
    expect(
      exec(
        `class A { pub = 2; } const a = new A();` +
          ` Object.defineProperty(a, "z", { value: 9, writable: true, enumerable: true, configurable: true });` +
          ` return Object.getOwnPropertyDescriptor(a, "z");`,
      ),
    ).toEqual({ value: 9, writable: true, enumerable: true, configurable: true });
  });
  it("gOPD on runtime defineProperty getter → accessor descriptor (enumerable flag survives)", () => {
    expect(
      exec(
        `class A { pub = 2; } const a = new A();` +
          ` Object.defineProperty(a, "z", { get() { return 1; }, enumerable: true, configurable: true });` +
          ` const d = Object.getOwnPropertyDescriptor(a, "z");` +
          ` return [typeof d.get, d.enumerable, d.configurable, d.set === undefined];`,
      ),
    ).toEqual(["function", true, true, true]);
  });
  it("JSON.stringify with prototype getter folds exactly (getter is not an own prop)", () => {
    // 原生：访问器装在原型上，非实例自有属性——不枚举不调用（node 实测 {"pub":2}）
    expect(
      exec(`class A { get x() { return "G"; } pub = 2; } return JSON.stringify(new A());`),
    ).toBe('{"pub":2}');
  });
  it("JSON.stringify with toJSON method stays abstract (native calls it via proto lookup)", () => {
    const r = exec(
      `class A { toJSON() { return "T"; } pub = 2; } return JSON.stringify(new A());`,
    );
    expect(typeof r).toBe("string");
    expect(r).toMatch(/^abs=/); // 保守不折（原生返回 "T"）
  });
  it("JSON.stringify with dynamic defineProperty getter folds via accessor dispatch", () => {
    // 动态访问器：内层占位槽 + 侧表派发 getter（Bug 57 口径）→ 精确
    expect(
      exec(
        `class A { pub = 2; } const a = new A();` +
          ` Object.defineProperty(a, "z", { get() { return "G"; }, enumerable: true });` +
          ` return JSON.stringify(a);`,
      ),
    ).toBe('{"pub":2,"z":"G"}');
  });
});

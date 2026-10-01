/** 项（Term）：抽象值的身份。字面量是项的特例。 */

export type LiteralValue = string | number | boolean | bigint | null | undefined;

export type Term =
  | { op: "lit"; value: LiteralValue }
  | { op: "var"; id: string }
  | { op: "app"; fn: string; args: Term[] };

export const lit = (value: LiteralValue): Term => ({
  op: "lit",
  // -0 保留：约束语义（===、>、+）与 0 等价（JS 自身），但
  // 除法/Math.sign/atan2/Object.is 上有可观察差异，折叠必须保真。
  value,
});
export const v = (id: string): Term => ({ op: "var", id });
export const app = (fn: string, args: Term[]): Term => ({ op: "app", fn, args });

export function termEquals(a: Term, b: Term): boolean {
  if (a === b) return true;
  if (a.op !== b.op) return false;
  // 项身份用 SameValue 的 NaN 口径：NaN 与自身同项；-0 与 0 仍同项（与 === 一致）
  if (a.op === "lit" && b.op === "lit") {
    if (typeof a.value === "number" && typeof b.value === "number" && Number.isNaN(a.value) && Number.isNaN(b.value)) {
      return true;
    }
    return a.value === b.value;
  }
  if (a.op === "var" && b.op === "var") return a.id === b.id;
  if (a.op === "app" && b.op === "app") {
    return (
      a.fn === b.fn &&
      a.args.length === b.args.length &&
      a.args.every((x, i) => termEquals(x, b.args[i]!))
    );
  }
  return false;
}

/**
 * 键通道字面量序列化：-0 与 0 身份不同（Object.is / 1/x 可观察差异），
 * String(-0)==="0" 会抹掉符号。NaN→"NaN" 已天然区分，bigint 靠 typeof 前缀分开。
 * 仅用于 dedup / map / cache / 指纹键；展示面走 formatShape（自身已特判 -0）。
 */
export function litKeyString(v: LiteralValue): string {
  if (typeof v === "number" && Object.is(v, -0)) return "-0";
  return String(v);
}

export function termToString(t: Term): string {
  if (t.op === "lit") {
    if (typeof t.value === "string") return JSON.stringify(t.value);
    // -0 与 0 可观察不同（Object.is / 1/x）；键化口径见 litKeyString
    if (typeof t.value === "number") return litKeyString(t.value);
    return String(t.value);
  }
  if (t.op === "var") return t.id;
  // 字段访问：get(u, "id") → u.id
  if (t.op === "app" && t.fn === "get" && t.args.length === 2) {
    const obj = termToString(t.args[0]!);
    const key = t.args[1]!;
    if (key.op === "lit" && typeof key.value === "string") {
      return `${obj}.${key.value}`;
    }
  }
  if (t.fn === "+" && t.args.length === 2) {
    return `(${termToString(t.args[0]!)} + ${termToString(t.args[1]!)})`;
  }
  if (t.fn === "-" && t.args.length === 2) {
    return `(${termToString(t.args[0]!)} - ${termToString(t.args[1]!)})`;
  }
  if (t.fn === "*" && t.args.length === 2) {
    return `(${termToString(t.args[0]!)} * ${termToString(t.args[1]!)})`;
  }
  return `${t.fn}(${t.args.map(termToString).join(", ")})`;
}

/** 常量折叠 + 简单代数化简 */
export function simplifyTerm(t: Term): Term {
  if (t.op !== "app") return t;
  const args = t.args.map(simplifyTerm);
  const fn = t.fn;

  if (args.every((a) => a.op === "lit")) {
    const xs = args.map((a) => (a as { value: LiteralValue }).value);
    const folded = foldLiterals(fn, xs);
    if (folded !== undefined) return lit(folded);
  }

  // 不可用 x+0=x / 0+x=x：-0+0=+0（非 -0），且 any/string 参与 + 是拼接
  // （"a"+0="a0"）。与已删除的 x*0=0 同族——恒等式在全值域上不成立。
  // x * 1 = x, 1 * x = x（仅 number 路径；非 number 字面量走 ToNumber 折值）
  // （不可用 x*0=0：NaN*0 与 Infinity*0 皆为 NaN；x*1 对 number 含 -0/NaN/Inf 仍成立）
  if (fn === "*" && args.length === 2) {
    const [a, b] = args as [Term, Term];
    const one = (t: Term): boolean => t.op === "lit" && t.value === 1;
    const surviveMulOne = (t: Term): Term => {
      if (t.op !== "lit") return t; // var / app 走 number 路径
      const v = t.value;
      if (typeof v === "number") return t;
      // ToNumber：true→1、null→0、"5"→5、undefined→NaN
      if (typeof v === "boolean") return lit(v ? 1 : 0);
      if (v === null) return lit(0);
      if (typeof v === "string") return lit(Number(v));
      return lit(NaN);
    };
    if (one(b)) return surviveMulOne(a);
    if (one(a)) return surviveMulOne(b);
  }
  // x - 0 = x 只对 **+0** 成立：(-0)-(-0)=+0，-0 被减数被抹掉
  // （b.value === 0 会连 lit(-0) 一起匹配——JS 里 -0 === 0）
  if (fn === "-" && args.length === 2) {
    const [a, b] = args as [Term, Term];
    if (b.op === "lit" && Object.is(b.value, 0)) return a;
  }

  return app(fn, args);
}

function foldLiterals(fn: string, xs: LiteralValue[]): LiteralValue | undefined {
  if (fn === "+" && xs.length === 2) {
    const [a, b] = xs as [number | string, number | string];
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (typeof a === "string" || typeof b === "string") return String(a) + String(b);
    return undefined;
  }
  if (fn === "-" && xs.length === 2) {
    const [a, b] = xs as [number, number];
    if (typeof a === "number" && typeof b === "number") return a - b;
    return undefined;
  }
  if (fn === "*" && xs.length === 2) {
    const [a, b] = xs as [number, number];
    if (typeof a === "number" && typeof b === "number") return a * b;
    return undefined;
  }
  if (fn === "neg" && xs.length === 1) {
    const a = xs[0];
    if (typeof a === "number") return -a;
    return undefined;
  }
  return undefined;
}

/** 项（Term）：抽象值的身份。字面量是项的特例。 */

export type LiteralValue = string | number | boolean | null | undefined;

export type Term =
  | { op: "lit"; value: LiteralValue }
  | { op: "var"; id: string }
  | { op: "app"; fn: string; args: Term[] };

export const lit = (value: LiteralValue): Term => ({
  op: "lit",
  // -0 与 0 在约束语义上等价，统一为 +0
  value: typeof value === "number" && value === 0 ? 0 : value,
});
export const v = (id: string): Term => ({ op: "var", id });
export const app = (fn: string, args: Term[]): Term => ({ op: "app", fn, args });

export function termEquals(a: Term, b: Term): boolean {
  if (a.op !== b.op) return false;
  if (a.op === "lit" && b.op === "lit") return a.value === b.value;
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

export function termToString(t: Term): string {
  if (t.op === "lit") {
    return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
  }
  if (t.op === "var") return t.id;
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

  // x + 0 = x, 0 + x = x
  if (fn === "+" && args.length === 2) {
    const [a, b] = args as [Term, Term];
    if (a.op === "lit" && a.value === 0) return b;
    if (b.op === "lit" && b.value === 0) return a;
  }
  // x * 1 = x, 1 * x = x; x * 0 = 0
  if (fn === "*" && args.length === 2) {
    const [a, b] = args as [Term, Term];
    if (a.op === "lit" && a.value === 1) return b;
    if (b.op === "lit" && b.value === 1) return a;
    if (
      (a.op === "lit" && a.value === 0) ||
      (b.op === "lit" && b.value === 0)
    ) {
      return lit(0);
    }
  }
  // x - 0 = x
  if (fn === "-" && args.length === 2) {
    const [a, b] = args as [Term, Term];
    if (b.op === "lit" && b.value === 0) return a;
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

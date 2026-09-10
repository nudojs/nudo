export * from "./term.ts";
export * from "./pred.ts";
export * from "./abs.ts";
export * from "./arithmetic.ts";
export * from "./leak.ts";
export * from "./objects.ts";
export * from "./hof.ts";
// eval.ts 的 joinAbs 与 objects.ts 冲突，objects 优先
export { evalExpr, evalIf as evalIfExpr, defineFn, applyNamed, applyFn, callAdd, envOf, type Expr, type Env } from "./eval.ts";
export * from "./ast-eval.ts";
export * from "./format.ts";
export * from "./generalize.ts";
export * from "./diagnostics.ts";
export * from "./template.ts";
export * from "./language.ts";
export * from "./check.ts";
// modules/fs/path 属于 host（service/cli），不进 kernel
export * from "./bridge.ts";

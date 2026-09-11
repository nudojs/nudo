export * from "./term.ts";
export * from "./pred.ts";
export * from "./phi.ts";
export * from "./abs.ts";
export * from "./abs-fn.ts";
export * from "./arithmetic.ts";
export * from "./surface.ts";
export * from "./builtins.ts";
export * from "./methods.ts";
export * from "./leak.ts";
export * from "./objects.ts";
// eval.ts 仅服务示例/差分；joinAbs 以 objects 为准
export {
  evalExpr,
  evalIf as evalIfExpr,
  defineFn,
  applyNamed,
  applyFn,
  callAdd,
  envOf,
  type Expr,
  type Env,
} from "./eval.ts";
export * from "./ast-eval.ts";
export * from "./format.ts";
export * from "./generalize.ts";
export * from "./diagnostics.ts";
export * from "./template.ts";
export * from "./language.ts";
export * from "./check.ts";
// modules/fs/path 属于 host（service/cli），不进代数
export * from "./bridge.ts";


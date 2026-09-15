export * from "./term.ts";
export * from "./pred.ts";
export * from "./phi.ts";
export * from "./abs.ts";
export * from "./abs-fn.ts";
export * from "./hof.ts";
export * from "./arithmetic.ts";
export * from "./surface.ts";
export * from "./builtins.ts";
export * from "./methods.ts";
export * from "./leak.ts";
export * from "./objects.ts";
export * from "./leq.ts";
export * from "./ast-eval.ts";
export * from "./format.ts";
export * from "./generalize.ts";
export * from "./diagnostics.ts";
export * from "./template.ts";
export * from "./language.ts";
export * from "./parse-source.ts";
export * from "./hash-source.ts";
export * from "./stable-source-key.ts";
export * from "./fn-fp.ts";
export * from "./load-deps-fp.ts";
export * from "./check.ts";
export * from "./check-report.ts";
export * from "./refine.ts";
export * from "./constraint.ts";
export * from "./domain-membership.ts";
// 桶导出歧义消解：constraint.ts 的 lit/and 构建器与 term/pred 的同名导出冲突，
// 显式再导出固定桶含义为 term/pred 侧；constraint 的 lit/and 须从 "./constraint.ts" 直接路径导入。
export { lit } from "./term.ts";
export { and } from "./pred.ts";
export * from "./inlay.ts";
export * from "./denote.ts";
export * from "./abs-modules.ts";
export * from "./exec/index.ts";
// modules/fs/path 属于 host（service/cli），不进代数
export * from "./bridge.ts";
export * from "./interface.ts";
export * from "./domain-membership.ts";
export * from "./projection.ts";
// T10b：注入域证据检查经桶导出给 service analyzer（scan.ts 其余为 check.ts 内部机械）
export { checkInjectedDomainEvidence, type InjectedDomainRecord } from "./scan.ts";


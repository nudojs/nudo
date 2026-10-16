// 指令抽取按指令族分域：types（指令类型）/ diag（诊断 sink 单一通道）/
// case-arg（case 实参与类型表达式文法）/ expr-scan（字符串感知扫描工具）/
// mock-expr（sinon / nudo mock 表达式文法）/ fn-directives（函数级指令抽取）/
// inline-directives（@nudo:as / @nudo:replace）/ file-directives（@nudo:env /
// @nudo:mock-module）。本文件是显式具名 re-export barrel（仓内惯例：core 的
// runtime.ts / class.ts / containers.ts），消费面不变。
export {
  type CaseDirective,
  type MockDirective,
  type SinonExpression,
  type PureDirective,
  type SkipDirective,
  type SampleDirective,
  type EnvDirective,
  type MockModuleDirective,
  type AsDirective,
  type ReplaceDirective,
  type InlineDirective,
  type FileDirective,
  type Directive,
  type FunctionWithDirectives,
} from "./directives/types.ts";
export {
  runWithDirectiveDiags,
  type DirectiveDiag,
  type ExtractDirectivesOpts,
} from "./directives/diag.ts";
export { parseCaseArgExpr } from "./directives/case-arg.ts";
export { extractDirectives, extractDirectivesQuiet } from "./directives/fn-directives.ts";
export { extractInlineDirectives } from "./directives/inline-directives.ts";
export { extractFileDirectives } from "./directives/file-directives.ts";

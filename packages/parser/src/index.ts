export { parse } from "./parse.ts";
// stripTypes 单源在 core（parser 依赖 core，避免双份拷贝漂移）
export { stripTypes } from "@nudojs/core";
export {
  type Directive,
  type FileDirective,
  type InlineDirective,
  type AsDirective,
  type ReplaceDirective,
  type CaseDirective,
  type MockDirective,
  type PureDirective,
  type SkipDirective,
  type SampleDirective,
  type EnvDirective,
  type MockModuleDirective,
  type FunctionWithDirectives,
  type SinonExpression,
  extractDirectives,
  extractFileDirectives,
  extractInlineDirectives,
  parseTypeValueExpr,
  parseCaseArgExpr,
} from "./directives.ts";

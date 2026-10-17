import type { Node } from "@babel/types";
import type { Abs, MockHelper } from "@nudojs/core";

export type CaseDirective = {
  kind: "case";
  name: string;
  /** 无损参数 Abs（case 文法唯一真理源：约束构建器 / 具体字面量） */
  argsAbs: Abs[];
  /** `=> expected` 断言 Abs */
  expected?: Abs;
  commentLine?: number;
};

export type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;
  fromPath?: string;
  arrowFn?: { params: string[]; body: Node; paramPatterns: Node[] };
  sinonExpr?: SinonExpression;
  nudoMock?: MockHelper;
};

export type SinonExpression = {
  type: "stub" | "spy" | "mock";
  returnValue?: Abs;
  resolvedValue?: Abs;
  rejectedValue?: Abs;
};

export type PureDirective = {
  kind: "pure";
};

export type SkipDirective = {
  kind: "skip";
  returns?: Abs;
};

export type SampleDirective = {
  kind: "sample";
  count: number;
};

export type EnvDirective = {
  kind: "env";
  envs: string[];
};

export type MockModuleDirective = {
  kind: "mock-module";
  source: string;
  names?: string[];
  fromPath: string;
};

export type AsDirective = {
  kind: "as";
  typeAbs: Abs;
};

export type ReplaceDirective = {
  kind: "replace";
  targetSource: string;
  typeAbs: Abs;
};

export type InlineDirective = AsDirective | ReplaceDirective;

export type FileDirective = EnvDirective | MockModuleDirective;

export type Directive = CaseDirective | MockDirective | PureDirective | SkipDirective | SampleDirective;

export type FunctionWithDirectives = {
  node: Node;
  name: string;
  directives: Directive[];
};

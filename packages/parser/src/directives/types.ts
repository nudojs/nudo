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
  /**
   * 内联箭头 mock 的扫描结果：形参（源码形态）+ 体 + async 标志。
   * - `params`：1:1 于形参个数的**源码形态**（签名用；默认形参保留默认值、
   *   rest 保留 `...`、解构形参保留 `{ a, b }`）。
   * - `paramPatterns`：形参 AST（原样）——消费面可自行解构绑定。
   * - `boundNames`：每个形参**绑定的名字**（作用域用；解构列出顶层绑定名）。
   * - `async`：`async (x) => …` 的 async 语义（Bug 857）。
   */
  arrowFn?: {
    params: string[];
    body: Node;
    paramPatterns: Node[];
    async?: boolean;
    boundNames?: string[][];
  };
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

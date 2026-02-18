import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type TypeValue,
  T,
  typeValueToString,
  simplifyUnion,
  createEnvironment,
  isSubtypeOf,
  type Environment,
} from "@justscript/core";
import { parse, extractDirectives, parseTypeValueExpr } from "@justscript/parser";
import type { FunctionWithDirectives } from "@justscript/parser";
import {
  evaluate,
  evaluateFunction,
  evaluateFunctionFull,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  resetMemo,
} from "@justscript/cli/evaluator";

export type SourceLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = {
  range: SourceLocation;
  severity: DiagnosticSeverity;
  message: string;
};

export type CaseResult = {
  name: string;
  args: TypeValue[];
  result: TypeValue;
  throws: TypeValue;
};

export type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  cases: CaseResult[];
  combined?: TypeValue;
  assertionErrors?: string[];
};

export type BindingInfo = {
  type: TypeValue;
  loc?: SourceLocation;
};

export type AnalysisResult = {
  functions: FunctionAnalysis[];
  diagnostics: Diagnostic[];
  bindings: Map<string, BindingInfo>;
  nodeTypeMap: Map<Node, TypeValue>;
};

export type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
};

function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string } | null {
  const extensions = [".js", ".just.js", ".ts", ".mjs"];
  const basePath = resolve(fromDir, source);
  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) {
      const src = readFileSync(candidate, "utf-8");
      return { ast: parse(src), filePath: candidate };
    }
  }
  return null;
}

function applyMocks(
  directives: FunctionWithDirectives["directives"],
  env: Environment,
  filePath: string,
): void {
  for (const d of directives) {
    if (d.kind !== "mock") continue;
    if (d.expression) {
      env.bind(d.name, parseTypeValueExpr(d.expression));
    } else if (d.fromPath) {
      const mockPath = resolve(dirname(filePath), d.fromPath);
      const mockSource = readFileSync(mockPath, "utf-8");
      const mockAst = parse(mockSource);
      const mockEnv = createEnvironment();
      evaluateProgram(mockAst, mockEnv);
      const mockVal = mockEnv.lookup(d.name);
      env.bind(d.name, mockVal);
    }
  }
}

function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

export function analyzeFile(filePath: string, source: string): AnalysisResult {
  const ast = parse(source);
  const functions = extractDirectives(ast);
  const diagnostics: Diagnostic[] = [];
  const bindings = new Map<string, BindingInfo>();
  const nodeTypeMap = new Map<Node, TypeValue>();
  const functionResults: FunctionAnalysis[] = [];

  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  collectBindings(ast, globalEnv, bindings);

  for (const fn of functions) {
    applyMocks(fn.directives, globalEnv, filePath);

    const isPure = fn.directives.some((d) => d.kind === "pure");
    const skipDirective = fn.directives.find((d) => d.kind === "skip");
    const returnsDirective = fn.directives.find((d) => d.kind === "returns");

    const fnLoc = locFromNode(fn.node);
    const analysis: FunctionAnalysis = { name: fn.name, loc: fnLoc, cases: [] };

    if (skipDirective && skipDirective.kind === "skip") {
      if (skipDirective.returns) {
        analysis.combined = skipDirective.returns;
      }
      functionResults.push(analysis);
      continue;
    }

    if (isPure) {
      const fnVal = globalEnv.has(fn.name) ? globalEnv.lookup(fn.name) : null;
      if (fnVal && fnVal.kind === "function") {
        (fnVal as any)._memoize = fn.name;
      }
    }

    const caseDirectives = fn.directives.filter((d) => d.kind === "case");

    for (const directive of caseDirectives) {
      const fullResult = evaluateFunctionFull(fn.node, directive.args, globalEnv);
      analysis.cases.push({
        name: directive.name,
        args: directive.args,
        result: fullResult.value,
        throws: fullResult.throws,
      });

      if (fullResult.throws.kind !== "never") {
        diagnostics.push({
          range: fnLoc,
          severity: "warning",
          message: `Function "${fn.name}" case "${directive.name}" may throw: ${typeValueToString(fullResult.throws)}`,
        });
      }
    }

    if (analysis.cases.length > 1) {
      analysis.combined = simplifyUnion(analysis.cases.map((c) => c.result));
    } else if (analysis.cases.length === 1) {
      analysis.combined = analysis.cases[0].result;
    }

    if (returnsDirective && returnsDirective.kind === "returns") {
      analysis.assertionErrors = [];
      for (const directive of caseDirectives) {
        const result = evaluateFunction(fn.node, directive.args, globalEnv);
        const matches = isSubtypeOf(result, returnsDirective.expected);
        if (!matches) {
          const msg = `@just:returns assertion failed for case "${directive.name}": expected ${typeValueToString(returnsDirective.expected)}, got ${typeValueToString(result)}`;
          analysis.assertionErrors.push(msg);
          diagnostics.push({
            range: fnLoc,
            severity: "error",
            message: msg,
          });
        }
      }
    }

    functionResults.push(analysis);
  }

  buildNodeTypeMap(ast, globalEnv, nodeTypeMap);

  setModuleResolver(null);

  return {
    functions: functionResults,
    diagnostics,
    bindings,
    nodeTypeMap,
  };
}

function collectBindings(ast: Node, env: Environment, bindings: Map<string, BindingInfo>): void {
  if (ast.type !== "File") return;
  for (const stmt of (ast as any).program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) {
      const val = env.has(stmt.id.name) ? env.lookup(stmt.id.name) : T.unknown;
      bindings.set(stmt.id.name, { type: val, loc: locFromNode(stmt) });
    }
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (decl.id.type === "Identifier") {
          const val = env.has(decl.id.name) ? env.lookup(decl.id.name) : T.unknown;
          bindings.set(decl.id.name, { type: val, loc: locFromNode(decl) });
        }
      }
    }
    if (stmt.type === "ClassDeclaration" && stmt.id) {
      const val = env.has(stmt.id.name) ? env.lookup(stmt.id.name) : T.unknown;
      bindings.set(stmt.id.name, { type: val, loc: locFromNode(stmt) });
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      collectBindings({ type: "File", program: { type: "Program", body: [stmt.declaration] } } as any, env, bindings);
    }
  }
}

function buildNodeTypeMap(ast: Node, env: Environment, nodeTypeMap: Map<Node, TypeValue>): void {
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      enter(path) {
        const node = path.node;
        try {
          if (
            node.type === "Identifier" &&
            node.name !== "undefined" &&
            path.parentPath?.node.type !== "FunctionDeclaration" &&
            path.parentPath?.node.type !== "VariableDeclarator"
          ) {
            if (env.has(node.name)) {
              nodeTypeMap.set(node, env.lookup(node.name));
            }
          }
          if (node.type === "NumericLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "StringLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "BooleanLiteral") {
            nodeTypeMap.set(node, T.literal(node.value));
          }
          if (node.type === "NullLiteral") {
            nodeTypeMap.set(node, T.null);
          }
        } catch {
          // skip nodes that fail
        }
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }
}

export function getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
): TypeValue | null {
  const ast = parse(source);
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  const nodeTypeMap = new Map<Node, TypeValue>();
  buildNodeTypeMap(ast, globalEnv, nodeTypeMap);

  const functions = extractDirectives(ast);
  for (const fn of functions) {
    const caseDirectives = fn.directives.filter((d) => d.kind === "case");
    for (const directive of caseDirectives) {
      evaluateFunctionFull(fn.node, directive.args, globalEnv);
    }
  }

  let bestMatch: TypeValue | null = null;
  let bestSize = Infinity;

  for (const [node, tv] of nodeTypeMap) {
    const loc = node.loc;
    if (!loc) continue;
    if (
      loc.start.line <= line &&
      loc.end.line >= line &&
      (loc.start.line < line || loc.start.column <= column) &&
      (loc.end.line > line || loc.end.column >= column)
    ) {
      const size = (loc.end.line - loc.start.line) * 10000 + (loc.end.column - loc.start.column);
      if (size < bestSize) {
        bestSize = size;
        bestMatch = tv;
      }
    }
  }

  if (!bestMatch) {
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (identAtPos && globalEnv.has(identAtPos)) {
      bestMatch = globalEnv.lookup(identAtPos);
    }
  }

  setModuleResolver(null);
  return bestMatch;
}

function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = path.node.name;
          path.stop();
        }
      },
    });
  } catch {
    // ignore
  }
  return found;
}

export function getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
): CompletionItem[] {
  const textBefore = getTextBeforePosition(source, line, column);
  const dotMatch = textBefore.match(/(\w+)\.\s*\w*$/);
  if (!dotMatch) return getVariableCompletions(filePath, source);

  const objName = dotMatch[1];

  const safeSource = sanitizeSourceForParsing(source);

  let ast;
  try {
    ast = parse(safeSource);
  } catch {
    try {
      ast = parse(source);
    } catch {
      return [];
    }
  }

  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  if (!globalEnv.has(objName)) {
    setModuleResolver(null);
    return [];
  }

  const objType = globalEnv.lookup(objName);
  const completions = getCompletionsForType(objType);

  setModuleResolver(null);
  return completions;
}

function sanitizeSourceForParsing(source: string): string {
  return source.replace(/(\w+)\.\s*$/gm, "$1._ ");
}

function getTextBeforePosition(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1].slice(0, column);
}

function getVariableCompletions(filePath: string, source: string): CompletionItem[] {
  const ast = parse(source);
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  const ownBindings = globalEnv.getOwnBindings();
  const completions: CompletionItem[] = [];
  for (const [name, tv] of Object.entries(ownBindings)) {
    if (name.startsWith("__export_")) continue;
    completions.push({
      label: name,
      kind: tv.kind === "function" ? "method" : "variable",
      detail: typeValueToString(tv),
    });
  }

  setModuleResolver(null);
  return completions;
}

function getCompletionsForType(tv: TypeValue): CompletionItem[] {
  const completions: CompletionItem[] = [];

  if (tv.kind === "object") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "instance") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "array" || tv.kind === "tuple") {
    const arrayMethods = [
      { label: "map", detail: "map(callback)" },
      { label: "filter", detail: "filter(callback)" },
      { label: "reduce", detail: "reduce(callback, init)" },
      { label: "find", detail: "find(callback)" },
      { label: "some", detail: "some(callback)" },
      { label: "every", detail: "every(callback)" },
      { label: "forEach", detail: "forEach(callback)" },
      { label: "flatMap", detail: "flatMap(callback)" },
      { label: "includes", detail: "includes(value)" },
      { label: "indexOf", detail: "indexOf(value)" },
      { label: "join", detail: "join(separator)" },
      { label: "slice", detail: "slice(start, end)" },
      { label: "concat", detail: "concat(other)" },
      { label: "push", detail: "push(value)" },
      { label: "length", detail: tv.kind === "tuple" ? `${tv.elements.length}` : "number" },
    ];
    for (const m of arrayMethods) {
      completions.push({ label: m.label, kind: "method", detail: m.detail });
    }
    return completions;
  }

  if (tv.kind === "promise") {
    completions.push({ label: "then", kind: "method", detail: "then(callback)" });
    completions.push({ label: "catch", kind: "method", detail: "catch(callback)" });
    completions.push({ label: "finally", kind: "method", detail: "finally(callback)" });
    return completions;
  }

  if (tv.kind === "primitive" && tv.type === "string") {
    const stringMethods = ["toUpperCase", "toLowerCase", "trim", "split", "slice", "includes", "indexOf", "replace", "startsWith", "endsWith", "charAt", "length"];
    for (const m of stringMethods) {
      completions.push({ label: m, kind: "method", detail: `string.${m}` });
    }
    return completions;
  }

  return completions;
}

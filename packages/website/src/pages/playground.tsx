import React, { lazy, useRef, useState, useEffect, Suspense } from 'react';
import type { JSX } from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Translate, { translate } from '@docusaurus/Translate';
import { parse, extractDirectives, type CaseDirective } from '@nudojs/parser';
import {
  formatShape,
  formatAbs,
  effectiveInterface,
  formatConstraint,
  runTranspiled,
  callTranspiledExportFull,
  setBCallCollector,
  abs as makeAbs,
  type Abs,
  type AbsModuleExports,
} from '@nudojs/core';
import { analyzeFile, getHoverAtPosition } from '@nudojs/service';
import type { HoverInfo } from '@nudojs/service';
import { collectAbsInlays, type AbsInlay } from '@nudojs/core/internal';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface CaseInfo {
  name: string;
  args: Abs[];
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface SinglePreset {
  mode: 'single';
  id: string;
  name: string;
  group: string;
  code: string;
}

interface CallsitePreset {
  mode: 'callsite';
  id: string;
  name: string;
  group: string;
  libFile: string;
  libCode: string;
  testFile: string;
  testCode: string;
  exportName: string;
  paramCount: number;
}

type Preset = SinglePreset | CallsitePreset;

const GROUP_CONTRACTS = 'Contracts & Observe';
const GROUP_BASIC = 'Basic Examples';
const GROUP_CALLSITE = 'Call-Site Discovery';
const GROUP_SEMANTICS = 'Language Semantics';

// 预设分组名 → 翻译 id（optgroup label 用）
const GROUP_LABEL_IDS: Record<string, string> = {
  [GROUP_CONTRACTS]: 'playground.group.contracts',
  [GROUP_BASIC]: 'playground.group.basic',
  [GROUP_CALLSITE]: 'playground.group.callsite',
  [GROUP_SEMANTICS]: 'playground.group.semantics',
};
function tGroup(group: string): string {
  const id = GROUP_LABEL_IDS[group];
  return id
    ? translate({ id, message: group })
    : group;
}

const presets: Preset[] = [
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'refine-positive',
    name: 'Refine — @nudo:contract positive',
    code: `/// @nudo:import { positive } from "./shapes.nudo.js"
// virtual template: positive = number().gt(0)

/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x;
}

needsPositive(3);
needsPositive(-1);
// Hover x: contract is x > 0; -1 is call-site evidence that violates check`,
  },
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'observe-scale',
    name: 'Observe — scale intermediate algebra',
    code: `export function scale(x) {
  return x + 1;
}

scale(5);
scale(0);`,
  },
  {
    mode: 'single',
    group: GROUP_CONTRACTS,
    id: 'debug-case',
    name: 'Debug case — concrete witness only',
    code: `/**
 * @nudo:case "double digits" (10)
 * @nudo:case "zero" (0)
 */
export function scale(x) {
  return x + 1;
}`,
  },
  { mode: 'single', group: GROUP_BASIC, id: 'basic-subtract', name: 'Call-site subtraction', code: `export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);` },
  { mode: 'single', group: GROUP_BASIC, id: 'string-transform', name: 'String Transform', code: `export function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

transform("hi");
transform(41);
transform(null);` },
  { mode: 'single', group: GROUP_BASIC, id: 'array-map', name: 'Array Map', code: `export function double(arr) {
  return arr.map(x => x * 2);
}

double([]);
double([1]);
double([1, 2, 3]);` },
  { mode: 'single', group: GROUP_BASIC, id: 'object-property', name: 'Object Property', code: `export function getName(obj) {
  return obj.name;
}

getName({ name: "test" });
getName({ name: "john", age: 30 });` },
  { mode: 'single', group: GROUP_BASIC, id: 'conditional-return', name: 'Conditional Return', code: `export function getValue(flag) {
  if (flag) return "yes";
  return "no";
}

getValue(true);
getValue(false);` },
  { mode: 'single', group: GROUP_BASIC, id: 'function-compose', name: 'Function Composition', code: `function addOne(x) { return x + 1; }
function double(x) { return x * 2; }

export function composed(n) {
  return double(addOne(n));
}

composed(5);` },
  { mode: 'single', group: GROUP_BASIC, id: 'null-handling', name: 'Null Handling', code: `export function greet(name) {
  return "Hello, " + (name || "World");
}

greet("hello");
greet(null);` },
  { mode: 'single', group: GROUP_BASIC, id: 'type-guard', name: 'Type Guard', code: `export function isString(value) {
  return typeof value === "string";
}

isString("test");
isString(42);` },
  { mode: 'single', group: GROUP_BASIC, id: 'recursion', name: 'Recursion', code: `export function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

factorial(5);
factorial(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'spread-operator', name: 'Spread Operator', code: `export function merge(a, b) {
  return [...a, ...b];
}

merge([1, 2], [3, 4]);` },
  { mode: 'single', group: GROUP_BASIC, id: 'ternary-operator', name: 'Ternary Operator', code: `export function classify(n) {
  return n > 0 ? "positive" : n < 0 ? "negative" : "zero";
}

classify(5);
classify(-3);
classify(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'default-param', name: 'Default Parameter', code: `export function greet(name = "World") {
  return "Hello, " + name + "!";
}

greet("world");
greet();` },
  { mode: 'single', group: GROUP_BASIC, id: 'discriminated-union', name: 'Discriminated Union', code: `export function area(shape) {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.width * shape.height;
  }
}

area({ kind: "circle", radius: 5 });
area({ kind: "rect", width: 10, height: 20 });` },
  { mode: 'single', group: GROUP_BASIC, id: 'optional-chaining', name: 'Optional Chaining', code: `export function getName(config) {
  return config.user?.profile?.name ?? "Anonymous";
}

getName({ user: { profile: { name: "Alice" } } });
getName({});` },
  { mode: 'single', group: GROUP_BASIC, id: 'truthiness-narrowing', name: 'Truthiness Narrowing', code: `export function process(val) {
  if (!val) return "empty";
  return val.toUpperCase();
}

process("hello");
process(null);
process(0);` },
  { mode: 'single', group: GROUP_BASIC, id: 'isarray-narrowing', name: 'Array.isArray Narrowing', code: `export function first(x) {
  if (Array.isArray(x)) return x[0];
  return x;
}

first([1, 2, 3]);
first("hello");` },
  { mode: 'single', group: GROUP_BASIC, id: 'in-operator', name: 'in Operator Narrowing', code: `export function sound(animal) {
  if ("bark" in animal) return "Woof!";
  if ("purr" in animal) return "Purr~";
  return "...";
}

sound({ name: "Rex", bark: true });
sound({ name: "Whiskers", purr: true });` },

  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-formatname',
    name: 'formatName — first precise signature',
    libFile: 'util.js',
    libCode: `export function formatName(first, last) {
  return first + ' ' + last;
}`,
    testFile: 'test.js',
    testCode: `import { formatName } from './util';

const full = formatName('Ada', 'Lovelace');`,
    exportName: 'formatName',
    paramCount: 2,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-wait',
    name: 'wait — Promise resolve scan',
    libFile: 'util.js',
    libCode: `export function wait(fn, timeout = 0) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fn()), timeout);
  });
}`,
    testFile: 'test.js',
    testCode: `import { wait } from './util';

const p = wait(() => 'done', 100);`,
    exportName: 'wait',
    paramCount: 2,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-uniq',
    name: 'uniq — Set iteration',
    libFile: 'util.js',
    libCode: `export function uniq(arr) {
  const s = new Set(arr);
  const out = [];
  for (const v of s) out.push(v);
  return out;
}`,
    testFile: 'test.js',
    testCode: `import { uniq } from './util';

const u = uniq([1, 2, 2, 3]);`,
    exportName: 'uniq',
    paramCount: 1,
  },
  {
    mode: 'callsite',
    group: GROUP_CALLSITE,
    id: 'cs-flat',
    name: 'flat — recursive calls + self-calls',
    libFile: 'util.js',
    libCode: `export function flat(a, t) {
  const r = t || [];
  for (const e of a) {
    if (Array.isArray(e)) flat(e, r);
    else r.push(e);
  }
  return r;
}`,
    testFile: 'test.js',
    testCode: `import { flat } from './util';

const f = flat([1, [2, [3, 4]]]);`,
    exportName: 'flat',
    paramCount: 2,
  },

  { mode: 'single', group: GROUP_SEMANTICS, id: 'promise-resolve-scan', name: 'Promise Resolve Scan', code: `export function wait(fn, timeout = 0) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fn()), timeout);
  });
}

wait(() => "done", 100);
wait(() => 42);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'set-iteration', name: 'Set Iteration (for-of)', code: `export function uniq(arr) {
  const s = new Set(arr);
  const out = [];
  for (const v of s) out.push(v);
  return out;
}

uniq([1, 2, 2, 3]);
uniq(["a", "a", "b"]);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'recursive-flatten', name: 'Recursive Flatten', code: `export function flat(a, t) {
  const r = t || [];
  for (const e of a) {
    if (Array.isArray(e)) flat(e, r);
    else r.push(e);
  }
  return r;
}

flat([1, [2, [3, 4]]]);
flat([5, 6]);` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'in-brand-check', name: 'in-operator Brand Check', code: `export function check(x) {
  if ("__nudo" in x) return x.__nudo;
  return "unbranded";
}

check({ __nudo: "real", value: 1 });
check({ value: 2 });` },
];

// ---------------------------------------------------------------------------
// Call-site discovery pipeline (mirrors the CLI's collectCallRecords flow,
// running fully in the browser via the evaluator facade)
// ---------------------------------------------------------------------------

interface DiscoveredCall {
  fnName: string;
  line: number | undefined;
  internal: boolean;
  args: Abs[];
  result: Abs;
}

interface CallsiteResult {
  records: DiscoveredCall[];
  beforeArgs: Abs[];
  before: Abs | null;
  afterArgs: Abs[] | null;
  after: Abs | null;
  afterSource: string;
  error: string | null;
}

/** Lines in the usage-site file where `name` is invoked — a record on one of
 * these lines is a usage-site call; anything else is a library-internal
 * (e.g. recursive) call recorded while the dependency was evaluated. */
function findUsageCallLines(ast: unknown, name: string): Set<number> {
  const lines = new Set<number>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as Record<string, unknown>;
    if (
      n['type'] === 'CallExpression' &&
      (n['callee'] as Record<string, unknown> | undefined)?.['type'] === 'Identifier' &&
      ((n['callee'] as Record<string, unknown>)['name'] as string) === name
    ) {
      const loc = n['loc'] as Record<string, Record<string, number>> | undefined;
      if (loc?.start?.line !== undefined) lines.add(loc.start.line);
    }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range' || key === 'comments') continue;
      visit(n[key]);
    }
  };
  visit(ast);
  return lines;
}

function discoverCallsites(
  libCode: string,
  testCode: string,
  exportName: string,
  paramCount: number,
): CallsiteResult {
  const unknownAbs = (): Abs => makeAbs({ k: "unknown" }, undefined, undefined, "partial");
  const result: CallsiteResult = {
    records: [],
    beforeArgs: Array.from({ length: paramCount }, () => unknownAbs()),
    before: null,
    afterArgs: null,
    after: null,
    afterSource: '',
    error: null,
  };

  let libProgram: any;
  try {
    libProgram = parse(libCode).program;
  } catch (e) {
    result.error = `library parse error: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }

  let testProgram: any;
  try {
    testProgram = parse(testCode).program;
  } catch (e) {
    result.error = `usage-site parse error: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }

  // Evaluate the library once via the B run, inject its exports under './util',
  // then run the usage site (exec + lenient globals) with B call collection.
  const records: { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean }[] = [];
  let libRun: Record<string, unknown> | undefined;
  try {
    libRun = runTranspiled(libCode, { mode: "analyze" });
    const libExports: AbsModuleExports = { named: {} };
    for (const [name, v] of Object.entries(libRun)) {
      if (v === undefined || v === null) continue;
      if (v && typeof v === "object" && "shape" in (v as object)) {
        libExports.named[name] = v as Abs;
      } else {
        // 裸 JS 函数导出：占位 fn 形状（导入绑定侧按 JS 函数直调）
        libExports.named[name] = makeAbs({ k: "fn", params: [] }, undefined, undefined, "exact");
      }
    }
    const modules: Record<string, AbsModuleExports> = {
      './util': libExports,
      './util.js': libExports,
    };
    const prev = setBCallCollector((r) => records.push(r));
    try {
      runTranspiled(testCode, { mode: "exec", modules, lenientGlobals: true });
    } finally {
      setBCallCollector(prev);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  const relevant = records.filter((r) => r.fnName === exportName);

  const usageLines = findUsageCallLines(testProgram, exportName);
  result.records = relevant.map((r) => ({
    fnName: r.fnName,
    line: r.callLoc?.line,
    internal: !(r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line)),
    args: r.args,
    result: r.threw ? makeAbs({ k: "never" }, undefined, undefined, "exact") : r.result,
  }));

  // Signature synthesis: entry-only (all params unknown) vs the injection of
  // the first usage-site record's argument types.
  try {
    if (libRun) {
      result.before = callTranspiledExportFull(libRun, exportName, result.beforeArgs).result;
      const topRecord = relevant.find(
        (r) => r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line),
      );
      if (topRecord) {
        result.afterArgs = topRecord.args;
        result.after = callTranspiledExportFull(libRun, exportName, topRecord.args).result;
        result.afterSource = `call@test.js:${topRecord.callLoc?.line}`;
      }
    }
  } catch (e) {
    result.error = result.error ?? (e instanceof Error ? e.message : String(e));
  }

  if (!result.before && !result.error) {
    result.error = `export "${exportName}" not found in library code`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single-pane case evaluation
// ---------------------------------------------------------------------------

function extractCases(code: string): CaseInfo[] {
  const cases: CaseInfo[] = [];
  try {
    const ast = parse(code);
    const directives = extractDirectives(ast);
    for (const fn of directives) {
      const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === 'case');
      for (const directive of caseDirectives) {
        cases.push({ name: directive.name, args: directive.argsAbs });
      }
    }
  } catch {}
  return cases;
}

function isPrecise(typeStr: string): boolean {
  return !/\bunknown\b/.test(typeStr);
}

const PLAYGROUND_FILE = '/playground.js';

const VIRTUAL_NUDO_MODULES: Record<string, string> = {
  'shapes.nudo.js': `import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const nonNeg = number().ge(0);
export const negative = number().lt(0);
export const percent = number().ge(0).le(100);
export const atLeast1 = number().ge(1);
export const delay = number().ge(0);
`,
  'std.nudo.js': `import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const nonNeg = number().ge(0);
export const negative = number().lt(0);
export const percent = number().ge(0).le(100);
export const atLeast1 = number().ge(1);
export const delay = number().ge(0);
`,
  'playground.nudo.js': `import { number, fn } from "@nudojs/core";
export const needsPositive = fn({ x: number().gt(0) }, number());
export const scale = fn({ x: number().gt(0) }, number());
`,
};

function playgroundLoadModule(spec: string, _fromFile: string): string | undefined {
  const base = spec.split(/[\\/]/).pop() ?? spec;
  if (VIRTUAL_NUDO_MODULES[base]) return VIRTUAL_NUDO_MODULES[base];
  if (VIRTUAL_NUDO_MODULES[spec]) return VIRTUAL_NUDO_MODULES[spec];
  if (base.endsWith('.nudo.js') || base.endsWith('.nudo.ts')) {
    return VIRTUAL_NUDO_MODULES['shapes.nudo.js'];
  }
  return undefined;
}

const PLAYGROUND_LOAD_OPTS = {
  loadModule: playgroundLoadModule,
  fromFile: PLAYGROUND_FILE,
};

const KNOWN_TEMPLATE_DISPLAY: Record<string, string> = {
  positive: 'number().gt(0)   // x > 0',
  nonNeg: 'number().ge(0)   // x >= 0',
  negative: 'number().lt(0)   // x < 0',
  percent: 'number().ge(0).le(100)',
  atLeast1: 'number().ge(1)',
  delay: 'number().ge(0)',
};

function contractMarkdownForWord(source: string, word: string): string[] {
  const raw = [
    ...source.matchAll(/@nudo:contract\s+(\w+)\s+([\w.]+)/g),
  ].filter((m) => m[1] === word);

  for (const m of raw) {
    const cName = m[2]!;
    const display = KNOWN_TEMPLATE_DISPLAY[cName];
    if (display) {
      return [
        `**contract** · \`@nudo:contract\` · virtual template \`${cName}\``,
        '```nudo',
        `${word}: ${display}`,
        '```',
        '_obligation — not the last call-site value_',
      ];
    }
  }

  try {
    if (typeof effectiveInterface === 'function' && typeof formatConstraint === 'function') {
      const fns = extractDirectives(parse(source));
      for (const fn of fns) {
        const eff = effectiveInterface(source, fn.name, PLAYGROUND_LOAD_OPTS);
        if (!eff) continue;
        const hit = eff.params.find((p) => p.param === word);
        if (!hit) continue;
        return [
          `**contract** · \`${eff.source}\` · fn \`${eff.fnName}\``,
          '```nudo',
          `${word}: ${formatConstraint(hit.constraint)}`,
          '```',
          '_obligation from `@nudo:contract` / sidecar — not the last call-site value_',
        ];
      }
    }
  } catch {
    // ignore
  }

  if (raw.length) {
    return [
      `**contract** · \`@nudo:contract\``,
      ...raw.map((m) => `- \`${m[1]}\` ← template \`${m[2]}\``),
    ];
  }
  return [];
}

function maybeViolationNote(contractLines: string[], absText: string | undefined): string[] {
  if (!absText || !contractLines.length) return [];
  const contractBlob = contractLines.join('\n');
  const mentionsPositive = /positive|number\(\)\.gt\(0\)|x > 0|x>0/.test(contractBlob);
  const observedNegative = /(^|\s)-\d/.test(absText);
  if (mentionsPositive && observedNegative) {
    return [
      '',
      '_call-site Abs includes a non-positive value — `nudo check` would report `actual ⊭ expected`_',
    ];
  }
  return [];
}

function buildActiveCases(source: string, caseIndex: number): Map<string, number> {
  const map = new Map<string, number>();
  try {
    for (const fn of extractDirectives(parse(source))) {
      if (fn.directives.some((d) => d.kind === 'case')) {
        map.set(fn.name, caseIndex);
      }
    }
  } catch {
    // ignore
  }
  return map;
}

function hoverToMarkdown(hover: HoverInfo, word?: string): string {
  const lines: string[] = [];
  if (word) lines.push(`**${word}**`);
  if (hover.interfaceSource) {
    const contractLabel =
      hover.interfaceSource === 'handwritten'
        ? 'contract / handwritten'
        : hover.interfaceSource === 'generated'
          ? 'contract / generated'
          : `contract / ${hover.interfaceSource}`;
    lines.push(`\`● ${contractLabel}\``);
    if (hover.interfaceDisplay && hover.interfaceSource !== 'implicit') {
      lines.push('```nudo', hover.interfaceDisplay, '```');
    }
  }
  if (hover.absMultiline) {
    lines.push('```nudo', hover.absMultiline, '```');
  } else if (hover.abs) {
    lines.push('```nudo', hover.abs, '```');
  }
  if (hover.intension && hover.intension !== hover.abs) {
    lines.push('```nudo', hover.intension, '```');
  }
  if (hover.typeText && hover.typeText !== hover.intension && hover.typeText !== hover.abs) {
    lines.push('```nudo', `ext: ${hover.typeText}`, '```');
  }
  return lines.join('\n');
}

function absInlayToMonaco(abs: AbsInlay, monaco: any) {
  return {
    kind:
      abs.kind === 'parameter'
        ? monaco.languages.InlayHintKind.Parameter
        : monaco.languages.InlayHintKind.Type,
    position: { lineNumber: abs.line, column: abs.character + 1 },
    label: abs.label,
    paddingLeft: true,
  };
}

function collectLspInlays(source: string, monaco: any): any[] {
  try {
    return collectAbsInlays(source, PLAYGROUND_LOAD_OPTS).map((a) =>
      absInlayToMonaco(a, monaco),
    );
  } catch {
    return [];
  }
}

function readSharedCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('code');
    if (!raw) return null;
    return decodeURIComponent(atob(raw));
  } catch {
    return null;
  }
}

/**
 * Self-contained Monarch for `nudo-js` — JS syntax colors without the
 * TypeScript language service (`parameter x: any` noise).
 */
const NUDO_JS_MONARCH = {
  defaultToken: '',
  tokenPostfix: '.js',
  ignoreCase: false,
  keywords: [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with',
    'yield', 'async', 'await', 'of', 'static', 'get', 'set', 'from', 'as',
  ],
  typeKeywords: [
    'any', 'boolean', 'number', 'object', 'string', 'symbol', 'unknown',
    'void', 'never', 'Array', 'Promise', 'Map', 'Set',
  ],
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>',
    '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=',
    '=>', '...',
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"'\n]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\{[0-9A-Fa-f]+\}|[0-7]{1,3})/,
  tokenizer: {
    root: [
      [/\/\*\*(?!\/)/, 'comment.doc', '@jsdoc'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
      [/[{}()\[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier',
          },
        },
      ],
      { include: '@whitespace' },
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/\d+\.\d*([eE][-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],
      [/[()]/, '@brackets'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
      [/`/, 'string', '@string_template'],
    ],
    whitespace: [[/[ \t\r\n]+/, '']],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    jsdoc: [
      [/[^/*]+/, 'comment.doc'],
      [/\*\//, 'comment.doc', '@pop'],
      [/[/*]/, 'comment.doc'],
    ],
    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],
    string_template: [
      [/[^\\`$]+/, 'string'],
      [/\$\{/, { token: 'delimiter', next: '@templateExpression' }],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/`/, 'string', '@pop'],
    ],
    templateExpression: [
      [/}/, { token: 'delimiter', next: '@pop' }],
      { include: 'root' },
    ],
  },
} as const;

const NUDO_JS_LANG_CONFIG = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '`', close: '`' },
  ],
} as const;

/** Register `nudo-js` with a built-in tokenizer (before models are created). */
function registerNudoJsLanguage(monaco: any): void {
  const LANG = 'nudo-js';
  const exists = monaco.languages
    .getLanguages()
    .some((l: { id: string }) => l.id === LANG);
  if (!exists) {
    monaco.languages.register({ id: LANG });
  }
  // Prefer a built-in tokenizer so highlighting never depends on JS LSP
  monaco.languages.setMonarchTokensProvider(LANG, NUDO_JS_MONARCH);
  try {
    monaco.languages.setLanguageConfiguration(LANG, NUDO_JS_LANG_CONFIG as any);
  } catch {
    // optional
  }
  // If the stock JS Monarch is available, merge its tokenizer as a richer base
  try {
    const jsMonarch = monaco.languages.getMonarchTokenProvider?.('javascript');
    if (jsMonarch?.tokenizer && jsMonarch !== NUDO_JS_MONARCH) {
      monaco.languages.setMonarchTokensProvider(LANG, {
        ...jsMonarch,
        tokenPostfix: jsMonarch.tokenPostfix ?? '.js',
      } as any);
    }
  } catch {
    // keep embedded monarch
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function readSharedCode2() { return readSharedCode(); }

function PlaygroundApp() {
  const [code, setCode] = useState(() => {
    const shared = readSharedCode();
    if (shared !== null && shared !== '') return shared;
    return presets[0].mode === 'single' ? presets[0].code : '';
  });
  const [testCode, setTestCode] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(presets[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const activeCaseIndexRef = useRef(activeCaseIndex);
  const [copied, setCopied] = useState(false);
  const [singleResults, setSingleResults] = useState<
    { name: string; fnName: string; args: Abs[]; result: Abs; throws: Abs }[] | null
  >(null);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [callsiteResult, setCallsiteResult] = useState<CallsiteResult | null>(null);

  const preset = presets.find((p) => p.id === selectedPreset) ?? presets[0];
  const isCallsiteMode = preset.mode === 'callsite';

  // Refs read by the Monaco providers (they are registered once on mount)
  const modeRef = useRef(isCallsiteMode);
  const testCodeRef = useRef(testCode);
  const usageRecordsRef = useRef<DiscoveredCall[]>([]);

  useEffect(() => {
    activeCaseIndexRef.current = activeCaseIndex;
  }, [activeCaseIndex]);
  useEffect(() => {
    const shared = readSharedCode();
    if (shared) setCode(shared);
  }, []);
  useEffect(() => {
    modeRef.current = isCallsiteMode;
  }, [isCallsiteMode]);
  useEffect(() => {
    testCodeRef.current = testCode;
  }, [testCode]);

  const cases = preset.mode === 'single' ? extractCases(code) : [];

  const runCallsiteDiscovery = (testSource: string, p: CallsitePreset): CallsiteResult => {
    const res = discoverCallsites(p.libCode, testSource, p.exportName, p.paramCount);
    usageRecordsRef.current = res.records.filter((r) => !r.internal);
    setCallsiteResult(res);
    return res;
  };

  const runSingle = () => {
    try {
      const analysis = analyzeFile(PLAYGROUND_FILE, code, undefined, undefined, playgroundLoadModule);
      const results: { name: string; fnName: string; args: Abs[]; result: Abs; throws: Abs }[] = [];
      for (const fn of analysis.functions) {
        for (const c of fn.cases) {
          results.push({
            name: c.name,
            fnName: fn.name,
            args: c.argAbs,
            result: c.abs,
            throws: c.throwsAbs,
          });
        }
      }
      setSingleResults(results);
      setSingleError(null);
    } catch (error) {
      setSingleError(error instanceof Error ? error.message : String(error));
      setSingleResults(null);
    }
  };

  const handlePresetChange = (presetId: string) => {
    const next = presets.find((p) => p.id === presetId);
    if (!next) return;
    setSelectedPreset(presetId);
    setActiveCaseIndex(0);
    setSingleResults(null);
    setSingleError(null);
    setCallsiteResult(null);
    usageRecordsRef.current = [];
    if (next.mode === 'single') {
      setCode(next.code);
    } else {
      setCode('');
      setTestCode(next.testCode);
      runCallsiteDiscovery(next.testCode, next);
    }
  };

  const runObserve = () => {
    setIsRunning(true);
    try {
      if (preset.mode === 'callsite') {
        runCallsiteDiscovery(testCode, preset);
      } else {
        runSingle();
      }
    } finally {
      setIsRunning(false);
    }
  };

  const shareUrl = () => {
    const encoded = btoa(encodeURIComponent(code));
    const url = new URL(window.location.href);
    url.searchParams.set('code', encoded);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    window.history.replaceState({}, '', url.toString());
  };

  const handleEditorBeforeMount = (monaco: any) => {
    try {
      registerNudoJsLanguage(monaco);
    } catch (e) {
      console.error('Failed to register nudo-js language', e);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    try {
      const LANG = 'nudo-js';
      registerNudoJsLanguage(monaco);
      try {
        const model = editor?.getModel?.();
        if (model) monaco.editor.setModelLanguage(model, LANG);
      } catch {
        // keep whatever language Monaco already assigned
      }

      // Mute TS/JS language service — Monarch on nudo-js still colors tokens
      const ts = monaco.languages?.typescript;
      const mute = {
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      };
      try {
        ts?.javascriptDefaults?.setDiagnosticsOptions?.(mute);
        ts?.typescriptDefaults?.setDiagnosticsOptions?.(mute);
      } catch { /* ignore */ }
      try {
        editor?.updateOptions?.({
          parameterHints: { enabled: false },
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
        });
      } catch { /* ignore */ }

      const provideHover = (model: any, position: any) => {
        const source = model.getValue();
        const word = model.getWordAtPosition(position);
        const currentCaseIndex = activeCaseIndexRef.current;
        const contractLines = word?.word ? contractMarkdownForWord(source, word.word) : [];

        try {
          const hover = getHoverAtPosition(
            PLAYGROUND_FILE,
            source,
            position.lineNumber,
            Math.max(0, position.column - 1),
            buildActiveCases(source, currentCaseIndex),
            PLAYGROUND_LOAD_OPTS,
          );
          if (hover) {
            const body = hoverToMarkdown(hover, word?.word);
            const parts = [
              ...contractLines,
              contractLines.length ? '**observed**' : '',
              contractLines.length ? body.replace(/^\*\*[^*]+\*\*\n/, '') : body,
              ...maybeViolationNote(contractLines, hover.abs ?? hover.typeText),
            ].filter(Boolean);
            return { contents: [{ value: parts.join('\n') }] };
          }
          if (contractLines.length && word?.word) {
            return {
              contents: [{ value: [`**${word.word}**`, ...contractLines].join('\n') }],
            };
          }
        } catch { /* fallback */ }

        const currentCases = extractCases(source);
        const activeCase = currentCases[currentCaseIndex];
        if (!activeCase || !word) return null;
        try {
          const functions = extractDirectives(parse(source));
          for (const fn of functions) {
            const node = fn.node as any;
            if (
              node.type === 'FunctionDeclaration' ||
              node.type === 'FunctionExpression' ||
              node.type === 'ArrowFunctionExpression'
            ) {
              const params = node.params || [];
              for (let i = 0; i < params.length; i++) {
                const param = params[i];
                if (param.type === 'Identifier' && param.name === word.word && i < activeCase.args.length) {
                  const arg = activeCase.args[i];
                  return {
                    contents: [
                      {
                        value: [
                          `**${word.word}** — active case \`${activeCase.name}\``,
                          '```nudo',
                          formatAbs(arg),
                          '```',
                        ].join('\n'),
                      },
                    ],
                  };
                }
              }
            }
          }
        } catch {}
        return null;
      };

      const provideInlayHints = (model: any) => {
        const hints: any[] = [];
        const source = model.getValue();
        try {
          if (modeRef.current && source === testCodeRef.current) {
            hints.push(...collectLspInlays(source, monaco));
            for (const record of usageRecordsRef.current) {
              if (record.line === undefined) continue;
              const lineLength = model.getLineLength(record.line);
              hints.push({
                kind: monaco.languages.InlayHintKind.Type,
                position: { lineNumber: record.line, column: lineLength + 1 },
                label: `=> ${formatAbs(record.result)}`,
                paddingLeft: true,
              });
            }
            return { hints, dispose() {} };
          }
          hints.push(...collectLspInlays(source, monaco));
          const ast = parse(source);
          const functions = extractDirectives(ast);
          const caseLines = new Map<string, number>();
          for (const fn of functions) {
            for (const d of fn.directives) {
              if (d.kind === 'case' && d.commentLine !== undefined) {
                caseLines.set(d.name, d.commentLine);
              }
            }
          }
          const analysis = analyzeFile(PLAYGROUND_FILE, source, undefined, undefined, playgroundLoadModule);
          for (const fn of analysis.functions) {
            for (const c of fn.cases) {
              if (!c.name) continue;
              // 只有带 commentLine 的指令见证能定位到源码行；合成 call@ 用例无行号。
              const line = caseLines.get(c.name);
              if (line === undefined) continue;
              const lineLength = model.getLineLength(line);
              hints.push({
                kind: monaco.languages.InlayHintKind.Type,
                position: { lineNumber: line, column: lineLength + 1 },
                label: `=> ${formatAbs(c.abs)}`,
                paddingLeft: true,
              });
            }
          }
        } catch {}
        return { hints, dispose() {} };
      };

      for (const lang of [LANG, 'javascript']) {
        monaco.languages.registerHoverProvider(lang, { provideHover });
        monaco.languages.registerInlayHintsProvider(lang, { provideInlayHints });
      }
    } catch (error) {
      console.error('Failed to register providers:', error);
    }
  };

  const editorOptions = (readOnly: boolean) => ({
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    readOnly,
    inlayHints: { enabled: 'on' as const },
  });

  const renderCaseCard = (
    keyId: string,
    label: string,
    argsStr: string,
    resultStr: string,
    precise: boolean,
    active: boolean,
  ) => (
    <div key={keyId} className={`cs-case-card${active ? ' cs-case-active' : ''}${precise ? ' cs-precise' : ' cs-unknown'}`}>
      <span className="cs-case-label">{label}</span>
      <span className="cs-case-sig">
        ({argsStr}) <span className="cs-arrow">=&gt;</span>{' '}
        <span className={precise ? 'cs-type-precise' : 'cs-type-unknown'}>{resultStr}</span>
      </span>
      <span className={`cs-badge ${precise ? 'cs-badge-precise' : 'cs-badge-unknown'}`}>
        {precise ? 'precise' : 'unknown'}
      </span>
    </div>
  );

  return (
    <div className="cs-playground">
        <h1>Nudo Playground</h1>
        <p className="cs-subtitle">
          <Translate id="playground.subtitle">
            Welcome back to JavaScript. Observe what your code computes on Abs, and gate contracts
            sharper than declared types. Hover for term / pred / conf and sidecar contracts.
          </Translate>
        </p>

        <div className="cs-controls">
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="preset-select"
          >
            {[GROUP_CONTRACTS, GROUP_BASIC, GROUP_CALLSITE, GROUP_SEMANTICS].map((group) => (
              <optgroup key={group} label={tGroup(group)}>
                {presets
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>

          {!isCallsiteMode && cases.length > 0 && (
            <select
              value={activeCaseIndex}
              onChange={(e) => setActiveCaseIndex(parseInt(e.target.value))}
              className="case-select"
            >
              {cases.map((c, i) => (
                <option key={i} value={i}>
                  <Translate
                    id="playground.caseLabel"
                    values={{ index: i + 1, name: c.name, args: c.args.map(a => formatShape(a)).join(', ') }}
                  >
                    {`Case {index}: "{name}" ({args})`}
                  </Translate>
                </option>
              ))}
            </select>
          )}

          {!isCallsiteMode && (
            <button onClick={shareUrl} className="share-button">
              {copied
                ? <Translate id="playground.copied">Copied!</Translate>
                : <Translate id="playground.share">Share</Translate>}
            </button>
          )}

          <button onClick={runObserve} disabled={isRunning} className="run-button">
            {isRunning
              ? <Translate id="playground.observing">Observing…</Translate>
              : <Translate id="playground.observe">Observe</Translate>}
          </button>
        </div>

        {isCallsiteMode && preset.mode === 'callsite' && (
          <>
            <div className="cs-explainer">
              <strong>
                <Translate id="playground.explainerLead">Call-Site Discovery.</Translate>
              </strong>{' '}
              <Translate id="playground.explainer">
                The library (left) ships without type annotations. Nudo evaluates the usage site
                (right), records the argument and result types of every real call, and
                re-synthesizes a precise signature — no inference-time unknowns left.
              </Translate>
            </div>

            <div className="cs-dual">
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">{preset.libFile}</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.libReadOnly">library · read-only</Translate></span>
                </div>
                <Suspense fallback={<div className="editor-loading"><Translate id="playground.loadingEditor">Loading editor…</Translate></div>}>
                  <MonacoEditor
                    height="min(420px, calc(100vh - 320px))"
                    defaultLanguage="nudo-js"
                    beforeMount={handleEditorBeforeMount}
                    value={preset.libCode}
                    theme="vs-light"
                    options={editorOptions(true)}
                  />
                </Suspense>
              </div>
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">{preset.testFile}</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.usageEditable">usage site · editable</Translate></span>
                </div>
                <Suspense fallback={<div className="editor-loading"><Translate id="playground.loadingEditor">Loading editor…</Translate></div>}>
                  <MonacoEditor
                    height="min(420px, calc(100vh - 320px))"
                    defaultLanguage="nudo-js"
                    beforeMount={handleEditorBeforeMount}
                    value={testCode}
                    onChange={(value) => {
                      const next = value || '';
                      setTestCode(next);
                      runCallsiteDiscovery(next, preset);
                    }}
                    onMount={handleEditorDidMount}
                    theme="vs-light"
                    options={editorOptions(false)}
                  />
                </Suspense>
              </div>
            </div>

            <div className="cs-results">
              {callsiteResult?.error && (
                <div className="cs-error"><Translate id="playground.error" values={{ message: callsiteResult.error }}>{`Error: {message}`}</Translate></div>
              )}

              {callsiteResult && callsiteResult.records.length > 0 && (
                <div className="cs-section">
                  <div className="cs-section-title">
                    <Translate id="playground.results.discovered">Discovered call records</Translate> <span className="cs-count">{callsiteResult.records.length}</span>
                  </div>
                  {callsiteResult.records.map((r, i) =>
                    renderCaseCard(
                      `rec-${i}`,
                      r.internal
                        ? `internal · util.js:${r.line ?? '?'}`
                        : `call@test.js:${r.line ?? '?'}`,
                      r.args.map(formatShape).join(', '),
                      formatShape(r.result),
                      isPrecise(formatShape(r.result)),
                      false,
                    ),
                  )}
                </div>
              )}

              {callsiteResult && callsiteResult.before !== null && (
                <div className="cs-section">
                  <div className="cs-section-title"><Translate id="playground.results.synth">Synthesized signature</Translate></div>
                  <div className="cs-synth">
                    <div className="cs-synth-card cs-unknown">
                      <div className="cs-synth-label"><Translate id="playground.results.before">Before · entry-only analysis</Translate></div>
                      {renderCaseCard(
                        'before',
                        preset.exportName,
                        callsiteResult.beforeArgs.map(formatShape).join(', '),
                        formatShape(callsiteResult.before),
                        isPrecise(formatShape(callsiteResult.before)),
                        false,
                      )}
                    </div>
                    <div className="cs-synth-arrow">&#10132;</div>
                    <div className="cs-synth-card cs-precise-frame">
                      <div className="cs-synth-label">
                        <Translate
                          id="playground.results.after"
                          values={{ source: callsiteResult.afterSource || 'call record' }}
                        >
                          {`After · injected from {source}`}
                        </Translate>
                      </div>
                      {callsiteResult.after !== null
                        ? renderCaseCard(
                            'after',
                            preset.exportName,
                            (callsiteResult.afterArgs ?? []).map(formatShape).join(', '),
                            formatShape(callsiteResult.after),
                            isPrecise(formatShape(callsiteResult.after)),
                            false,
                          )
                        : <div className="cs-type-unknown"><Translate id="playground.results.afterMissing">no usage-site call found</Translate></div>}
                    </div>
                  </div>
                </div>
              )}

              {callsiteResult && !callsiteResult.error && callsiteResult.records.length === 0 && (
                <div className="cs-hint">
                  <Translate
                    id="playground.hint.noRecords"
                    values={{ exportName: preset.exportName }}
                  >
                    {`No call records collected — make sure the usage site imports ./util and calls {exportName}.`}
                  </Translate>
                </div>
              )}
            </div>
          </>
        )}

        {!isCallsiteMode && (
          <>
            <div className="cs-dual cs-dual-editor-out">
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">source.js</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.editable">editable</Translate></span>
                </div>
                <Suspense fallback={<div className="editor-loading"><Translate id="playground.loadingEditor">Loading editor…</Translate></div>}>
                  <MonacoEditor
                    height="min(640px, calc(100vh - 220px))"
                    defaultLanguage="nudo-js"
                    beforeMount={handleEditorBeforeMount}
                    value={code}
                    onChange={(value) => setCode(value || '')}
                    onMount={handleEditorDidMount}
                    theme="vs-light"
                    options={editorOptions(false)}
                  />
                </Suspense>
              </div>
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">results</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.clickObserve">click Observe</Translate></span>
                </div>
                <div className="cs-results-pane">
                  {singleError && <div className="cs-error"><Translate id="playground.error" values={{ message: singleError }}>{`Error: {message}`}</Translate></div>}
                  {!singleError && !singleResults && (
                    <div className="cs-hint"><Translate id="playground.hint.observe">Click "Observe" to see inference results.</Translate></div>
                  )}
                  {!singleError && singleResults && singleResults.length === 0 && (
                    <div className="cs-hint">
                      <Translate id="playground.hint.noCases">
                        No call sites or cases found. Add a call site, or pick a Contracts &amp; Observe preset.
                      </Translate>
                    </div>
                  )}
                  {!singleError && singleResults && singleResults.length > 0 && (
                    <div className="cs-section">
                      <div className="cs-section-title">
                        <Translate id="playground.results.caseResults">Case results</Translate> <span className="cs-count">{singleResults.length}</span>
                      </div>
                      {singleResults.map((r, i) =>
                        renderCaseCard(
                          `case-${i}`,
                          `case "${r.name}" — ${r.fnName}`,
                          r.args.map(formatShape).join(', '),
                          formatShape(r.result),
                          isPrecise(formatShape(r.result)),
                          i === activeCaseIndex,
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
    </div>
  );
}

/**
 * Client-only shell: Monaco + analyzer must not SSR-hydrate (React #426).
 */
export default function Playground(): JSX.Element {
  return (
    <Layout
      title="Playground"
      description={translate({
        id: "playground.metaDescription",
        message: "Nudo Playground — execute JavaScript and observe intermediates",
      })}
    >
      <BrowserOnly
        fallback={
          <div className="playground-container">
            <div className="playground-header">
              <h1>Nudo Playground</h1>
              <p><Translate id="playground.loading">Loading playground…</Translate></p>
            </div>
          </div>
        }
      >
        {() => <PlaygroundApp />}
      </BrowserOnly>
    </Layout>
  );
}

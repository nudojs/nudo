import React, { lazy, useRef, useState, useEffect, Suspense } from 'react';
import Layout from '@theme/Layout';
import { parse, extractDirectives, type CaseDirective } from '@nudojs/parser';
import { typeValueToString, type TypeValue, createEnvironment, T } from '@nudojs/core';
import {
  evaluateFunctionFull,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  setCallCollector,
  resetMemo,
  type CallRecord,
} from '@nudojs/cli/evaluator';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface CaseInfo {
  name: string;
  args: TypeValue[];
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

const GROUP_BASIC = 'Basic Examples';
const GROUP_CALLSITE = 'Call-Site Discovery';
const GROUP_SEMANTICS = 'New Semantics';

const presets: Preset[] = [
  { mode: 'single', group: GROUP_BASIC, id: 'basic-subtract', name: 'Basic Subtraction', code: `// @nudo:case "positive numbers" (5, 3)
// @nudo:case "negative result" (1, 10)
// @nudo:case "symbolic" (T.number, T.number)
function subtract(a, b) {
  return a - b;
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'string-transform', name: 'String Transform', code: `// @nudo:case "strings" (T.string)
// @nudo:case "numbers" (T.number)
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'array-map', name: 'Array Map', code: `// @nudo:case "empty" ([])
// @nudo:case "single" ([1])
// @nudo:case "multiple" ([1, 2, 3])
function double(arr) {
  return arr.map(x => x * 2);
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'object-property', name: 'Object Property', code: `// @nudo:case "simple" ({ name: "test" })
// @nudo:case "with-age" ({ name: "john", age: 30 })
function getName(obj) {
  return obj.name;
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'conditional-return', name: 'Conditional Return', code: `// @nudo:case "true" (true)
// @nudo:case "false" (false)
function getValue(flag) {
  if (flag) return "yes";
  return "no";
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'function-compose', name: 'Function Composition', code: `// @nudo:case "simple" (5)
function addOne(x) { return x + 1; }
function double(x) { return x * 2; }

function composed(n) {
  return double(addOne(n));
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'null-handling', name: 'Null Handling', code: `// @nudo:case "with-value" ("hello")
// @nudo:case "null" (null)
function greet(name) {
  return "Hello, " + (name || "World");
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'type-guard', name: 'Type Guard', code: `// @nudo:case "string" ("test")
// @nudo:case "number" (42)
function isString(value) {
  return typeof value === "string";
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'recursion', name: 'Recursion', code: `// @nudo:case "factorial" (5)
// @nudo:case "zero" (0)
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'spread-operator', name: 'Spread Operator', code: `// @nudo:case "merge" ([1, 2], [3, 4])
function merge(a, b) {
  return [...a, ...b];
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'ternary-operator', name: 'Ternary Operator', code: `// @nudo:case "positive" (5)
// @nudo:case "negative" (-3)
// @nudo:case "zero" (0)
function classify(n) {
  return n > 0 ? "positive" : n < 0 ? "negative" : "zero";
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'default-param', name: 'Default Parameter', code: `// @nudo:case "with-param" ("world")
// @nudo:case "default" ()
function greet(name = "World") {
  return "Hello, " + name + "!";
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'discriminated-union', name: 'Discriminated Union', code: `// @nudo:case "circle" ({ kind: "circle", radius: 5 })
// @nudo:case "rect" ({ kind: "rect", width: 10, height: 20 })
function area(shape) {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.width * shape.height;
  }
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'optional-chaining', name: 'Optional Chaining', code: `// @nudo:case "full" ({ user: { profile: { name: "Alice" } } })
// @nudo:case "missing" ({})
function getName(config) {
  return config.user?.profile?.name ?? "Anonymous";
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'truthiness-narrowing', name: 'Truthiness Narrowing', code: `// @nudo:case "value" ("hello")
// @nudo:case "null" (null)
// @nudo:case "zero" (0)
function process(val) {
  if (!val) return "empty";
  return val.toUpperCase();
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'isarray-narrowing', name: 'Array.isArray Narrowing', code: `// @nudo:case "array" ([1, 2, 3])
// @nudo:case "string" ("hello")
function first(x) {
  if (Array.isArray(x)) return x[0];
  return x;
}` },
  { mode: 'single', group: GROUP_BASIC, id: 'in-operator', name: 'in Operator Narrowing', code: `// @nudo:case "dog" ({ name: "Rex", bark: true })
// @nudo:case "cat" ({ name: "Whiskers", purr: true })
function sound(animal) {
  if ("bark" in animal) return "Woof!";
  if ("purr" in animal) return "Purr~";
  return "...";
}` },

  // --- Call-Site Discovery: dual-pane, records collected from the usage site ---
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

  // --- New semantics: single-pane, exercised via @nudo:case + inlay hints ---
  { mode: 'single', group: GROUP_SEMANTICS, id: 'promise-resolve-scan', name: 'Promise Resolve Scan', code: `// @nudo:case "resolves literal" (() => "done", 100)
// @nudo:case "default timeout" (() => 42)
function wait(fn, timeout = 0) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fn()), timeout);
  });
}` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'set-iteration', name: 'Set Iteration (for-of)', code: `// @nudo:case "numbers" ([1, 2, 2, 3])
// @nudo:case "strings" (["a", "a", "b"])
function uniq(arr) {
  const s = new Set(arr);
  const out = [];
  for (const v of s) out.push(v);
  return out;
}` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'recursive-flatten', name: 'Recursive Flatten', code: `// @nudo:case "nested" ([1, [2, [3, 4]]])
// @nudo:case "already flat" ([5, 6])
function flat(a, t) {
  const r = t || [];
  for (const e of a) {
    if (Array.isArray(e)) flat(e, r);
    else r.push(e);
  }
  return r;
}` },
  { mode: 'single', group: GROUP_SEMANTICS, id: 'in-brand-check', name: 'in-operator Brand Check', code: `// @nudo:case "branded" ({ __nudo: "real", value: 1 })
// @nudo:case "unbranded" ({ value: 2 })
function check(x) {
  if ("__nudo" in x) return x.__nudo;
  return "unbranded";
}` },
];

// ---------------------------------------------------------------------------
// Call-site discovery pipeline (mirrors the CLI's collectCallRecords flow,
// running fully in the browser via the evaluator facade)
// ---------------------------------------------------------------------------

interface DiscoveredCall {
  fnName: string;
  line: number | undefined;
  internal: boolean;
  args: TypeValue[];
  result: TypeValue;
}

interface CallsiteResult {
  records: DiscoveredCall[];
  beforeArgs: TypeValue[];
  before: TypeValue | null;
  afterArgs: TypeValue[] | null;
  after: TypeValue | null;
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

function findExportedFunction(program: any, exportName: string): any | null {
  for (const stmt of program.body ?? []) {
    if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.declaration?.type === 'FunctionDeclaration' &&
      stmt.declaration.id?.name === exportName
    ) {
      return stmt;
    }
  }
  for (const stmt of program.body ?? []) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === exportName) return stmt;
  }
  return null;
}

function discoverCallsites(
  libCode: string,
  testCode: string,
  exportName: string,
  paramCount: number,
): CallsiteResult {
  const result: CallsiteResult = {
    records: [],
    beforeArgs: Array.from({ length: paramCount }, () => T.unknown),
    before: null,
    afterArgs: null,
    after: null,
    afterSource: '',
    error: null,
  };

  const records: CallRecord[] = [];
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

  // Evaluate the usage site with the library reachable through a module
  // resolver; every completed call (usage site AND library-internal) is
  // recorded with argument/result types.
  resetMemo();
  setModuleResolver((spec) => {
    if (spec === './util' || spec === './util.js') {
      return { ast: libProgram, filePath: '/lib/util.js' };
    }
    return null;
  });
  setCurrentFileDir('/test');
  setCallCollector((r) => records.push(r));
  try {
    evaluateProgram(testProgram, createEnvironment());
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    setCallCollector(null);
    setModuleResolver(null);
  }

  const relevant = records.filter(
    (r) => r.fnName === exportName || r.targetExport === exportName || (r.targetAliases ?? []).includes(exportName),
  );

  const usageLines = findUsageCallLines(testProgram, exportName);
  result.records = relevant.map((r) => ({
    fnName: r.fnName,
    line: r.callLoc?.line,
    internal: !(r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line)),
    args: r.argTypes,
    result: r.resultType,
  }));

  // Signature synthesis: entry-only (all params unknown) vs the injection of
  // the first usage-site record's argument types.
  const fnDecl = findExportedFunction(libProgram, exportName);
  if (fnDecl) {
    result.before = evaluateFunctionFull(fnDecl, result.beforeArgs, createEnvironment()).value;
    const topRecord = relevant.find(
      (r) => r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line),
    );
    if (topRecord) {
      result.afterArgs = topRecord.argTypes;
      result.after = evaluateFunctionFull(fnDecl, topRecord.argTypes, createEnvironment()).value;
      result.afterSource = `call@test.js:${topRecord.callLoc?.line}`;
    }
  } else {
    result.error = result.error ?? `export "${exportName}" not found in library code`;
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
        cases.push({ name: directive.name, args: directive.args });
      }
    }
  } catch {}
  return cases;
}

function isPrecise(typeStr: string): boolean {
  return !/\bunknown\b/.test(typeStr);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Playground() {
  const [code, setCode] = useState(presets[0].mode === 'single' ? presets[0].code : '');
  const [testCode, setTestCode] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(presets[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const activeCaseIndexRef = useRef(activeCaseIndex);
  const [copied, setCopied] = useState(false);
  const [singleResults, setSingleResults] = useState<
    { name: string; fnName: string; args: TypeValue[]; result: TypeValue; throws: TypeValue }[] | null
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
      const ast = parse(code);
      const env = createEnvironment();
      const directives = extractDirectives(ast);
      const results: { name: string; fnName: string; args: TypeValue[]; result: TypeValue; throws: TypeValue }[] = [];

      for (const fn of directives) {
        const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === 'case');
        for (const directive of caseDirectives) {
          const fullResult = evaluateFunctionFull(fn.node, directive.args, env);
          results.push({
            name: directive.name,
            fnName: fn.name,
            args: directive.args,
            result: fullResult.value,
            throws: fullResult.throws,
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

  const runInference = () => {
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

  const handleEditorDidMount = (_editor: any, monaco: any) => {
    try {
      // Hover provider - show parameter types on hover
      monaco.languages.registerHoverProvider('javascript', {
        provideHover: (model: any, position: any) => {
          const currentCaseIndex = activeCaseIndexRef.current;
          const currentCases = extractCases(model.getValue());
          const activeCase = currentCases[currentCaseIndex];

          if (!activeCase) return null;

          const word = model.getWordAtPosition(position);
          if (!word) return null;

          try {
            const ast = parse(model.getValue());
            const functions = extractDirectives(ast);

            for (const fn of functions) {
              const node = fn.node as any;
              if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
                const params = node.params || [];
                for (let i = 0; i < params.length; i++) {
                  const param = params[i];
                  if (param.type === "Identifier" && param.name === word.word) {
                    if (i < activeCase.args.length) {
                      return {
                        range: word.range,
                        contents: [{ value: `**${word.word}**: \`${typeValueToString(activeCase.args[i])}\`` }]
                      };
                    }
                  }
                }
              }
            }
          } catch {}

          return null;
        }
      });

      // Inlay hints: `=> result` after @nudo:case lines (single mode) and
      // after discovered usage-site call lines (call-site mode).
      monaco.languages.registerInlayHintsProvider('javascript', {
        provideInlayHints: (model: any) => {
          const hints: any[] = [];

          try {
            const source = model.getValue();

            // Call-site mode: annotate the usage-site editor at each
            // discovered call line with the harvested result type.
            if (modeRef.current && source === testCodeRef.current) {
              for (const record of usageRecordsRef.current) {
                if (record.line === undefined) continue;
                const lineLength = model.getLineLength(record.line);
                hints.push({
                  kind: monaco.languages.InlayHintKind.Type,
                  position: { lineNumber: record.line, column: lineLength + 1 },
                  label: `=> ${typeValueToString(record.result)}`,
                  paddingLeft: true,
                });
              }
              return { hints };
            }

            const ast = parse(source);
            const functions = extractDirectives(ast);
            const allCases: { fn: typeof functions[0], directive: CaseDirective }[] = [];

            for (const fn of functions) {
              const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === 'case');
              for (const directive of caseDirectives) {
                allCases.push({ fn, directive });
              }
            }

            // Show inlay hints for ALL cases
            for (const { fn, directive } of allCases) {
              const env = createEnvironment();
              const fullResult = evaluateFunctionFull(fn.node, directive.args, env);
              const resultStr = typeValueToString(fullResult.value);

              if (directive.commentLine) {
                const lineLength = model.getLineLength(directive.commentLine);
                hints.push({
                  kind: monaco.languages.InlayHintKind.Type,
                  position: { lineNumber: directive.commentLine, column: lineLength + 1 },
                  label: `=> ${resultStr}`,
                  paddingLeft: true,
                });
              }
            }
          } catch {}

          return { hints };
        }
      });
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
    inlayHints: { enabled: true },
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
    <Layout title="Playground" description="Nudo Playground">
      <div className="cs-playground">
        <h1>Nudo Playground</h1>
        <p className="cs-subtitle">
          Write JavaScript with <code>@nudo</code> directives — or switch to a Call-Site Discovery
          preset to watch types get harvested from real usage and injected back into library analysis.
        </p>

        <div className="cs-controls">
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="preset-select"
          >
            {[GROUP_BASIC, GROUP_CALLSITE, GROUP_SEMANTICS].map((group) => (
              <optgroup key={group} label={group}>
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
                  Case {i + 1}: "{c.name}" ({c.args.map(a => typeValueToString(a)).join(', ')})
                </option>
              ))}
            </select>
          )}

          {!isCallsiteMode && (
            <button onClick={shareUrl} className="share-button">
              {copied ? 'Copied!' : 'Share'}
            </button>
          )}

          <button onClick={runInference} disabled={isRunning} className="run-button">
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>

        {isCallsiteMode && preset.mode === 'callsite' && (
          <>
            <div className="cs-explainer">
              <strong>Call-Site Discovery.</strong> The library (left) ships without type
              annotations. Nudo evaluates the usage site (right), records the argument and result
              types of every real call, and re-synthesizes a precise signature — no inference-time
              unknowns left.
            </div>

            <div className="cs-dual">
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">{preset.libFile}</span>
                  <span className="cs-pane-tag">library · read-only</span>
                </div>
                <MonacoEditor
                  height="260px"
                  defaultLanguage="javascript"
                  value={preset.libCode}
                  theme="vs-light"
                  options={editorOptions(true)}
                />
              </div>
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">{preset.testFile}</span>
                  <span className="cs-pane-tag">usage site · editable</span>
                </div>
                <MonacoEditor
                  height="260px"
                  defaultLanguage="javascript"
                  value={testCode}
                  onChange={(value) => {
                    const next = value || '';
                    setTestCode(next);
                    // Small programs: re-collect call records synchronously so
                    // inlay hints and result cards track every keystroke.
                    runCallsiteDiscovery(next, preset);
                  }}
                  onMount={handleEditorDidMount}
                  theme="vs-light"
                  options={editorOptions(false)}
                />
              </div>
            </div>

            <div className="cs-results">
              {callsiteResult?.error && (
                <div className="cs-error">Error: {callsiteResult.error}</div>
              )}

              {callsiteResult && callsiteResult.records.length > 0 && (
                <div className="cs-section">
                  <div className="cs-section-title">
                    Discovered call records <span className="cs-count">{callsiteResult.records.length}</span>
                  </div>
                  {callsiteResult.records.map((r, i) =>
                    renderCaseCard(
                      `rec-${i}`,
                      r.internal
                        ? `internal · util.js:${r.line ?? '?'}`
                        : `call@test.js:${r.line ?? '?'}`,
                      r.args.map(typeValueToString).join(', '),
                      typeValueToString(r.result),
                      isPrecise(typeValueToString(r.result)),
                      false,
                    ),
                  )}
                </div>
              )}

              {callsiteResult && callsiteResult.before !== null && (
                <div className="cs-section">
                  <div className="cs-section-title">Synthesized signature</div>
                  <div className="cs-synth">
                    <div className="cs-synth-card cs-unknown">
                      <div className="cs-synth-label">Before · entry-only analysis</div>
                      {renderCaseCard(
                        'before',
                        preset.exportName,
                        callsiteResult.beforeArgs.map(typeValueToString).join(', '),
                        typeValueToString(callsiteResult.before),
                        isPrecise(typeValueToString(callsiteResult.before)),
                        false,
                      )}
                    </div>
                    <div className="cs-synth-arrow">&#10132;</div>
                    <div className="cs-synth-card cs-precise-frame">
                      <div className="cs-synth-label">
                        After · injected from {callsiteResult.afterSource || 'call record'}
                      </div>
                      {callsiteResult.after !== null
                        ? renderCaseCard(
                            'after',
                            preset.exportName,
                            (callsiteResult.afterArgs ?? []).map(typeValueToString).join(', '),
                            typeValueToString(callsiteResult.after),
                            isPrecise(typeValueToString(callsiteResult.after)),
                            false,
                          )
                        : <div className="cs-type-unknown">no usage-site call found</div>}
                    </div>
                  </div>
                </div>
              )}

              {callsiteResult && !callsiteResult.error && callsiteResult.records.length === 0 && (
                <div className="cs-hint">
                  No call records collected — make sure the usage site imports{' '}
                  <code>./util</code> and calls <code>{preset.exportName}</code>.
                </div>
              )}
            </div>
          </>
        )}

        {!isCallsiteMode && (
          <>
            <div className="cs-dual">
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">source.js</span>
                  <span className="cs-pane-tag">editable</span>
                </div>
                <MonacoEditor
                  height="420px"
                  defaultLanguage="javascript"
                  value={code}
                  onChange={(value) => setCode(value || '')}
                  onMount={handleEditorDidMount}
                  theme="vs-light"
                  options={editorOptions(false)}
                />
              </div>
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">results</span>
                  <span className="cs-pane-tag">click Run</span>
                </div>
                <div className="cs-results-pane">
                  {singleError && <div className="cs-error">Error: {singleError}</div>}
                  {!singleError && !singleResults && (
                    <div className="cs-hint">Click "Run" to see inference results.</div>
                  )}
                  {!singleError && singleResults && singleResults.length === 0 && (
                    <div className="cs-hint">
                      No @nudo:case directives found. Add cases to see type inference results.
                    </div>
                  )}
                  {!singleError && singleResults && singleResults.length > 0 && (
                    <div className="cs-section">
                      <div className="cs-section-title">
                        Case results <span className="cs-count">{singleResults.length}</span>
                      </div>
                      {singleResults.map((r, i) =>
                        renderCaseCard(
                          `case-${i}`,
                          `case "${r.name}" — ${r.fnName}`,
                          r.args.map(typeValueToString).join(', '),
                          typeValueToString(r.result),
                          isPrecise(typeValueToString(r.result)),
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
    </Layout>
  );
}

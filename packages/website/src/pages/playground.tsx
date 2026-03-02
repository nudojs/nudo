import React, { lazy, useRef, useState, useEffect, Suspense } from 'react';
import Layout from '@theme/Layout';
import { parse, extractDirectives, type CaseDirective } from '@nudojs/parser';
import { typeValueToString, type TypeValue, createEnvironment } from '@nudojs/core';
import { evaluateFunctionFull } from '@nudojs/cli/evaluator';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface CaseInfo {
  name: string;
  args: TypeValue[];
}

const presets = [
  { id: 'basic-subtract', name: 'Basic Subtraction', code: `// @nudo:case "positive numbers" (5, 3)
// @nudo:case "negative result" (1, 10)
// @nudo:case "symbolic" (T.number, T.number)
function subtract(a, b) {
  return a - b;
}` },
  { id: 'string-transform', name: 'String Transform', code: `// @nudo:case "strings" (T.string)
// @nudo:case "numbers" (T.number)
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}` },
  { id: 'array-map', name: 'Array Map', code: `// @nudo:case "empty" ([])
// @nudo:case "single" ([1])
// @nudo:case "multiple" ([1, 2, 3])
function double(arr) {
  return arr.map(x => x * 2);
}` },
  { id: 'object-property', name: 'Object Property', code: `// @nudo:case "simple" ({ name: "test" })
// @nudo:case "with-age" ({ name: "john", age: 30 })
function getName(obj) {
  return obj.name;
}` },
  { id: 'conditional-return', name: 'Conditional Return', code: `// @nudo:case "true" (true)
// @nudo:case "false" (false)
function getValue(flag) {
  if (flag) return "yes";
  return "no";
}` },
  { id: 'function-compose', name: 'Function Composition', code: `// @nudo:case "simple" (5)
function addOne(x) { return x + 1; }
function double(x) { return x * 2; }

function composed(n) {
  return double(addOne(n));
}` },
  { id: 'null-handling', name: 'Null Handling', code: `// @nudo:case "with-value" ("hello")
// @nudo:case "null" (null)
function greet(name) {
  return "Hello, " + (name || "World");
}` },
  { id: 'type-guard', name: 'Type Guard', code: `// @nudo:case "string" ("test")
// @nudo:case "number" (42)
function isString(value) {
  return typeof value === "string";
}` },
  { id: 'recursion', name: 'Recursion', code: `// @nudo:case "factorial" (5)
// @nudo:case "zero" (0)
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}` },
  { id: 'spread-operator', name: 'Spread Operator', code: `// @nudo:case "merge" ([1, 2], [3, 4])
function merge(a, b) {
  return [...a, ...b];
}` },
  { id: 'ternary-operator', name: 'Ternary Operator', code: `// @nudo:case "positive" (5)
// @nudo:case "negative" (-3)
// @nudo:case "zero" (0)
function classify(n) {
  return n > 0 ? "positive" : n < 0 ? "negative" : "zero";
}` },
  { id: 'default-param', name: 'Default Parameter', code: `// @nudo:case "with-param" ("world")
// @nudo:case "default" ()
function greet(name = "World") {
  return "Hello, " + name + "!";
}` },
];

function extractCases(code: string): CaseInfo[] {
  const cases: CaseInfo[] = [];
  try {
    const ast = parse(code);
    const directives = extractDirectives(ast);
    for (const fn of directives) {
      const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
      for (const directive of caseDirectives) {
        cases.push({ name: directive.name, args: directive.args });
      }
    }
  } catch {}
  return cases;
}

export default function Playground() {
  const [code, setCode] = useState(presets[0].code);
  const [output, setOutput] = useState('Click "Run" to see inference results');
  const [isRunning, setIsRunning] = useState(false);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const activeCaseIndexRef = useRef(activeCaseIndex);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].id);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    activeCaseIndexRef.current = activeCaseIndex;
  }, [activeCaseIndex]);

  const cases = extractCases(code);

  const handlePresetChange = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      setSelectedPreset(presetId);
      setCode(preset.code);
      setActiveCaseIndex(0);
      setOutput('Click "Run" to see inference results');
    }
  };

  const runInference = () => {
    setIsRunning(true);
    try {
      const ast = parse(code);
      const env = createEnvironment();
      const directives = extractDirectives(ast);
      const allCases: { fn: typeof directives[0], directive: typeof directives[0]['directives'][0] }[] = [];
      
      for (const fn of directives) {
        const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
        for (const directive of caseDirectives) {
          allCases.push({ fn, directive });
        }
      }
      
      const activeCase = allCases[activeCaseIndex];
      
      if (activeCase) {
        const { fn, directive } = activeCase;
        const fullResult = evaluateFunctionFull(fn.node, directive.args, env);
        const argsStr = directive.args.map(typeValueToString).join(', ');
        const resultStr = typeValueToString(fullResult.value);
        
        setOutput(`=== ${fn.name} ===\nCase "${directive.name}": (${argsStr}) => ${resultStr}\n\nSelected Case Result: ${resultStr}`);
      } else if (allCases.length === 0) {
        setOutput('No @nudo:case directives found. Add cases to see type inference results.');
      }
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
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

      // Inlay hints provider - show type inference after @nudo:case lines
      monaco.languages.registerInlayHintsProvider('javascript', {
        provideInlayHints: (model: any) => {
          const currentCaseIndex = activeCaseIndexRef.current;
          const hints: any[] = [];

          try {
            const code = model.getValue();
            const ast = parse(code);
            const functions = extractDirectives(ast);
            const allCases: { fn: typeof functions[0], directive: typeof functions[0]['directives'][0], index: number }[] = [];
            let caseIndex = 0;
            
            for (const fn of functions) {
              const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
              for (const directive of caseDirectives) {
                allCases.push({ fn, directive, index: caseIndex });
                caseIndex++;
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

  return (
    <Layout title="Playground" description="Nudo Playground">
      <div style={{ padding: '20px', minHeight: "calc(100vh - 200px)", background: "#f5f5f5" }}>
        <h1>Nudo Playground</h1>
        <p style={{ color: '#666' }}>Write JavaScript code with @nudo directives and see the type inference results</p>

        <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
          >
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {cases.length > 0 && (
            <select
              value={activeCaseIndex}
              onChange={(e) => setActiveCaseIndex(parseInt(e.target.value))}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '250px' }}
            >
              {cases.map((c, i) => (
                <option key={i} value={i}>
                  Case {i + 1}: "{c.name}" ({c.args.map(a => typeValueToString(a)).join(', ')})
                </option>
              ))}
            </select>
          )}

          <button
            onClick={shareUrl}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}
          >
            {copied ? 'Copied!' : 'Share'}
          </button>

          <button
            onClick={runInference}
            disabled={isRunning}
            style={{ padding: '8px 20px', borderRadius: '4px', border: 'none', background: '#007bff', color: 'white', cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.7 : 1 }}
          >
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', minHeight: "calc(100vh - 250px)" }}>
          <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            <MonacoEditor
              height="100%"
              defaultLanguage="javascript"
              value={code}
              onChange={(value) => setCode(value || '')}
              onMount={handleEditorDidMount}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                inlayHints: { enabled: true },
              }}
            />
          </div>

          <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '15px', background: "#1e1e1e", color: "#d4d4d4", overflow: 'auto', fontFamily: 'monospace', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
            {output}
          </div>
        </div>
      </div>
    </Layout>
  );
}

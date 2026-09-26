import React, { lazy, useRef, useState, useEffect, Suspense } from 'react';
import Translate from '@docusaurus/Translate';
import { parse, extractDirectives } from '@nudojs/parser';
import {
  formatShape,
  formatAbs,
  type Abs,
} from '@nudojs/core';
import { analyzeFile } from '@nudojs/service';
import { getHoverAtPosition } from '@nudojs/lsp';
import type {
  CallsitePreset,
  DiscoveredCall,
  CallsiteResult,
} from './types';
import {
  presets,
  GROUP_CONTRACTS,
  GROUP_BASIC,
  GROUP_CALLSITE,
  GROUP_SEMANTICS,
  tGroup,
} from './presets';
import { discoverCallsites } from './callsites';
import {
  PLAYGROUND_FILE,
  playgroundLoadModule,
  PLAYGROUND_LOAD_OPTS,
  extractCases,
  isPrecise,
  contractMarkdownForWord,
  maybeViolationNote,
  buildActiveCases,
  hoverToMarkdown,
  collectLspInlays,
} from './engine';
import { registerNudoJsLanguage } from './monaco-lang';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlaygroundApp() {
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

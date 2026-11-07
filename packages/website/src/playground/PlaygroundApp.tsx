import React, { lazy, useRef, useState, useEffect, Suspense } from 'react';
import Translate from '@docusaurus/Translate';
import { parse, extractDirectives } from '@nudojs/parser';
import {
  formatShape,
  formatAbs,
  type Abs,
  type CheckIssue,
  type CheckReport,
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
} from './presets';
import { tGroup, tPresetName } from './preset-labels';
import { discoverCallsites } from './callsites';
import {
  buildShareLink,
  parseShareParams,
  decodeShareValue,
} from './share';
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
  runPlaygroundCheck,
  setPlaygroundSidecar,
} from './engine';
import { registerNudoJsLanguage } from './monaco-lang';
// 自托管 monaco（jsdelivr CDN → 本地 chunk）；必须先于首个 <Editor> 挂载。
// 本文件本身只在 /playground 路由 chunk 内被加载。
import './monaco-local';
import { monaco } from './monaco-local';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// 分享链接从 location.hash 读取（#code=&sidecar=&preset=）；已发布站点的旧
// ?code= 链接仍可打开：hash 命中优先，search 只做外链兜底（读取后防抖同步
// 会把 URL 规范成 hash 形态）。
function readSharedState(): { code: string | null; sidecar: string | null; presetId: string | null } {
  if (typeof window === 'undefined') return { code: null, sidecar: null, presetId: null };
  const fromHash = parseShareParams(window.location.hash);
  if (fromHash.code !== null || fromHash.sidecar !== null || fromHash.preset !== null) {
    return { code: fromHash.code, sidecar: fromHash.sidecar, presetId: fromHash.preset };
  }
  const search = new URLSearchParams(window.location.search);
  return {
    code: decodeShareValue(search.get('code')),
    sidecar: decodeShareValue(search.get('sidecar')),
    presetId: search.get('preset'),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** tsc 对照面板的一条 monaco marker（TypeScript 诊断） */
interface TscDiag {
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export default function PlaygroundApp() {
  const [code, setCode] = useState(() => {
    const shared = readSharedState().code;
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
  const [sidecarCode, setSidecarCode] = useState('');
  const [checkResult, setCheckResult] = useState<CheckReport | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  // 分享链接：截断提示（保留的源码字符数）/ 复制失败提示
  const [linkNoticeChars, setLinkNoticeChars] = useState<number | null>(null);
  const [linkCopyFailed, setLinkCopyFailed] = useState(false);
  // tsc 对照面板（默认关：开启才拉取 TS 语言服务 worker chunk）
  const [tscOn, setTscOn] = useState(false);
  const [tscStatus, setTscStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [tscDiags, setTscDiags] = useState<TscDiag[] | null>(null);

  const preset = presets.find((p) => p.id === selectedPreset) ?? presets[0];
  const isCallsiteMode = preset.mode === 'callsite';
  const isSidecarMode = preset.mode === 'sidecar';

  // Refs read by the Monaco providers (they are registered once on mount)
  const modeRef = useRef(isCallsiteMode);
  const testCodeRef = useRef(testCode);
  const usageRecordsRef = useRef<DiscoveredCall[]>([]);

  useEffect(() => {
    activeCaseIndexRef.current = activeCaseIndex;
  }, [activeCaseIndex]);
  useEffect(() => {
    const shared = readSharedState();
    const linked = shared.presetId ? presets.find((p) => p.id === shared.presetId) : undefined;
    if (shared.sidecar !== null) {
      // 显式 sidecar 参数：sidecar 布局（优先链接里的 preset，否则首个 sidecar 预设）
      const sidecarPreset = linked?.mode === 'sidecar' ? linked : presets.find((p) => p.mode === 'sidecar');
      if (sidecarPreset) {
        setSelectedPreset(sidecarPreset.id);
        setCode(shared.code && shared.code !== '' ? shared.code : sidecarPreset.mainCode);
        setSidecarCode(shared.sidecar);
        setPlaygroundSidecar(sidecarPreset.sidecarFile, shared.sidecar);
        return;
      }
    }
    if (linked) {
      // preset 参数决定布局；code 填进该布局的可编辑源码位
      setSelectedPreset(linked.id);
      if (linked.mode === 'callsite') {
        setPlaygroundSidecar(null, '');
        const test = shared.code ?? linked.testCode;
        setTestCode(test);
        runCallsiteDiscovery(test, linked);
      } else if (linked.mode === 'sidecar') {
        setCode(shared.code ?? linked.mainCode);
        setSidecarCode(linked.sidecarCode);
        setPlaygroundSidecar(linked.sidecarFile, linked.sidecarCode);
      } else {
        setPlaygroundSidecar(null, '');
        setCode(shared.code ?? linked.code);
      }
      return;
    }
    if (shared.code) setCode(shared.code);
    else if (presets[0].mode === 'sidecar') {
      // 首个预设即 sidecar 时：主/侧车内容 + 虚拟模块注册一次到位
      setCode(presets[0].mainCode);
      setSidecarCode(presets[0].sidecarCode);
      setPlaygroundSidecar(presets[0].sidecarFile, presets[0].sidecarCode);
    }
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

  // Sidecar 模式：checkSource 经注册进虚拟模块表的侧车内容执法（ambient
  // 同名绑定），报告 = 签名表 + actual ⊭ expected 契约违规
  const runSidecarCheck = () => {
    try {
      setCheckResult(runPlaygroundCheck(code));
      setCheckError(null);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
      setCheckResult(null);
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
    setCheckResult(null);
    setCheckError(null);
    usageRecordsRef.current = [];
    if (next.mode === 'single') {
      setPlaygroundSidecar(null, '');
      setCode(next.code);
    } else if (next.mode === 'sidecar') {
      setCode(next.mainCode);
      setSidecarCode(next.sidecarCode);
      setPlaygroundSidecar(next.sidecarFile, next.sidecarCode);
    } else {
      setPlaygroundSidecar(null, '');
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
      } else if (preset.mode === 'sidecar') {
        runSidecarCheck();
      } else {
        runSingle();
      }
    } finally {
      setIsRunning(false);
    }
  };

  // 分享链接：源码 + 预设 id 编码进 location.hash。超长按预算截断（share.ts），
  // 截断/复制失败都在工具栏给提示；同时把地址栏规范成 hash 形态（清掉旧 ?code=）。
  const copyLink = () => {
    const base = window.location.origin + window.location.pathname;
    const link = buildShareLink(base, {
      preset: selectedPreset,
      code: isCallsiteMode ? testCode : code,
      sidecar: isSidecarMode ? sidecarCode : undefined,
    });
    window.history.replaceState(null, '', link.url);
    navigator.clipboard.writeText(link.url).then(
      () => {
        setCopied(true);
        setLinkCopyFailed(false);
        setTimeout(() => setCopied(false), 2000);
        if (link.truncatedCode || link.truncatedSidecar) {
          setLinkNoticeChars(link.codeChars);
          setTimeout(() => setLinkNoticeChars(null), 6000);
        } else {
          setLinkNoticeChars(null);
        }
      },
      () => setLinkCopyFailed(true),
    );
  };

  // hash 防抖回写：编辑/切预设 600ms 后把当前状态写回地址栏（replaceState 不产生
  // 历史条目）。恢复路径与此收敛：载入分享链接后重算的 hash 与现状一致则不动。
  const shareCode = isCallsiteMode ? testCode : code;
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const base = window.location.origin + window.location.pathname;
        const link = buildShareLink(base, {
          preset: selectedPreset,
          code: shareCode,
          sidecar: isSidecarMode ? sidecarCode : undefined,
        });
        if (window.location.href !== link.url) {
          window.history.replaceState(null, '', link.url);
        }
      } catch {
        // 链接同步失败绝不打断编辑
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [shareCode, sidecarCode, selectedPreset, isSidecarMode]);

  // tsc 对照面板：离屏 monaco model（javascript）跑 TypeScript 语言服务，
  // markers 即 tsc 诊断，与 Nudo 输出并列渲染。开关关闭时不占用 worker。
  const tscSource = isCallsiteMode ? testCode : code;
  const tscSourceRef = useRef(tscSource);
  const tscModelRef = useRef<any>(null);
  const tscActiveRef = useRef(false);
  useEffect(() => {
    tscSourceRef.current = tscSource;
  }, [tscSource]);
  useEffect(() => {
    if (!tscOn) {
      tscActiveRef.current = false;
      tscModelRef.current = null;
      setTscDiags(null);
      return;
    }
    tscActiveRef.current = true;
    // monaco 0.57 布局：TS defaults 在顶层 monaco.typescript 命名空间
    // （languages.typescript 已随 ESM 重构移除）；旧布局路径留兜底
    const ts = (monaco as any).typescript ?? (monaco.languages as any).typescript;
    if (!ts?.javascriptDefaults) {
      setTscStatus('unavailable');
      return;
    }
    setTscStatus('loading');
    ts.javascriptDefaults.setEagerModelSync?.(true);
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    });
    ts.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    });
    const model = monaco.editor.createModel(
      tscSourceRef.current,
      'javascript',
      monaco.Uri.parse('file:///playground-tsc.js'),
    );
    tscModelRef.current = model;
    const sub = monaco.editor.onDidChangeMarkers(() => {
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      setTscStatus('ready');
      setTscDiags(
        markers.map((mk: any): TscDiag => ({
          line: mk.startLineNumber,
          col: mk.startColumn,
          severity:
            mk.severity === monaco.MarkerSeverity.Error
              ? 'error'
              : mk.severity === monaco.MarkerSeverity.Warning
                ? 'warning'
                : 'info',
          message: mk.message,
        })),
      );
    });
    return () => {
      sub.dispose();
      model.dispose();
      tscModelRef.current = null;
      tscActiveRef.current = false;
      try {
        ts.javascriptDefaults.setEagerModelSync?.(false);
        ts.javascriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
          noSuggestionDiagnostics: true,
        });
      } catch {
        // ignore
      }
    };
  }, [tscOn]);
  // 面板开着时把编辑中的源码同步进离屏 model，markers 异步回推
  useEffect(() => {
    if (!tscOn || !tscModelRef.current) return;
    if (tscModelRef.current.getValue() !== tscSource) {
      setTscStatus('loading');
      tscModelRef.current.setValue(tscSource);
    }
  }, [tscSource, tscOn]);

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

      // Mute TS/JS language service — Monarch on nudo-js still colors tokens.
      // monaco 0.57：defaults 在顶层 monaco.typescript（languages.typescript 已移除）。
      // tsc 面板开着时不静音（编辑器重挂载，如切换预设，不得把面板的 worker 静掉）
      const ts = (monaco as any).typescript ?? (monaco.languages as any).typescript;
      const mute = {
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true,
      };
      if (!tscActiveRef.current) {
        try {
          ts?.javascriptDefaults?.setDiagnosticsOptions?.(mute);
          ts?.typescriptDefaults?.setDiagnosticsOptions?.(mute);
        } catch { /* ignore */ }
      }
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
        } catch {
          // Hover 是尽力而为的编辑器增强：输入中的代码常处于语法未完状态，
          // 解析/分析失败时返回 null（不显示 hover）是预期降级，不应打断编辑。
        }
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
        } catch {
          // Inlay hints 同上：分析失败时返回已收集到的 hints（可能为空），
          // 不打断输入；provider 注册本身失败才走下面的 console.error。
        }
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

  // check 门禁违规卡片：L 行号 · 函数 + actual ⊭ expected + 修复建议
  const renderIssueCard = (keyId: string, issue: CheckIssue) => (
    <div key={keyId} className={`cs-case-card cs-issue-${issue.severity}`}>
      <span className="cs-case-label">
        [{issue.severity.toUpperCase()}
        {issue.line !== undefined ? ` L${issue.line}` : ''}
        {issue.fn ? ` · ${issue.fn}` : ''}]
      </span>
      <span className="cs-case-sig">
        {issue.message}
        {issue.actual !== undefined && (
          <>
            {' — '}
            <span className="cs-issue-actual">{issue.actual}</span>{' '}
            <span className="cs-arrow">⊭</span>{' '}
            <span className="cs-issue-expected">{issue.expected}</span>
          </>
        )}
      </span>
      <span className={`cs-badge cs-badge-${issue.severity}`}>{issue.code}</span>
      {issue.suggestion && <div className="cs-issue-fix">→ {issue.suggestion}</div>}
    </div>
  );

  // tsc 对照面板：TypeScript 语言服务对同一源码的诊断，与 Nudo 输出并列
  const renderTscSection = () =>
    tscOn ? (
      <div className="cs-section">
        <div className="cs-section-title">
          <Translate id="playground.tsc.title">TypeScript (tsc)</Translate>{' '}
          <span className="cs-count">{tscDiags?.length ?? 0}</span>
        </div>
        {tscStatus === 'unavailable' && (
          <div className="cs-hint">
            <Translate id="playground.tsc.unavailable">
              tsc unavailable — monaco TypeScript language service not loaded
            </Translate>
          </div>
        )}
        {tscStatus === 'loading' && (
          <div className="cs-hint">
            <Translate id="playground.tsc.loading">
              TypeScript worker computing… (first toggle downloads the worker)
            </Translate>
          </div>
        )}
        {tscStatus === 'ready' && tscDiags && tscDiags.length > 0 && (
          tscDiags.map((d, i) => (
            <div key={`tsc-${i}`} className={`cs-case-card cs-issue-${d.severity}`}>
              <span className="cs-case-label">
                [TS L{d.line}:{d.col}]
              </span>
              <span className="cs-case-sig">{d.message}</span>
            </div>
          ))
        )}
        {tscStatus === 'ready' && tscDiags && tscDiags.length === 0 && (
          <div className="cs-hint">
            <Translate id="playground.tsc.none">no TypeScript diagnostics</Translate>
          </div>
        )}
      </div>
    ) : null;

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
                    <option key={p.id} value={p.id}>{tPresetName(p)}</option>
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

          <button onClick={copyLink} className="share-button">
            {copied
              ? <Translate id="playground.copied">Copied!</Translate>
              : <Translate id="playground.copyLink">Copy link</Translate>}
          </button>

          <button
            onClick={() => setTscOn((v) => !v)}
            className={`share-button cs-toggle${tscOn ? ' cs-toggle-on' : ''}`}
            title="Toggle TypeScript (tsc) diagnostics side-by-side with Nudo output"
          >
            tsc
          </button>

          {linkNoticeChars !== null && (
            <span className="cs-share-note">
              <Translate
                id="playground.shareTruncated"
                values={{ count: linkNoticeChars }}
              >
                {'link truncated — source kept to {count} chars'}
              </Translate>
            </span>
          )}
          {linkCopyFailed && (
            <span className="cs-share-note">
              <Translate id="playground.shareClipboardFail">
                copy failed — copy the URL from the address bar
              </Translate>
            </span>
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
                      r.args.map(a => formatShape(a)).join(', '),
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
                        callsiteResult.beforeArgs.map(a => formatShape(a)).join(', '),
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
                            (callsiteResult.afterArgs ?? []).map(a => formatShape(a)).join(', '),
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

              {renderTscSection()}
            </div>
          </>
        )}

        {isSidecarMode && preset.mode === 'sidecar' && (
          <>
            <div className="cs-explainer">
              <strong>
                <Translate id="playground.sidecarLead">Sidecar Contract.</Translate>
              </strong>{' '}
              <Translate id="playground.sidecarExplainer">
                The source (left) stays plain JavaScript — zero annotations. The .nudo.js sidecar
                (right) declares the obligation; Nudo binds it by file adjacency and gates every
                call site through check. scale(0) reports actual ⊭ expected — fix the call or
                relax the contract.
              </Translate>
            </div>

            <div className="cs-dual">
              <div className="cs-pane">
                <div className="cs-pane-header">
                  <span className="cs-pane-file">{preset.mainFile}</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.mainEditable">source · editable</Translate></span>
                </div>
                <Suspense fallback={<div className="editor-loading"><Translate id="playground.loadingEditor">Loading editor…</Translate></div>}>
                  <MonacoEditor
                    height="min(420px, calc(100vh - 320px))"
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
                  <span className="cs-pane-file">{preset.sidecarFile}</span>
                  <span className="cs-pane-tag"><Translate id="playground.tag.sidecarEditable">sidecar · editable</Translate></span>
                </div>
                <Suspense fallback={<div className="editor-loading"><Translate id="playground.loadingEditor">Loading editor…</Translate></div>}>
                  <MonacoEditor
                    height="min(420px, calc(100vh - 320px))"
                    defaultLanguage="nudo-js"
                    beforeMount={handleEditorBeforeMount}
                    value={sidecarCode}
                    onChange={(value) => {
                      const next = value || '';
                      setSidecarCode(next);
                      // 立即重注册：主编辑器悬停/inlay 与下次 Observe 都读到最新契约
                      setPlaygroundSidecar(preset.sidecarFile, next);
                    }}
                    onMount={handleEditorDidMount}
                    theme="vs-light"
                    options={editorOptions(false)}
                  />
                </Suspense>
              </div>
            </div>

            <div className="cs-results">
              {checkError && (
                <div className="cs-error"><Translate id="playground.error" values={{ message: checkError }}>{`Error: {message}`}</Translate></div>
              )}

              {!checkError && checkResult && (
                <>
                  <div className={`cs-check-status ${checkResult.ok ? 'cs-check-ok' : 'cs-check-fail'}`}>
                    {checkResult.ok
                      ? <Translate id="playground.check.ok">OK</Translate>
                      : <Translate id="playground.check.failed">FAILED</Translate>}
                    {'  '}
                    {checkResult.summary.errors} error · {checkResult.summary.warnings} warning ·{' '}
                    {checkResult.summary.infos} info · {checkResult.summary.functions} fn
                  </div>

                  {checkResult.signatures.length > 0 && (
                    <div className="cs-section">
                      <div className="cs-section-title">
                        <Translate id="playground.results.signatures">Signatures</Translate>{' '}
                        <span className="cs-count">{checkResult.signatures.length}</span>
                      </div>
                      {checkResult.signatures.map((s, i) =>
                        renderCaseCard(
                          `sig-${i}`,
                          s.name,
                          (s.paramTypes ?? s.params.map(() => 'any')).join(', '),
                          s.display,
                          isPrecise(s.display),
                          false,
                        ),
                      )}
                    </div>
                  )}

                  <div className="cs-section">
                    <div className="cs-section-title">
                      <Translate id="playground.results.issues">Issues</Translate>{' '}
                      <span className="cs-count">{checkResult.issues.length}</span>
                    </div>
                    {checkResult.issues.length > 0 ? (
                      checkResult.issues.map((issue, i) => renderIssueCard(`issue-${i}`, issue))
                    ) : (
                      <div className="cs-hint">
                        <Translate id="playground.results.noIssues">no issues — every call site satisfies the sidecar</Translate>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!checkError && !checkResult && (
                <div className="cs-hint"><Translate id="playground.hint.observe">Click "Observe" to see inference results.</Translate></div>
              )}

              {renderTscSection()}
            </div>
          </>
        )}

        {!isCallsiteMode && !isSidecarMode && (
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
                          r.args.map(a => formatShape(a)).join(', '),
                          formatShape(r.result),
                          isPrecise(formatShape(r.result)),
                          i === activeCaseIndex,
                        ),
                      )}
                    </div>
                  )}
                  {renderTscSection()}
                </div>
              </div>
            </div>
          </>
        )}
    </div>
  );
}

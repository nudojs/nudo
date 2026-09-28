import { parse, extractDirectives, type CaseDirective } from '@nudojs/parser';
import {
  checkSource,
  effectiveInterface,
  formatConstraint,
  type CheckReport,
} from '@nudojs/core';
import type { HoverInfo } from '@nudojs/lsp';
import { collectAbsInlays, type AbsInlay } from '@nudojs/core/internal';
import type { CaseInfo } from './types';

// ---------------------------------------------------------------------------
// Single-pane case evaluation
// ---------------------------------------------------------------------------

export function extractCases(code: string): CaseInfo[] {
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

export function isPrecise(typeStr: string): boolean {
  return !/\bunknown\b/.test(typeStr);
}

export const PLAYGROUND_FILE = '/playground.js';

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

/**
 * Sidecar 模式的动态覆盖层：优先于 VIRTUAL_NUDO_MODULES 静态模板。
 * 把侧车编辑器内容注册在两个键上——
 * - 侧车文件 basename：主源码显式 `import … from "./calc.nudo.js"` 可命中
 * - 'playground.nudo.js'：PLAYGROUND_FILE（/playground.js）的同名 ambient
 *   绑定键（core interface.ts 的 sidecarPathOf 把 /playground.js 解析为
 *   ./playground.nudo.js 再走 loadModule）
 * 传 null 清除覆盖，恢复静态模板（single / callsite 模式不受影响）。
 */
const SIDECAR_MODULE_OVERRIDES: Record<string, string> = {};

export function setPlaygroundSidecar(sidecarFile: string | null, content: string): void {
  for (const key of Object.keys(SIDECAR_MODULE_OVERRIDES)) {
    delete SIDECAR_MODULE_OVERRIDES[key];
  }
  if (!sidecarFile) return;
  const base = sidecarFile.split(/[\\/]/).pop() ?? sidecarFile;
  SIDECAR_MODULE_OVERRIDES[base] = content;
  SIDECAR_MODULE_OVERRIDES['playground.nudo.js'] = content;
}

export function playgroundLoadModule(spec: string, _fromFile: string): string | undefined {
  const base = spec.split(/[\\/]/).pop() ?? spec;
  if (SIDECAR_MODULE_OVERRIDES[base]) return SIDECAR_MODULE_OVERRIDES[base];
  if (SIDECAR_MODULE_OVERRIDES[spec]) return SIDECAR_MODULE_OVERRIDES[spec];
  if (VIRTUAL_NUDO_MODULES[base]) return VIRTUAL_NUDO_MODULES[base];
  if (VIRTUAL_NUDO_MODULES[spec]) return VIRTUAL_NUDO_MODULES[spec];
  if (base.endsWith('.nudo.js') || base.endsWith('.nudo.ts')) {
    return VIRTUAL_NUDO_MODULES['shapes.nudo.js'];
  }
  return undefined;
}

export const PLAYGROUND_LOAD_OPTS = {
  loadModule: playgroundLoadModule,
  fromFile: PLAYGROUND_FILE,
};

// ---------------------------------------------------------------------------
// Sidecar check gate（/playground.js + ambient 侧车 → checkSource 报告）
// ---------------------------------------------------------------------------

/**
 * Sidecar 模式的 Observe：对主源码跑真实 check 门禁。
 * checkSource 经 PLAYGROUND_LOAD_OPTS 的 loadModule 读到注册的侧车内容
 * （ambient 同名绑定 + 显式 `./x.nudo.js` import），产出签名表与
 * `actual ⊭ expected` 契约违规报告——与 `nudo check` 同一执法路径。
 */
export function runPlaygroundCheck(source: string): CheckReport {
  return checkSource(PLAYGROUND_FILE, source, undefined, {
    loadModule: playgroundLoadModule,
    fromFile: PLAYGROUND_FILE,
    autoBind: true,
  });
}

const KNOWN_TEMPLATE_DISPLAY: Record<string, string> = {
  positive: 'number().gt(0)   // x > 0',
  nonNeg: 'number().ge(0)   // x >= 0',
  negative: 'number().lt(0)   // x < 0',
  percent: 'number().ge(0).le(100)',
  atLeast1: 'number().ge(1)',
  delay: 'number().ge(0)',
};

export function contractMarkdownForWord(source: string, word: string): string[] {
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

export function maybeViolationNote(contractLines: string[], absText: string | undefined): string[] {
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

export function buildActiveCases(source: string, caseIndex: number): Map<string, number> {
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

export function hoverToMarkdown(hover: HoverInfo, word?: string): string {
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

export function collectLspInlays(source: string, monaco: any): any[] {
  try {
    return collectAbsInlays(source, PLAYGROUND_LOAD_OPTS).map((a) =>
      absInlayToMonaco(a, monaco),
    );
  } catch {
    return [];
  }
}

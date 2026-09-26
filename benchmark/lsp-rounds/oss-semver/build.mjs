#!/usr/bin/env node
/**
 * Generate starters-oss-semver/{nudo,typescript} from a node-semver checkout.
 *
 * Source: https://github.com/npm/node-semver (pure JS multi-file module graph).
 * Six historical bugs are re-introduced by reverse-applying real fix commits
 * (see SOURCE.md). Acceptance tests are distilled from those commits' fixtures.
 *
 * Usage: node build.mjs [path-to-semver-checkout]
 * Default checkout: /tmp/nudo-oss-candidates/semver
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rounds = join(here, "..");
const srcRoot = process.argv[2] || "/tmp/nudo-oss-candidates/semver";
if (!existsSync(join(srcRoot, "classes/range.js"))) {
  console.error("missing semver checkout at", srcRoot);
  process.exit(1);
}

const outRoot = join(rounds, "starters-oss-semver");
rmSync(outRoot, { recursive: true, force: true });

const LIB_FILES = [
  "index.js",
  "classes/comparator.js",
  "classes/index.js",
  "classes/range.js",
  "classes/semver.js",
  "internal/constants.js",
  "internal/debug.js",
  "internal/identifiers.js",
  "internal/lrucache.js",
  "internal/parse-options.js",
  "internal/re.js",
  ...[
    "clean", "cmp", "coerce", "compare-build", "compare-loose", "compare", "diff",
    "eq", "gt", "gte", "inc", "lt", "lte", "major", "minor", "neq", "parse",
    "patch", "prerelease", "rcompare", "rsort", "satisfies", "sort", "truncate", "valid",
  ].map((n) => `functions/${n}.js`),
  ...[
    "gtr", "intersects", "ltr", "max-satisfying", "min-satisfying", "min-version",
    "outside", "simplify", "subset", "to-comparators", "valid",
  ].map((n) => `ranges/${n}.js`),
];

function copyLib(dest) {
  mkdirSync(join(dest, "lib"), { recursive: true });
  for (const f of LIB_FILES) {
    mkdirSync(join(dest, "lib", dirname(f)), { recursive: true });
    cpSync(join(srcRoot, f), join(dest, "lib", f));
  }
  // 迁移基线：上游未类型化的边界（ANY 符号并集 / null 边）——双侧同文件
  for (const f of ["classes/comparator.js", "ranges/outside.js"]) {
    const p = join(dest, "lib", f);
    let s = readFileSync(p, "utf-8");
    if (!s.startsWith("// @ts-nocheck")) {
      writeFileSync(p, "// @ts-nocheck\n" + s);
    }
  }
}

/** Reverse-apply historical fixes (re-introduce real bugs). */
function injectBugs(dest) {
  const p = (rel) => join(dest, "lib", rel);
  const edit = (rel, pairs) => {
    let s = readFileSync(p(rel), "utf-8");
    for (const [from, to] of pairs) {
      if (!s.includes(from)) {
        console.error(`MISS in ${rel}: ${from.slice(0, 60)}...`);
        process.exit(1);
      }
      s = s.replace(from, to);
    }
    writeFileSync(p(rel), s);
  };

  // bug#1 — 5f3ca13 handle prerelease bounds in subset
  edit("ranges/subset.js", [
    [
      `} else if (gt.operator === '>=' && !c.test(gt.semver)) {`,
      `} else if (gt.operator === '>=' && !satisfies(gt.semver, String(c), options)) {`,
    ],
    [
      `} else if (lt.operator === '<=' && !c.test(lt.semver)) {`,
      `} else if (lt.operator === '<=' && !satisfies(lt.semver, String(c), options)) {`,
    ],
  ]);

  // bug#2 — 9c8692a tilde includePrerelease lower bound
  edit("classes/range.js", [
    [
      `const replaceTilde = (comp, options) => {
  const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE]
  // if we're including prereleases in the match, then the lower bound is
  // -0, the lowest possible prerelease value, just like x-ranges and carets.
  // this keeps \`~1.2\` equivalent to the \`1.2.x\` x-range it's documented as.
  const z = options.includePrerelease ? '-0' : ''
  return comp.replace(r, (_, M, m, p, pr) => {`,
      `const replaceTilde = (comp, options) => {
  const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE]
  return comp.replace(r, (_, M, m, p, pr) => {`,
    ],
    [
      `    } else if (isX(m)) {
      ret = \`>=\${M}.0.0\${z} <\${+M + 1}.0.0-0\`
    } else if (isX(p)) {
      // ~1.2 == >=1.2.0 <1.3.0-0
      ret = \`>=\${M}.\${m}.0\${z} <\${M}.\${+m + 1}.0-0\``,
      `    } else if (isX(m)) {
      ret = \`>=\${M}.0.0 <\${+M + 1}.0.0-0\`
    } else if (isX(p)) {
      // ~1.2 == >=1.2.0 <1.3.0-0
      ret = \`>=\${M}.\${m}.0 <\${M}.\${+m + 1}.0-0\``,
    ],
  ]);

  // bug#3 — 046da7f caret includePrerelease exact 0.x lower bound
  edit("classes/range.js", [
    [
      `      if (M === '0') {
        if (m === '0') {
          ret = \`>=\${M}.\${m}.\${p
          } <\${M}.\${m}.\${+p + 1}-0\`
        } else {
          ret = \`>=\${M}.\${m}.\${p
          } <\${M}.\${+m + 1}.0-0\`
        }
      } else {
        ret = \`>=\${M}.\${m}.\${p
        } <\${+M + 1}.0.0-0\`
      }
    }

    debug('caret return', ret)`,
      `      if (M === '0') {
        if (m === '0') {
          ret = \`>=\${M}.\${m}.\${p
          }\${z} <\${M}.\${m}.\${+p + 1}-0\`
        } else {
          ret = \`>=\${M}.\${m}.\${p
          }\${z} <\${M}.\${+m + 1}.0-0\`
        }
      } else {
        ret = \`>=\${M}.\${m}.\${p
        } <\${+M + 1}.0.0-0\`
      }
    }

    debug('caret return', ret)`,
    ],
  ]);

  // bug#4 — e583226 reject numeric segments after x-ranges
  edit("classes/range.js", [
    [
      `const isX = id => !id || id.toLowerCase() === 'x' || id === '*'

const invalidXRangeOrder = (M, m, p) => (
  (isX(M) && !isX(m)) ||
  (isX(m) && p && !isX(p))
)
`,
      `const isX = id => !id || id.toLowerCase() === 'x' || id === '*'
`,
    ],
    [
      `    debug('xRange', comp, ret, gtlt, M, m, p, pr)
    if (invalidXRangeOrder(M, m, p)) {
      return comp
    }

    const xM = isX(M)`,
      `    debug('xRange', comp, ret, gtlt, M, m, p, pr)
    const xM = isX(M)`,
    ],
  ]);

  // bug#5 — bea6028 increment dotted prerelease identifiers
  edit("classes/semver.js", [
    [
      `const { compareIdentifiers } = require('../internal/identifiers')

const isPrereleaseIdentifier = (prerelease, identifier) => {
  const identifiers = identifier.split('.')
  if (identifiers.length > prerelease.length) {
    return false
  }

  for (let i = 0; i < identifiers.length; i++) {
    if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) {
      return false
    }
  }

  return true
}
`,
      `const { compareIdentifiers } = require('../internal/identifiers')
`,
    ],
    [
      `          if (isPrereleaseIdentifier(this.prerelease, identifier)) {
            const prereleaseBase = this.prerelease[identifier.split('.').length]
            if (isNaN(prereleaseBase)) {
              this.prerelease = prerelease
            }
          } else {
            this.prerelease = prerelease
          }`,
      `          if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
            if (isNaN(this.prerelease[1])) {
              this.prerelease = prerelease
            }
          } else {
            this.prerelease = prerelease
          }`,
    ],
  ]);

  // bug#6 — 2471d75 + 17aa702 build metadata (both reversed: 17aa702 masks 2471d75)
  edit("classes/range.js", [
    [
      `  parseRange (range) {
    // strip build metadata so it can't bleed into the version
    range = range.replace(BUILDSTRIPRE, '')

    // memoize range parsing for performance.`,
      `  parseRange (range) {
    // memoize range parsing for performance.`,
    ],
    [
      `const parseComparator = (comp, options) => {
  comp = comp.replace(re[t.BUILD], '')
  debug('comp', comp, options)`,
      `const parseComparator = (comp, options) => {
  debug('comp', comp, options)`,
    ],
    [
      `const {
  safeRe: re,
  src,
  t,
  comparatorTrimReplace,
  tildeTrimReplace,
  caretTrimReplace,
} = require('../internal/re')
const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require('../internal/constants')

// unbounded global build-metadata stripper used by parseRange
const BUILDSTRIPRE = new RegExp(src[t.BUILD], 'g')
`,
      `const {
  safeRe: re,
  t,
  comparatorTrimReplace,
  tildeTrimReplace,
  caretTrimReplace,
} = require('../internal/re')
const { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require('../internal/constants')
`,
    ],
  ]);
}

const ACCEPTANCE = `'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const semver = require('../lib/index.js')

// Distilled from npm/node-semver historical fix fixtures. Do not edit.
// Each bug#N must stay red until that historical defect is fixed.

test('bug#1 subset prerelease bounds', () => {
  // 5f3ca13 — subset() must check prerelease bounds against individual comparators
  assert.equal(
    semver.subset('^10.2.0-beta.2', '^10.2.0-beta.1'),
    true,
    '^10.2.0-beta.2 ⊆ ^10.2.0-beta.1',
  )
  assert.equal(
    semver.subset('^1.2.3-pre.0', '>=1.2.3-pre.0'),
    true,
  )
})

test('bug#2 tilde includePrerelease lower bound', () => {
  // 9c8692a — ~1.2 must desugar like the documented x-range 1.2.*
  const opts = { includePrerelease: true }
  assert.equal(new semver.Range('~1.2', opts).range, '>=1.2.0-0 <1.3.0-0')
  assert.equal(new semver.Range('~1.2.x', opts).range, '>=1.2.0-0 <1.3.0-0')
  assert.equal(new semver.Range('~1', opts).range, '>=1.0.0-0 <2.0.0-0')
  assert.equal(semver.satisfies('1.1.0-a', '~1.1', opts), true)
  assert.equal(semver.satisfies('1.1.1-a', '~1.1', opts), true)
  assert.equal(semver.satisfies('2.0.0-pre.0', '~2', opts), true)
  assert.equal(semver.satisfies('2.0.0-pre.0', '~2.x', opts), true)
  // fully-specified tilde keeps exact lower bound (must NOT gain -0)
  assert.equal(new semver.Range('~1.2.3', opts).range, '>=1.2.3 <1.3.0-0')
})

test('bug#3 caret includePrerelease exact 0.x lower bound', () => {
  // 046da7f — ^0.0.3 must not admit 0.0.3-alpha even with includePrerelease
  const opts = { includePrerelease: true }
  assert.equal(semver.satisfies('0.0.3-alpha', '^0.0.3', opts), false)
  assert.equal(semver.satisfies('0.2.3-alpha', '^0.2.3', opts), false)
  assert.equal(semver.satisfies('1.0.0-rc1', '^1.0.0', opts), false)
  assert.equal(new semver.Range('^0.0.3', opts).range, '>=0.0.3 <0.0.4-0')
})

test('bug#4 reject numeric segments after x-ranges', () => {
  // e583226 — 1.x.5 / x.1 are invalid ranges (TypeError)
  for (const bad of ['1.x.5', '1.*.5', '1.x.5 || 2.x', 'x.1', 'x.1.2', 'x.x.1']) {
    assert.throws(() => new semver.Range(bad), TypeError, \`invalid: \${bad}\`)
    assert.equal(semver.validRange(bad), null, \`validRange(\${bad})\`)
  }
  // still valid:
  assert.equal(new semver.Range('1.2.x').range, '>=1.2.0 <1.3.0-0')
  assert.equal(new semver.Range('x').range || '*', '*')
})

test('bug#5 increment dotted prerelease identifiers', () => {
  // bea6028 — dotted identifier is a prefix when continuing a prerelease sequence
  assert.equal(
    semver.inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta'),
    '3.0.0-alpha.beta.5.5',
  )
  assert.equal(
    semver.inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta.5'),
    '3.0.0-alpha.beta.5.5',
  )
  assert.equal(
    semver.inc('3.0.0-alpha.beta.gamma', 'prerelease', false, 'alpha.beta'),
    '3.0.0-alpha.beta.0',
  )
})

test('bug#6 build metadata must not bleed into versions', () => {
  // 2471d75 + 17aa702 — strip +build before comparator / range parse
  assert.equal(new semver.Range('1.x.x+build').range, '>=1.0.0 <2.0.0-0')
  assert.equal(new semver.Range('>=1.x+build <2.x.x+build').range, '>=1.0.0 <2.0.0-0')
  assert.equal(new semver.Range('^1.x+build').range, '>=1.0.0 <2.0.0-0')
  assert.equal(new semver.Range('~1.x+build').range, '>=1.0.0 <2.0.0-0')
  assert.equal(new semver.Range('1.x.x+build || 2.x.x+build').range, '>=1.0.0 <2.0.0-0||>=2.0.0 <3.0.0-0')
  const long = 'a'.repeat(251)
  assert.equal(new semver.Range('4.17.0+' + long, { loose: true }).range, '4.17.0')
  assert.equal(new semver.Range('1.2.3+' + long + ' - 2.0.0').range, '>=1.2.3 <=2.0.0')
  assert.equal(new semver.Range('> 1.2.3+' + long).range, '>1.2.3')
  assert.equal(new semver.Range('~1.2.3+' + long).range, '>=1.2.3 <1.3.0-0')
  assert.equal(new semver.Range('^1.2.3+' + long).range, '>=1.2.3 <2.0.0-0')
})
`;

const BUGS_MD = `# 已知缺陷（issue 风格 · 不要读作修复补丁）

这是多文件模块图上的**真实开源历史 bug** 切片（来源见 \`SOURCE.md\`）。
\`test/acceptance.test.js\` 里 \`bug#N\` 对应下列问题。**不得改测试**；修实现直到 \`npm run ci\` 双绿。

---

## bug#1 — subset() 在 prerelease 边界上误判

\`subset(sub, dom)\` 回答「版本集合是否被包含」。当下界比较器是 \`>=\`（或上界是 \`<=\`）时，
实现用**整段 range 的 prerelease 门禁**去测边界，而不是用**单个 comparator** 自己的
\`.test()\`。结果：\`^10.2.0-beta.2\` 本应是 \`^10.2.0-beta.1\` 的子集却返回 \`false\`。

期望：
- \`subset('^10.2.0-beta.2', '^10.2.0-beta.1') === true\`
- \`subset('^1.2.3-pre.0', '>=1.2.3-pre.0') === true\`

参考语义：边界版本必须用承载它的那个 comparator 判定，而不是重新套上外层 range 的
includePrerelease 门禁。

---

## bug#2 — tilde 下界在 includePrerelease 时丢了 \`-0\`

文档写明 \`~1.2\` ≡ \`1.2.x\` ≡ \`>=1.2.0 <1.3.0-0\`。x-range 与 caret 在
\`{ includePrerelease: true }\` 下会把**开放下界**补上最低 prerelease \`-0\`，tilde 没有。
于是 \`~1.2.*\` 与 \`1.2.*\` / \`^1.2.*\` 行为不一致：

\`\`\`js
satisfies('1.2.0-rc', '~1.2.*', { includePrerelease: true })  // 应为 true
new Range('~1.2', { includePrerelease: true }).range
  // 应为 '>=1.2.0-0 <1.3.0-0'，与 1.2.* 相同
\`\`\`

**不变式**（请保持）：
- 默认（无 includePrerelease）**不得**加 \`-0\`：\`~1.2\` → \`>=1.2.0 <1.3.0-0\`
- 完全指定的 tilde 保持精确下界：\`~1.2.3\` + includePrerelease → \`>=1.2.3 <1.3.0-0\`
  （\`1.2.3-rc\` 排在 \`1.2.3\` 之前，**不该**匹配）

---

## bug#3 — caret 在 exact 0.x 上给下界误加 \`-0\`

\`^0.0.3\` / \`^0.2.3\` 这类**精确 0.x caret**（无显式 prerelease）在 includePrerelease 时
被错误改写成 \`>=0.0.3-0 <0.0.4-0\`，从而放过 \`0.0.3-alpha\`。同构的 \`^1.0.0\` 却是
\`>=1.0.0\` 并拒绝 \`1.0.0-rc1\`。

期望：
- \`satisfies('0.0.3-alpha', '^0.0.3', { includePrerelease: true }) === false\`
- \`satisfies('0.2.3-alpha', '^0.2.3', { includePrerelease: true }) === false\`
- \`satisfies('1.0.0-rc1', '^1.0.0', { includePrerelease: true }) === false\`
- \`new Range('^0.0.3', { includePrerelease: true }).range === '>=0.0.3 <0.0.4-0'\`

---

## bug#4 — x-range 后跟数字段被当成合法

\`1.x.5\`、\`x.1\`、\`x.x.1\` 这类「x 段之后仍有数字」的 range **不是**合法 semver range。
现在解析层把它们吞成奇怪的 comparator 组合；应当在 x-range 脱糖时拒绝（\`Range\` 构造
抛 \`TypeError\`，\`validRange\` 返回 \`null\`）。

仍须合法：
- \`1.2.x\` → \`>=1.2.0 <1.3.0-0\`
- \`x\` / \`*\` → any

---

## bug#5 — 点分 prerelease 标识符的 inc 语义

\`inc(version, 'prerelease', options, identifier)\` 在已有 prerelease 上递增时，
应把 \`identifier\` 当作**前缀**：若已有序列以该前缀开头，且下一段是数字，则递增该段；
若下一段不是数字，则重置为 \`\${identifier}.0\`（或 \`identifierBase === false\` 时只留 identifier）。

期望：
- \`inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta')\` → \`'3.0.0-alpha.beta.5.5'\`
- \`inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta.5')\` → \`'3.0.0-alpha.beta.5.5'\`
- \`inc('3.0.0-alpha.beta.gamma', 'prerelease', false, 'alpha.beta')\` → \`'3.0.0-alpha.beta.0'\`

（旧逻辑只比较 \`prerelease[0]\` 与整个 identifier，点分前缀整段匹配失败。）

---

## bug#6 — build metadata 泄漏进版本/比较器

\`+build\` 元数据必须在进 comparator / range 脱糖**之前**被剥掉，不能拼进版本号，也不能
撑爆解析。

期望（含长 metadata）：
- \`new Range('1.x.x+build').range === '>=1.0.0 <2.0.0-0'\`
- \`new Range('>=1.x+build <2.x.x+build').range === '>=1.0.0 <2.0.0-0'\`
- \`new Range('4.17.0+' + 'a'.repeat(251), { loose: true }).range === '4.17.0'\`
- \`new Range('1.2.3+' + 'a'.repeat(251) + ' - 2.0.0').range === '>=1.2.3 <=2.0.0'\`
- \`new Range('> 1.2.3+' + 'a'.repeat(251)).range === '>1.2.3'\`
- \`new Range('~1.2.3+' + 'a'.repeat(251)).range === '>=1.2.3 <1.3.0-0'\`
- \`new Range('^1.2.3+' + 'a'.repeat(251)).range === '>=1.2.3 <2.0.0-0'\`

注意：仅在 \`parseComparator\` 里剥、或仅在 \`parseRange\` 里剥，都可能漏掉另一类样例——
两类提交（x-range +build / 超长 +build）都覆盖到了。
`;

const SOURCE_MD = `# Provenance — 真实开源历史 bug 切片

| 项 | 值 |
|----|----|
| 上游 | https://github.com/npm/node-semver |
| 形态 | 纯 JS 多文件模块图（classes / functions / ranges / internal） |
| 切片规模 | ~2.4k LOC · 40+ 文件 |
| 回放方式 | 在当前 HEAD 上**反向应用**下列 **最近** fix 提交（逻辑回灌） |
| 时间窗 | **≥2025-09**（优先 2026 上半年）— 压低模型训练污染 |
| 验收 | 上述 fix 提交自带 fixture 的蒸馏（node:test，\`bug#N\`） |
| 对照 | 类型面 bug 若存在会走 LSP；纯语义坑两侧同难（噪声对照） |
| 网络 | 夹具构建/评测 **禁用 web**；仅本地 git 回灌 |

## 回灌的 fix 提交

| bug# | commit | 日期 | 标题 | 主文件 |
|------|--------|------|------|--------|
| 1 | \`5f3ca13\` | 2026-05 | fix: handle prerelease bounds in subset (#867) | ranges/subset.js |
| 2 | \`9c8692a\` | 2026-06 | fix: include prereleases in tilde range lower bound with includePrerelease (#878) | classes/range.js |
| 3 | \`046da7f\` | 2026-06 | fix: align caret includePrerelease lower bounds (#872) | classes/range.js |
| 4 | \`e583226\` | 2026-06 | fix: reject numeric segments after x-ranges | classes/range.js |
| 5 | \`bea6028\` | 2026-06 | fix: increment dotted prerelease identifiers (#870) | classes/semver.js |
| 6 | \`2471d75\` + \`17aa702\` | 2025-09 + 2026-05 | x-range build metadata / strip build before comparator trim | classes/range.js |

> bug#6 同时反了 \`2471d75\` 与 \`17aa702\`：后者在 \`parseRange\` 全局剥 build，会掩盖前者
> 在 \`parseComparator\` 的缺口；两处都去掉才能让两类样例同时红。

## 为什么是这张模块图

- **多文件真实依赖**（SemVer / Comparator / Range / subset / inc），不是 8 坑玩具面。
- **约束域**（range ⊆ range、prerelease 边界、inc 序列）贴近 Abs 代数的主战场。
- **历史真 bug、有 fixture**，不是自造注入；fix 文案里的「不变式」写进 issue 简报。
- 缺陷切在 2025-09→2026-06 的真实提交上，训练污染面相对可控（仍可能有背题风险，报告需注明）。

## 重建（生成物不进仓）

\`starters-oss-semver/\` 是 **gitignore 的生成物**。上游 ISC 源码不 vendoring；
仓库里只有反向补丁、验收测试、issue 文案。

\`\`\`bash
git clone https://github.com/npm/node-semver /tmp/nudo-oss-candidates/semver
node benchmark/lsp-rounds/oss-semver/build.mjs /tmp/nudo-oss-candidates/semver
\`\`\`

评测前先跑 build；\`harness/run.mjs --task oss\` 假定 starters 已生成。
`;

const PROMPT_OSS = `# 任务简报（OSS 历史 bug 切片 · 两侧共用）

这是 **node-semver** 的多文件模块图切片（\`lib/\`）。上游有若干**真实历史缺陷**已回灌进实现。
\`test/acceptance.test.js\` 里的 \`bug#1\`…\`bug#6\` 对应 \`BUGS.md\` 中的 issue。

## 目标

修 **\`lib/\` 实现**，使 \`npm run ci\` 双绿（test + gate）。

## 规则

1. **只改 \`lib/**\`**（可加 \`*.nudo.js\` / JSDoc / \`*.d.ts\` 等类型面文件）。
   **不得改** \`test/**\`、\`package.json\`、\`tsconfig.json\`、\`BUGS.md\`。
2. **用 LSP 诊断**导航；最终以 \`npm run ci\` 为准。LSP 一次查清（勿反复 write \`xd://lsp\`）：
   诊断：\`write xd://lsp\` → \`{"action":"diagnostics","file":"*"}\`
3. **禁止** \`--help\` / 读工具链仓库 / monorepo  packages/** / \`_probe\` 实验室。
   上游算法语义以 \`BUGS.md\` + 测试为准（这是解题依据，不是工具链文档）。
4. **不要**为了「看起来对」改测试期望或删测试；每个 \`bug#N\` 都要真绿。
5. \`npm run ci\` **双绿 = 完成**。warning/info 不阻塞；禁止绿后空转「清理」。

\`\`\`bash
npm run ci
\`\`\`

## 等价 = 成本函数

\`tsc --noEmit\` ↔ \`nudo check\` 同构。对照表见 \`FAIRNESS.md\`。

## 各自类型面（用满，禁止互仿文体）

- **Nudo**：裸 JS 推断；fail-fast 用 \`@nudo:throws Error\`；源级契约用 \`@nudo:contract\` +
  \`*.nudo.js\`（builder 从 \`@nudojs/core\` 导入）。**不要**写 TS 注解 / 当 type checker 用。
- **TypeScript**：\`.ts\` 注解 / \`checkJs\` + JSDoc / \`@ts-check\` / \`.d.ts\`。
  **不要**用 \`@nudo:\` 指令。

## 产出判据

1. 六个 \`bug#N\` 全过；
2. gate 绿；
3. 到达时展示「类型面在修复过程中抓住/防住一个真问题」的证据（诊断 / 契约蕴含 / 期望报错）。
`;

const FAIRNESS_NOTE = `# 公平简报（OSS 切片）

见 \`../agent/FAIRNESS.md\`（成本模型 + 对照表）。本题补充：

- 双方实现逻辑**同一套回灌 bug**；差异只在类型面工具链。
- **禁止**跨侧文体模仿（Nudo 别写 TS 注解；TS 别写 \`@nudo:\`）。
- 机制知识（\`BUGS.md\`、测试、本简报）可读；工具链仓库 / monorepo packages/** 不可读。
- 工具同构偏离单独记账，不进「修 bug 成本」。
`;

const NUDO_PKG = `{
  "name": "lsp-rounds-oss-semver-nudo",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "test": "node --test test/acceptance.test.js",
    "gate": "nudo check lib",
    "ci": "npm test && npm run gate"
  },
  "nudo": {
    "check": {
      "ignoreThrows": ["TypeError", "RangeError", "Error", "ReferenceError", "SyntaxError", "EvalError", "URIError"]
    }
  }
}
`;

const TS_PKG = `{
  "name": "lsp-rounds-oss-semver-typescript",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "test": "node --test test/acceptance.test.js",
    "gate": "tsc --noEmit",
    "ci": "npm test && npm run gate"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.9.0",
    "typescript-language-server": "^4.3.3"
  }
}
`;

const TS_CONFIG = `{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noImplicitAny": false,
    "strictNullChecks": false,
    "strictFunctionTypes": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["lib/**/*.js"]
}
`;

const NUDO_LSP = `# Nudo 侧 LSP：只开 nudo-lsp
servers:
  typescript-language-server:
    disabled: true
  nudo-lsp:
    command: node
    args:
      - /Users/lot/projects/nudo/packages/lsp/dist/server.js
    fileTypes: [".js", ".mjs", ".cjs"]
    rootMarkers: ["package.json"]
    languageId: "javascript"
`;

const TS_LSP = `# TS 侧 LSP：只开 typescript-language-server（含 JS + checkJs）
servers:
  typescript-language-server:
    command: typescript-language-server
    args: ["--stdio"]
    fileTypes: [".js", ".ts", ".tsx", ".mts", ".cts"]
    rootMarkers: ["package.json", "tsconfig.json"]
    disabled: false
  nudo-lsp:
    disabled: true
`;

const NUDO_CONTRACTS = `// 瘦侧车：只写义务（builder 从 @nudojs/core 导入）
// 可按需扩展；@nudo:throws 写在源码函数注释上。
const { string, shape, fn, number } = require('@nudojs/core')

const versionString = string().min(1)
const rangeString = string().min(1)

module.exports = {
  versionString,
  rangeString,
  // subset(sub, dom, options?) => boolean
  subset: fn({ sub: rangeString, dom: rangeString }, number().int()), // placeholder overwritten below
}
`;

// Actually for nudo contracts, fn return boolean might not have boolean builder easily.
// Keep sidecar minimal / optional — @nudo:throws on key APIs is enough type face.
const NUDO_CONTRACTS_SIMPLE = `// 瘦侧车（可选扩展）。本题类型面义务以 @nudo:throws + 推断为主。
// 需要谓词时：const { string, shape, fn } = require('@nudojs/core')
module.exports = {}
`;

function writeSide(which) {
  const dest = join(outRoot, which);
  mkdirSync(join(dest, "test"), { recursive: true });
  copyLib(dest);
  injectBugs(dest);
  writeFileSync(join(dest, "test/acceptance.test.js"), ACCEPTANCE);
  writeFileSync(join(dest, "package.json"), which === "nudo" ? NUDO_PKG : TS_PKG);
  writeFileSync(join(dest, "lsp.yml"), which === "nudo" ? NUDO_LSP : TS_LSP);
  if (which === "nudo") {
    writeFileSync(join(dest, "lib/contracts.nudo.js"), NUDO_CONTRACTS_SIMPLE);
  } else {
    writeFileSync(join(dest, "tsconfig.json"), TS_CONFIG);
  }
  writeFileSync(join(dest, "BUGS.md"), BUGS_MD);
  writeFileSync(join(dest, "FAIRNESS.md"), FAIRNESS_NOTE);
  writeFileSync(join(dest, "AGENT_BRIEF.md"), PROMPT_OSS);
}

writeSide("nudo");
writeSide("typescript");
writeFileSync(join(here, "SOURCE.md"), SOURCE_MD);
writeFileSync(join(here, "BUGS.md"), BUGS_MD);
console.log("wrote", outRoot);

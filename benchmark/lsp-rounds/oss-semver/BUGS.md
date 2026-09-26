# 已知缺陷（issue 风格 · 不要读作修复补丁）

这是多文件模块图上的**真实开源历史 bug** 切片（来源见 `SOURCE.md`）。
`test/acceptance.test.js` 里 `bug#N` 对应下列问题。**不得改测试**；修实现直到 `npm run ci` 双绿。

---

## bug#1 — subset() 在 prerelease 边界上误判

`subset(sub, dom)` 回答「版本集合是否被包含」。当下界比较器是 `>=`（或上界是 `<=`）时，
实现用**整段 range 的 prerelease 门禁**去测边界，而不是用**单个 comparator** 自己的
`.test()`。结果：`^10.2.0-beta.2` 本应是 `^10.2.0-beta.1` 的子集却返回 `false`。

期望：
- `subset('^10.2.0-beta.2', '^10.2.0-beta.1') === true`
- `subset('^1.2.3-pre.0', '>=1.2.3-pre.0') === true`

参考语义：边界版本必须用承载它的那个 comparator 判定，而不是重新套上外层 range 的
includePrerelease 门禁。

---

## bug#2 — tilde 下界在 includePrerelease 时丢了 `-0`

文档写明 `~1.2` ≡ `1.2.x` ≡ `>=1.2.0 <1.3.0-0`。x-range 与 caret 在
`{ includePrerelease: true }` 下会把**开放下界**补上最低 prerelease `-0`，tilde 没有。
于是 `~1.2.*` 与 `1.2.*` / `^1.2.*` 行为不一致：

```js
satisfies('1.2.0-rc', '~1.2.*', { includePrerelease: true })  // 应为 true
new Range('~1.2', { includePrerelease: true }).range
  // 应为 '>=1.2.0-0 <1.3.0-0'，与 1.2.* 相同
```

**不变式**（请保持）：
- 默认（无 includePrerelease）**不得**加 `-0`：`~1.2` → `>=1.2.0 <1.3.0-0`
- 完全指定的 tilde 保持精确下界：`~1.2.3` + includePrerelease → `>=1.2.3 <1.3.0-0`
  （`1.2.3-rc` 排在 `1.2.3` 之前，**不该**匹配）

---

## bug#3 — caret 在 exact 0.x 上给下界误加 `-0`

`^0.0.3` / `^0.2.3` 这类**精确 0.x caret**（无显式 prerelease）在 includePrerelease 时
被错误改写成 `>=0.0.3-0 <0.0.4-0`，从而放过 `0.0.3-alpha`。同构的 `^1.0.0` 却是
`>=1.0.0` 并拒绝 `1.0.0-rc1`。

期望：
- `satisfies('0.0.3-alpha', '^0.0.3', { includePrerelease: true }) === false`
- `satisfies('0.2.3-alpha', '^0.2.3', { includePrerelease: true }) === false`
- `satisfies('1.0.0-rc1', '^1.0.0', { includePrerelease: true }) === false`
- `new Range('^0.0.3', { includePrerelease: true }).range === '>=0.0.3 <0.0.4-0'`

---

## bug#4 — x-range 后跟数字段被当成合法

`1.x.5`、`x.1`、`x.x.1` 这类「x 段之后仍有数字」的 range **不是**合法 semver range。
现在解析层把它们吞成奇怪的 comparator 组合；应当在 x-range 脱糖时拒绝（`Range` 构造
抛 `TypeError`，`validRange` 返回 `null`）。

仍须合法：
- `1.2.x` → `>=1.2.0 <1.3.0-0`
- `x` / `*` → any

---

## bug#5 — 点分 prerelease 标识符的 inc 语义

`inc(version, 'prerelease', options, identifier)` 在已有 prerelease 上递增时，
应把 `identifier` 当作**前缀**：若已有序列以该前缀开头，且下一段是数字，则递增该段；
若下一段不是数字，则重置为 `${identifier}.0`（或 `identifierBase === false` 时只留 identifier）。

期望：
- `inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta')` → `'3.0.0-alpha.beta.5.5'`
- `inc('3.0.0-alpha.beta.5.4', 'prerelease', false, 'alpha.beta.5')` → `'3.0.0-alpha.beta.5.5'`
- `inc('3.0.0-alpha.beta.gamma', 'prerelease', false, 'alpha.beta')` → `'3.0.0-alpha.beta.0'`

（旧逻辑只比较 `prerelease[0]` 与整个 identifier，点分前缀整段匹配失败。）

---

## bug#6 — build metadata 泄漏进版本/比较器

`+build` 元数据必须在进 comparator / range 脱糖**之前**被剥掉，不能拼进版本号，也不能
撑爆解析。

期望（含长 metadata）：
- `new Range('1.x.x+build').range === '>=1.0.0 <2.0.0-0'`
- `new Range('>=1.x+build <2.x.x+build').range === '>=1.0.0 <2.0.0-0'`
- `new Range('4.17.0+' + 'a'.repeat(251), { loose: true }).range === '4.17.0'`
- `new Range('1.2.3+' + 'a'.repeat(251) + ' - 2.0.0').range === '>=1.2.3 <=2.0.0'`
- `new Range('> 1.2.3+' + 'a'.repeat(251)).range === '>1.2.3'`
- `new Range('~1.2.3+' + 'a'.repeat(251)).range === '>=1.2.3 <1.3.0-0'`
- `new Range('^1.2.3+' + 'a'.repeat(251)).range === '>=1.2.3 <2.0.0-0'`

注意：仅在 `parseComparator` 里剥、或仅在 `parseRange` 里剥，都可能漏掉另一类样例——
两类提交（x-range +build / 超长 +build）都覆盖到了。

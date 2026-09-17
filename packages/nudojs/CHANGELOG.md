# nudojs

## 0.2.2

### Patch Changes

- @nudojs/cli@1.0.1

## 0.2.1

### Patch Changes

- bd28356: Rename thin shell package from unavailable npm name `nudo` to `nudojs`. The installed command remains `nudo` (`npx nudojs infer …` / `npm i -g nudojs` → `nudo infer …`).

## 0.2.0

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudojs`（`bin` 委托 `@nudojs/cli`，命令名仍为 `nudo`）

- 0fd253f: 新增 `nudojs` 薄壳包：`npm i -g nudojs` 或 `npx nudojs` 直接获得 `nudo` 命令（委托 @nudojs/cli，参数与退出码透传）。

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
  - @nudojs/cli@1.0.0

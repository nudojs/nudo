/**
 * CLI / LSP 共用的**机器协议码**（不是 `nudo:*` 诊断注册表成员）。
 *
 * - `syntax-error`：解析 / 装配阶段的语法错；CLI `pathErrors` 与 LSP
 *   `parseFailureDiagnostic` 同码同义。
 * - `nudo:usage-error`：旗标组合 / 缺路径等用法错误；check / contract /
 *   test 的信封共用。
 *
 * 两者都由多处手写字符串收敛而来；改值必须同时改消费方与终端契约。
 */
export const SYNTAX_ERROR_CODE = "syntax-error" as const;
export const USAGE_ERROR_CODE = "nudo:usage-error" as const;

/**
 * E6 真实 JS `+`：无契约 = number|string；有契约则在调用点拦错误实参。
 * pnpm run check docs/examples/errors/06-plus-truth.js
 */
/// @nudo:import { positive } from "./delay.nudo.js"

function inc(x) {
  return x + 1; // 真实 JS：number | string
}

/**
 * @nudo:contract x positive
 */
function incPositive(x) {
  return x + 1;
}

inc("7");          // ok → "71"
incPositive(-1);   // error: -1 ⊭ x > 0

export { inc, incPositive };

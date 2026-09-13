// 示例 0：类型即计算（定义性示例）
// add 的类型是函数本身 (a,b)=>a+b，不是 (number,number)=>number。
// 运行（仓库根）：
//   pnpm run infer docs/examples/algebra/0-add-intensional.js   # 外延视图：字面量 #exact
//   pnpm run check docs/examples/algebra/0-add-intensional.js   # 内包式 Abs：term/pred 签名 #path
//
// infer 输出（TypeValue 桥有损，只看调用点真值）：
//   add(1, 3)        → 4         #exact
//   add(number, 1)   → number    #widened   （scale 体内 add(x, 1)，x 符号化）
//
// check 输出（Abs 无损签名）：
//   add(a, b)   number | string  = (A1 + A2)                #partial
//   scale(x)    number           = (x + 1)  where (x+1) > 1 #path
//   twice(x)    number           = ((x + 1) + 1)  where ((x+1)+1) > 2  #path
//
// TS 在后两者只能给 number；Nudo 让约束参与运算。

/// @nudo:import { positive } from "./positive.nudo.js"

const add = (a, b) => a + b;

add(1, 3);

/**
 * @nudo:refine x positive
 * @nudo:case "symbolic" (T.number)
 */
function scale(x) {
  // 前置条件：x > 0（来自 @nudo:refine）
  // add(x, 1) → term=x+1, pred: (x+1)>1
  return add(x, 1);
}

/**
 * @nudo:refine x positive
 * @nudo:case "symbolic" (T.number)
 */
function twice(x) {
  // 前置条件：x > 0（来自 @nudo:refine）
  const c = add(x, 1); // c ↦ x+1, c>1
  return add(c, 1);    // (x+1)+1, >2
}

export { add, scale, twice };

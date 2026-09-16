// 示例 K：try/catch 精度边界
// 考察：确定性 return 路径静态选支（try 体无抛点 → 折叠为字面量）；
// catch 形参未建模（err 被当作未知内置，err.message → unknown）。
//
// 逐 case 真值（infer 输出）：
//   fold()    → "inner"  #exact（try 体确定性 return，catch 分支不可达）
//   caught()  → unknown  #exact（throw → catch 形参 err 未建模）
//
// 边界形态（写算法前先查这张表）：
//   已建模：try 体确定性 return 折叠（无抛点 → 精确字面量）
//   未建模：catch 形参绑定（err → nudo:builtin-unknown，成员访问 unknown）

/**
 * @nudo:case "fold" ()
 */
function fold() {
  try {
    return "inner";
  } catch (e) {
    return "inner-catch";
  }
}

/**
 * @nudo:case "caught" ()
 */
function caught() {
  try {
    throw new Error("boom");
  } catch (err) {
    return err.message;
  }
}

export { fold, caught };

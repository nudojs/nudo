// 示例 L：原始值包装构造与全局数值解析——字面量折叠
// 考察：String / Number / Boolean / parseInt / parseFloat 在字面量实参上
// 折叠为精确结果（B 路径 evalGlobalFn），符号实参拓宽为目标原语。
//
// 逐 case 真值（infer 输出）：
//   strOf(5)       → "5"    #exact（String 折叠字面量）
//   boolOf("hi")   → true   #exact（Boolean 折叠字面量）
//   numOf("42")    → 42     #exact（Number 折叠字符串）
//   intOf("42px")  → 42     #exact（parseInt 前缀解析）
//   floatOf("3.14") → 3.14  #exact（parseFloat）
//
// 符号实参（T.string / T.number）拓宽为目标原语（string / number），
// 不折叠（见 intension 行）。String(undefined) 拓宽为 string（非 "undefined"）。

/**
 * @nudo:case "str" (5)
 */
function strOf(x) { return String(x); }

/**
 * @nudo:case "bool" ("hi")
 */
function boolOf(x) { return Boolean(x); }

/**
 * @nudo:case "num" ("42")
 */
function numOf(x) { return Number(x); }

/**
 * @nudo:case "int" ("42px")
 */
function intOf(s) { return parseInt(s); }

/**
 * @nudo:case "float" ("3.14")
 */
function floatOf(s) { return parseFloat(s); }

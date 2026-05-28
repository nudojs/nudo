export {
  evaluate,
  evaluateFunction,
  evaluateFunctionFull,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  resetMemo,
  getUnreachableRanges,
  resetUnreachableRanges,
  setNodeTypeCollector,
  setSampleCount,
  setMaxConcreteIter,
  setUnknownBuiltinHandler,
} from "./evaluator.ts";

export { narrow } from "./narrowing.ts";

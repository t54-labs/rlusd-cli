import type { PreparedPlanIntent } from "../types/index.js";

export type EvmPreparedPlanIntent = PreparedPlanIntent & {
  family: "evm";
};

export function asEvmPreparedPlanIntent<T extends PreparedPlanIntent>(intent: T): T & EvmPreparedPlanIntent {
  return {
    ...intent,
    family: "evm",
  };
}

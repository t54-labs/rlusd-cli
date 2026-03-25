import type { PreparedPlanIntent } from "../types/index.js";

export type DefiPreparedPlanIntent = PreparedPlanIntent & {
  family: "defi";
};

export function asDefiPreparedPlanIntent<T extends PreparedPlanIntent>(intent: T): T & DefiPreparedPlanIntent {
  return {
    ...intent,
    family: "defi",
  };
}

import type { PreparedPlanIntent } from "../types/index.js";

export type XrplPreparedPlanIntent = PreparedPlanIntent & {
  family: "xrpl";
};

export function asXrplPreparedPlanIntent<T extends PreparedPlanIntent>(intent: T): T & XrplPreparedPlanIntent {
  return {
    ...intent,
    family: "xrpl",
  };
}

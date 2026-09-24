import type { CanvasNodeDto } from "~/types/dto";
import { calculateAutoLayout } from "./autoLayout";
import type { MeasuredBox } from "../geometry/measuredSizes";

export type LayoutStrategyId = "freeform" | "columns" | "auto";

export interface LayoutStrategy {
  id: LayoutStrategyId;
  label: string;
  apply: (nodes: CanvasNodeDto[], sizes?: Record<string, MeasuredBox>) => CanvasNodeDto[];
}

const strategies = new Map<LayoutStrategyId, LayoutStrategy>([
  [
    "freeform",
    {
      id: "freeform" as LayoutStrategyId,
      label: "Freeform",
      apply: (nodes: CanvasNodeDto[]) => nodes,
    },
  ],
  [
    "columns",
    {
      id: "columns" as LayoutStrategyId,
      label: "Columns (DAG)",
      apply: (nodes: CanvasNodeDto[], sizes?: Record<string, MeasuredBox>) =>
        calculateAutoLayout(nodes, sizes),
    },
  ],
  [
    "auto",
    {
      id: "auto" as LayoutStrategyId,
      label: "Auto",
      apply: (nodes: CanvasNodeDto[], sizes?: Record<string, MeasuredBox>) =>
        calculateAutoLayout(nodes, sizes),
    },
  ],
]);

export function defineLayoutStrategy(s: LayoutStrategy): LayoutStrategy {
  strategies.set(s.id, s);
  return s;
}

export function getLayoutStrategy(id: string): LayoutStrategy {
  return strategies.get(id as LayoutStrategyId) ?? strategies.get("freeform")!;
}

export function listLayoutStrategies(): LayoutStrategy[] {
  return [...strategies.values()];
}

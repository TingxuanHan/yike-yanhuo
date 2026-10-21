import type { AnalysisResult, Travel, Usage, XY } from "./types.js";

export type AuditModel = "current" | "coarse" | "circle";
export interface ContourAuditPoint {
  number: number;
  point: XY;
  predictions: Record<AuditModel, boolean | null>;
}
export interface ContourAuditPlan {
  version: "fixed-polar-holdout-v1";
  sourceId: string;
  sourceGeneratedAt: string;
  minutes: number;
  count: 6 | 12;
  minimumSeparationMeters: number;
  circleSpeedMps: number;
  points: ContourAuditPoint[];
  maxRouteUnits: number;
}
export interface ContourAuditObservation {
  number: number;
  point: XY;
  travel: Travel;
  readAt: string;
}
export interface ContourAuditMetric {
  model: AuditModel;
  label: string;
  evaluated: number;
  agreement: number;
  falseReachable: number;
  missedReachable: number;
  observationUnknown: number;
  predictionUnknown: number;
}
export interface ContourAuditResult {
  schema: "yike-contour-audit-v1";
  evidence: "simulation" | "api-holdout";
  report: AnalysisResult;
  plan: ContourAuditPlan;
  plannedAt: string;
  completedAt: string;
  observations: ContourAuditObservation[];
  metrics: ContourAuditMetric[];
  paired: {
    evaluated: number;
    currentAgreement: number;
    circleAgreement: number;
  };
  usage: Usage;
}

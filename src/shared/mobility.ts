export interface MobilityNeeds {
  avoidSteps: boolean;
  stroller: boolean;
  needRest: boolean;
}
export const MOBILITY_OPTIONS = [
  { key: "avoidSteps", label: "尽量少走台阶" },
  { key: "stroller", label: "推车出门" },
  { key: "needRest", label: "需要途中歇脚" },
] as const;
export function cleanMobility(value?: unknown): MobilityNeeds {
  const v = value as MobilityNeeds | undefined;
  if (
    v !== undefined &&
    (!v || MOBILITY_OPTIONS.some((o) => typeof v[o.key] !== "boolean"))
  )
    throw new Error("通行偏好无效，请重新选择。");
  return {
    avoidSteps: v?.avoidSteps ?? false,
    stroller: v?.stroller ?? false,
    needRest: v?.needRest ?? false,
  };
}
export function mobilityReason(kind: string, needs: MobilityNeeds): string {
  if (kind === "steps" && (needs.avoidSteps || needs.stroller))
    return needs.stroller
      ? "你选择了推车出门：请重点确认台阶、门槛与可用入口。"
      : "你希望少走台阶：这条反馈与你的需求相关。";
  if (
    ["rough_surface", "entrance_blocked", "construction"].includes(kind) &&
    (needs.stroller || needs.needRest)
  )
    return "你选择了推车或途中歇脚：请核对通行宽度、绕行距离与停留位置。";
  return "";
}

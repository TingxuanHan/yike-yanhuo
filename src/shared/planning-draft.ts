export const planningTasks = [
  { id: "market", label: "买菜" },
  { id: "pharmacy", label: "取药" },
  { id: "park", label: "逛公园" },
  { id: "personal", label: "去小店" },
] as const;
export interface PlanningDraft {
  tripMinutes: number | null;
  shoppingBudget: number | null;
  departure: string | null;
  speedMps: number | null;
  walkingMinutes: number | null;
  returnEasy: boolean | null;
  tasks: string[];
  items: string[];
}
export const emptyPlanning = (): PlanningDraft => ({
  tripMinutes: null,
  shoppingBudget: null,
  departure: null,
  speedMps: null,
  walkingMinutes: null,
  returnEasy: null,
  tasks: [],
  items: [],
});
export function cleanPlanning(value: unknown): PlanningDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("条件格式无效，请重新整理或手工填写。");
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some(
      (k) => !Object.prototype.hasOwnProperty.call(emptyPlanning(), k),
    )
  )
    throw new Error("条件包含不支持的内容，请重新整理或手工填写。");
  const n = (key: string, min: number, max: number) => {
    const v = p[key];
    if (v == null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw new Error("条件数值超出范围，请核对时间、金额和步速。");
    return v;
  };
  if (
    p.departure != null &&
    (typeof p.departure !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.departure))
  )
    throw new Error("出发时间请填写HH:mm。");
  if (p.returnEasy != null && typeof p.returnEasy !== "boolean")
    throw new Error("请确认返程是否轻松走。");
  const tasks = p.tasks ?? [],
    items = p.items ?? [];
  if (
    !Array.isArray(tasks) ||
    tasks.length > 3 ||
    tasks.some((t) => !planningTasks.some((x) => x.id === t))
  )
    throw new Error("最多选择三件要办的事。");
  if (
    !Array.isArray(items) ||
    items.length > 5 ||
    items.some(
      (i) =>
        typeof i !== "string" ||
        !i.trim() ||
        i.length > 24 ||
        /[\r\n<>]/.test(i),
    )
  )
    throw new Error("购物名称最多五项，每项不超过24字。");
  return {
    tripMinutes: n("tripMinutes", 5, 180),
    shoppingBudget: n("shoppingBudget", 1, 10000),
    departure: (p.departure ?? null) as string | null,
    speedMps: n("speedMps", 0.3, 2),
    walkingMinutes: n("walkingMinutes", 1, 90),
    returnEasy: (p.returnEasy ?? null) as boolean | null,
    tasks: [...new Set(tasks)],
    items: [...new Set(items.map((i) => i.trim()))],
  };
}

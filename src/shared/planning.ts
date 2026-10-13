import { cleanBook, type LifeBook } from "./life.js";
import { defaultMovement } from "./movement.js";

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
export function parsePlanningAnswer(
  text: string,
  prompt: string,
): PlanningDraft {
  if (text.length > 6000) throw new Error("返回内容过长。");
  const draft = cleanPlanning(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    ),
  );
  if (draft.items.some((i) => !prompt.includes(i)))
    throw new Error("商品名称需要来自你的原话。");
  return draft;
}
export function planningNotes(p: PlanningDraft) {
  const notes = ["金额、路线与能否按时返回，仍需在下一步计算。"];
  if (p.items.length)
    notes.push(
      "带入购物时将以这些名称替换当前购物草稿，请补规格和数量；已保存的价格记录保留。",
    );
  if (!p.tripMinutes) notes.push("整趟时间未填写，将保留原有设置。");
  if (p.walkingMinutes)
    notes.push("步行目标带入“顺路动一动”；先选完整行程，再核对步行安排。");
  if (p.walkingMinutes && p.tripMinutes && p.walkingMinutes > p.tripMinutes)
    notes.push("步行目标超过整趟时间，请修改其中一项；目前条件无法同时满足。");
  return notes;
}
export function planningBook(book: LifeBook, input: PlanningDraft): LifeBook {
  const p = cleanPlanning(input),
    next = cleanBook(book);
  if (p.speedMps !== null) next.preferences.speedMps = p.speedMps;
  if (p.departure !== null) next.preferences.departure = p.departure;
  if (
    p.walkingMinutes !== null ||
    p.returnEasy !== null ||
    p.speedMps !== null
  ) {
    next.movement = {
      ...(next.movement ?? defaultMovement(next.preferences.speedMps)),
    };
    if (p.walkingMinutes !== null)
      next.movement.targetMinutes = p.walkingMinutes;
    if (p.returnEasy !== null) next.movement.returnEasy = p.returnEasy;
    if (p.speedMps !== null) {
      next.movement.easyMps = p.speedMps;
      if (next.movement.briskMps <= p.speedMps) next.movement.mode = "easy";
    }
  }
  return cleanBook(next);
}
export interface AiStatus {
  free: {
    configured: boolean;
    model: string;
    remaining: number | null;
    limit: number | null;
  };
  own: {
    configured: boolean;
    baseUrl: string;
    model: string;
    remaining: number;
    limit: number;
  };
  resetsAt: string;
}
export const aiPresets = [
  {
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-8B",
  },
  {
    name: "OpenRouter免费路由",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
  },
  { name: "自定义兼容接口", baseUrl: "", model: "" },
];

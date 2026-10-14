import { cleanBook, type LifeBook } from "./life.js";
import { defaultMovement } from "./movement.js";

import { cleanPlanning, type PlanningDraft } from "./planning-draft.js";
export {
  cleanPlanning,
  emptyPlanning,
  planningTasks,
  type PlanningDraft,
} from "./planning-draft.js";
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

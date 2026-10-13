export const MAX_PHOTO_LENGTH = 64_000;
export function cleanPhoto(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > MAX_PHOTO_LENGTH ||
    !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new Error("入口照片须为小于48KB的JPEG或PNG，请重新选择照片。");
  return value;
}

export interface EntranceGuide {
  id: string;
  name: string;
  photo: string;
  x: number;
  y: number;
  instruction: string;
  observedOn: string;
  source: "self" | "helper";
}

const str = (v: unknown, max: number, required = true) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new Error("协助内容无效或文字过长。");
  return v.trim();
};
const number = (v: unknown, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Error("协助数据中的数值无效。");
  return v;
};
export function cleanEntrance(value: unknown): EntranceGuide {
  const v = value as EntranceGuide;
  if (!v || !["self", "helper"].includes(v.source))
    throw new Error("入口记录无效。");
  const photo = cleanPhoto(v.photo);
  if (
    !photo ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.observedOn) ||
    !Number.isFinite(Date.parse(v.observedOn)) ||
    new Date(v.observedOn).toISOString().slice(0, 10) !== v.observedOn
  )
    throw new Error("请添加入口照片和有效的观察日期。");
  return {
    id: str(v.id, 80),
    name: str(v.name, 80),
    photo,
    x: number(v.x, 0, 1),
    y: number(v.y, 0, 1),
    instruction: str(v.instruction, 240),
    observedOn: v.observedOn,
    source: v.source,
  };
}

import {
  cleanJourney,
  DEFAULT_JOURNEY,
  type JourneyPreferences,
} from "./journey.js";
export type PlacePosition =
  | { system: "demo"; x: number; y: number }
  | { system: "bd09" | "gcj02" | "wgs84"; lng: number; lat: number };
export interface PersonalPlace {
  id: string;
  name: string;
  address: string;
  landmark: string;
  note: string;
  visitedOn: string;
  position: PlacePosition;
  source: "personal";
}
export interface LifeBook {
  format: "yike-life-v1";
  preferences: JourneyPreferences;
  places: PersonalPlace[];
}
export interface LifeSnapshot {
  revision: number;
  updatedAt: string;
  book: LifeBook;
}
export const emptyBook = (): LifeBook => ({
  format: "yike-life-v1",
  preferences: { ...DEFAULT_JOURNEY, signals: { ...DEFAULT_JOURNEY.signals } },
  places: [],
});
const text = (v: unknown, max: number, required = false): string => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw new Error("请填写地点名称，并检查文字长度。");
  return v.trim();
};
export function cleanPlace(value: unknown): PersonalPlace {
  const p = value as PersonalPlace;
  if (
    !p ||
    typeof p.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
    p.source !== "personal"
  )
    throw new Error("地点记录格式无效。");
  const c = p.position;
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  let position: PlacePosition;
  if (
    c?.system === "demo" &&
    finite(c.x, -100_000, 100_000) &&
    finite(c.y, -100_000, 100_000)
  )
    position = { system: "demo", x: c.x, y: c.y };
  else if (
    c &&
    ["bd09", "gcj02", "wgs84"].includes(c.system) &&
    "lng" in c &&
    finite(c.lng, -180, 180) &&
    finite(c.lat, -90, 90)
  )
    position = { system: c.system, lng: c.lng, lat: c.lat };
  else throw new Error("请选取有效位置，并保留坐标类型。");
  if (
    typeof p.visitedOn !== "string" ||
    (p.visitedOn &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(p.visitedOn) ||
        !Number.isFinite(Date.parse(p.visitedOn)) ||
        new Date(p.visitedOn).toISOString().slice(0, 10) !== p.visitedOn))
  )
    throw new Error("到访日期无效。");
  return {
    id: p.id,
    source: "personal",
    name: text(p.name, 80, true),
    address: text(p.address, 240),
    landmark: text(p.landmark, 300),
    note: text(p.note, 300),
    visitedOn: p.visitedOn,
    position,
  };
}
export function cleanBook(value: unknown): LifeBook {
  const b = value as LifeBook;
  if (
    !b ||
    b.format !== "yike-life-v1" ||
    !Array.isArray(b.places) ||
    b.places.length > 200
  )
    throw new Error("地点簿格式无效，或超过200个地点。");
  const places = b.places.map(cleanPlace);
  if (new Set(places.map((p) => p.id)).size !== places.length)
    throw new Error("地点编号重复，请检查备份文件。");
  return {
    format: "yike-life-v1",
    preferences: cleanJourney(b.preferences),
    places,
  };
}
export function placeCardText(p: PersonalPlace) {
  return `${p.position.system === "demo" ? "模拟地点。" : ""}我要去：${p.name}。地址：${p.address || "地址待补充"}。认准这里：${p.landmark || "入口地标待补充"}。${p.note ? `出门提醒：${p.note}。` : ""}地点由本人或协助者记录，开放情况请在出发前确认。`;
}

import {
  cleanJourney,
  DEFAULT_JOURNEY,
  type JourneyPreferences,
} from "./journey.js";
import {
  cleanFamiliarRoute,
  cleanRestPoint,
  type FamiliarRoute,
  type RestPoint,
} from "./outings.js";
import { cleanShopping, mergeShopping, type ShoppingBook } from "./shopping.js";
import { cleanMovement, type MovementSettings } from "./movement.js";
import { cleanTripFeedback, type TripFeedback } from "./trip-feedback.js";
import { cleanEntrance, cleanPhoto, type EntranceGuide } from "./entrance.js";
export { cleanPhoto, MAX_PHOTO_LENGTH } from "./entrance.js";
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
  favorite?: boolean;
  openingHours?: string;
  photo?: string;
}
export const MAX_BOOK_BYTES = 750_000;
export const utf8Bytes = (s: string) =>
  encodeURIComponent(s).replace(/%[A-F\d]{2}/g, "x").length;
export interface LifeBook {
  format: "yike-life-v1";
  preferences: JourneyPreferences;
  places: PersonalPlace[];
  familiarRoutes?: FamiliarRoute[];
  restPoints?: RestPoint[];
  shopping?: ShoppingBook;
  movement?: MovementSettings;
  trips?: TripFeedback[];
  entrances?: EntranceGuide[];
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
  if (p.favorite !== undefined && typeof p.favorite !== "boolean")
    throw new Error("收藏状态无效。");
  const photo = cleanPhoto(p.photo);
  return {
    id: p.id,
    source: "personal",
    name: text(p.name, 80, true),
    address: text(p.address, 240),
    landmark: text(p.landmark, 300),
    note: text(p.note, 300),
    visitedOn: p.visitedOn,
    position,
    ...(p.favorite !== undefined ? { favorite: p.favorite } : {}),
    ...(p.openingHours !== undefined
      ? { openingHours: text(p.openingHours, 120) }
      : {}),
    ...(photo ? { photo } : {}),
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
  const result: LifeBook = {
    format: "yike-life-v1",
    preferences: cleanJourney(b.preferences),
    places,
    ...(b.familiarRoutes !== undefined
      ? { familiarRoutes: cleanItems(b.familiarRoutes, cleanFamiliarRoute, 12) }
      : {}),
    ...(b.restPoints !== undefined
      ? { restPoints: cleanItems(b.restPoints, cleanRestPoint, 30) }
      : {}),
    ...(b.shopping !== undefined
      ? { shopping: cleanShopping(b.shopping) }
      : {}),
    ...(b.movement !== undefined
      ? { movement: cleanMovement(b.movement) }
      : {}),
    ...(b.trips !== undefined
      ? { trips: cleanItems(b.trips, cleanTripFeedback, 30) }
      : {}),
    ...(b.entrances !== undefined
      ? { entrances: cleanItems(b.entrances, cleanEntrance, 12) }
      : {}),
  };
  if (utf8Bytes(JSON.stringify(result)) > MAX_BOOK_BYTES)
    throw new Error("地点簿已接近本机容量，请备份并移除部分入口照片后重试。");
  return result;
}
function cleanItems<T extends { id: string }>(
  items: T[],
  clean: (v: unknown) => T,
  max: number,
): T[] {
  if (!Array.isArray(items) || items.length > max)
    throw new Error("私人记录数量超出本机容量。");
  const result = items.map(clean);
  if (new Set(result.map((r) => r.id)).size !== result.length)
    throw new Error("私人记录编号重复。");
  return result;
}
export function mergeBooks(local: LifeBook, incoming: LifeBook): LifeBook {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...new Map([...b, ...a].map((v) => [v.id, v])).values(),
  ];
  return cleanBook({
    ...local,
    places: merge(local.places, incoming.places),
    familiarRoutes: merge(
      local.familiarRoutes ?? [],
      incoming.familiarRoutes ?? [],
    ),
    restPoints: merge(local.restPoints ?? [], incoming.restPoints ?? []),
    ...(local.entrances || incoming.entrances
      ? {
          entrances: merge(local.entrances ?? [], incoming.entrances ?? []),
        }
      : {}),
    ...(local.shopping || incoming.shopping
      ? { shopping: mergeShopping(local.shopping, incoming.shopping) }
      : {}),
    ...(local.movement || incoming.movement
      ? { movement: local.movement ?? incoming.movement }
      : {}),
    ...(local.trips || incoming.trips
      ? {
          trips: merge(local.trips ?? [], incoming.trips ?? [])
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 30),
        }
      : {}),
  });
}
export function placeCardText(p: PersonalPlace) {
  return `${p.position.system === "demo" ? "模拟地点。" : ""}我要去：${p.name}。地址：${p.address || "地址待补充"}。认准这里：${p.landmark || "入口地标待补充"}。${p.openingHours ? `记录的营业时间：${p.openingHours}。` : ""}${p.note ? `出门提醒：${p.note}。` : ""}地点由本人或协助者记录，开放情况请在出发前确认。`;
}

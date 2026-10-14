import type { PlacePosition } from "./life.js";
import type { ActiveTrip } from "./trip.js";

export type RealPosition = Exclude<PlacePosition, { system: "demo" }>;
export interface LocationRecord {
  source: "device" | "confirmed";
  position: RealPosition;
  name: string;
  at: number;
  accuracyM: number | null;
}
export interface FamilySnapshot {
  record: LocationRecord;
  speedMps: number;
}
export interface FamilyShare {
  id: string;
  expiresAt: number;
  createdAt: number;
  snapshot: FamilySnapshot;
}
export const LOCATION_KEY = "yike-location-record";
export const SIMPLE_KEY = "yike-simple-mode";
export function cleanLocation(
  value: unknown,
  now = Date.now(),
): LocationRecord {
  const v = value as LocationRecord,
    p = v?.position;
  if (
    !v ||
    !["device", "confirmed"].includes(v.source) ||
    !p ||
    !["wgs84", "gcj02", "bd09"].includes(p.system) ||
    !Number.isFinite(p.lng) ||
    p.lng < -180 ||
    p.lng > 180 ||
    !Number.isFinite(p.lat) ||
    p.lat < -90 ||
    p.lat > 90 ||
    !Number.isFinite(v.at) ||
    v.at <= 0 ||
    v.at > now + 60_000 ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 80 ||
    (v.accuracyM !== null &&
      (!Number.isFinite(v.accuracyM) ||
        v.accuracyM < 0 ||
        v.accuracyM > 100_000))
  )
    throw new Error("位置记录无效，请重新获取或确认地点。");
  return {
    source: v.source,
    position: { system: p.system, lng: p.lng, lat: p.lat },
    name: v.name.trim(),
    at: v.at,
    accuracyM: v.source === "confirmed" ? null : v.accuracyM,
  };
}
export function cleanFamily(value: unknown, now = Date.now()): FamilySnapshot {
  const v = value as FamilySnapshot;
  if (!v || !Number.isFinite(v.speedMps) || v.speedMps < 0.3 || v.speedMps > 2)
    throw new Error("步行设置无效。");
  return { record: cleanLocation(v.record, now), speedMps: v.speedMps };
}
// A saved favourite or planned departure is not evidence that someone was there.
export function tripLocation(
  active: ActiveTrip | null,
  now = Date.now(),
): LocationRecord | null {
  if (!active || active.input?.bundle?.mode !== "baidu") return null;
  const e = [...active.events].reverse().find((e) => e.kind === "arrive");
  const node =
    e &&
    [active.input.origin, ...active.input.stops].find(
      (n) => n.id === e.placeId,
    );
  if (!e || !node || node.position.system === "demo") return null;
  try {
    return cleanLocation(
      {
        source: "confirmed",
        position: node.position,
        name: node.name,
        at: e.at,
        accuracyM: null,
      },
      now,
    );
  } catch {
    return null;
  }
}
export function latestLocation(
  values: unknown[],
  now = Date.now(),
): LocationRecord | null {
  const records: LocationRecord[] = [];
  for (const v of values) {
    try {
      records.push(cleanLocation(v, now));
    } catch {
      /* Invalid local records are not evidence. */
    }
  }
  return records.sort((a, b) => b.at - a.at)[0] ?? null;
}
export function locationSummary(
  snapshot: FamilySnapshot | null,
  now = Date.now(),
) {
  if (!snapshot)
    return {
      title: "还没有可用的位置记录",
      time: "",
      age: "",
      radiusM: null as number | null,
      range: "无法推测所在范围",
      detail:
        "可以授权获取位置，或在地点簿中选择你现在所在的地方。收藏、搜索和示例地点不会当作到达记录。",
      coordinates: "",
      text: "暂无位置记录，请通过电话向家人描述周围地标。",
    };
  const { record: r, speedMps } = cleanFamily(snapshot, now);
  const seconds = Math.max(0, (now - r.at) / 1000);
  const time = new Date(r.at).toLocaleString("zh-CN", { hour12: false });
  const age =
    seconds < 60 ? "不到1分钟前" : `${Math.floor(seconds / 60)}分钟前`;
  const base = r.source === "confirmed" ? 200 : r.accuracyM;
  const pace = Math.max(1.8, speedMps * 1.5);
  const usable = seconds <= 30 * 60 && base !== null && base <= 1000;
  const radiusM = usable
    ? Math.max(50, Math.ceil((base! + seconds * pace) / 50) * 50)
    : null;
  const title =
    r.source === "confirmed" ? `最后本人确认：${r.name}` : "最后一次设备定位";
  const range =
    radiusM === null
      ? "暂不推测所在范围"
      : `可能活动范围：距记录点约${radiusM >= 1000 ? (radiusM / 1000).toFixed(1) + "公里" : radiusM + "米"}以内（步行假设）`;
  const detail =
    seconds > 1800
      ? "记录已超过30分钟，只能作为最后线索；请电话核对，不能据此确定当前位置。"
      : base === null || base > 1000
        ? "定位精度不足，不能可靠估计范围；请再次获取位置或电话核对。"
        : `按${pace.toFixed(1)}米/秒持续步行估算，${r.source === "confirmed" ? "另留200米地点误差" : `设备报告误差约${Math.ceil(base)}米`}。圆形示意未考虑道路、停留和障碍，不是实时定位或保证边界；乘车、跑步时不适用。`;
  const system = { wgs84: "WGS84", gcj02: "GCJ02", bd09: "BD09" }[
    r.position.system
  ];
  const coordinates = `${r.position.lng.toFixed(6)}, ${r.position.lat.toFixed(6)}（${system}）`;
  return {
    title,
    time,
    age,
    radiusM,
    range,
    detail,
    coordinates,
    text: `${title}\n记录时间：${time}（${age}）\n${range}\n参考坐标：${coordinates}\n${detail}\n请通过电话确认周围地标。`,
  };
}

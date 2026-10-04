import type { LngLat, XY } from '../shared/types.js';

const EARTH = 6371008.8;
const RAD = Math.PI / 180;
export const distance = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const pointKey = (p: XY): string => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
export const midpoint = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Local equirectangular projection, for neighborhood-sized analyses only.
export function toLocal(p: LngLat, origin: LngLat): XY {
  return [(p.lng - origin.lng) * RAD * EARTH * Math.cos(origin.lat * RAD), (p.lat - origin.lat) * RAD * EARTH];
}
export function toGeo(p: XY, origin: LngLat): LngLat {
  return { lng: origin.lng + p[0] / (EARTH * Math.cos(origin.lat * RAD) * RAD), lat: origin.lat + p[1] / (EARTH * RAD) };
}
export function validGeo(value: unknown): value is LngLat {
  if (!value || typeof value !== 'object') return false;
  const p = value as LngLat;
  return Number.isFinite(p.lng) && Number.isFinite(p.lat) && p.lng >= 73 && p.lng <= 136 && p.lat >= 3 && p.lat <= 54;
}

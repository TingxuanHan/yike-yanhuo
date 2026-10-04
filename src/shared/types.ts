export type XY = [number, number];
export interface LngLat { lng: number; lat: number }
export type Mode = 'demo' | 'baidu';
export type Category = 'market' | 'pharmacy' | 'school' | 'medical' | 'park' | 'elder';
export const CATEGORIES: { id: Category; label: string; query: string; color: string; short: string }[] = [
  { id: 'market', label: '菜市场', query: '菜市场', color: '#8a6334', short: '菜' },
  { id: 'pharmacy', label: '药店', query: '药店', color: '#a43e51', short: '药' },
  { id: 'school', label: '小学', query: '小学', color: '#426fad', short: '学' },
  { id: 'medical', label: '医疗', query: '社区卫生服务中心', color: '#b65c32', short: '医' },
  { id: 'park', label: '公园', query: '公园', color: '#34754e', short: '园' },
  { id: 'elder', label: '养老', query: '养老服务', color: '#73569a', short: '养' },
];
export type Travel =
  | { status: 'ok'; seconds: number; meters: number }
  | { status: 'unknown' | 'unreachable'; reason: string };
export interface Facility {
  id: string;
  uid?: string;
  name: string;
  category: Category;
  point: XY;
  address: string;
  geo?: LngLat;
  travel?: Travel;
}
export interface Sample { point: XY; travel: Travel }
export type Triangle = [Sample, Sample, Sample];
export type MultiPolygon = XY[][][];
export interface Contour {
  minutes: 5 | 10 | 15;
  polygons: MultiPolygon;
  areaKm2: number;
  clipped: boolean;
}
export type Completeness = Record<Category, boolean>;
export interface SearchResult {
  facilities: Facility[];
  complete: Completeness;
  warnings: string[];
  radiusMeters: number;
}
export interface Usage {
  requests: number;
  routePairs: number;
  searchRequests: number;
  cacheHits: number;
  retries: number;
}
export interface Provider {
  mode: Mode;
  usage: Usage;
  search(center: XY, radius: number, signal?: AbortSignal): Promise<SearchResult>;
  route(origin: XY, destinations: XY[], signal?: AbortSignal): Promise<Travel[]>;
}
export interface Center { label: string; point: XY; geo?: LngLat }
export interface AnalysisInput { mode: Mode; label?: string; point?: XY; geo?: LngLat }
export interface Progress { stage: string; done: number; total: number }
export interface Gap {
  point: XY;
  category: 'market' | 'pharmacy' | 'school';
  status: 'missing' | 'unknown';
}
export interface AnalysisResult {
  schemaVersion: 1;
  id: string;
  mode: Mode;
  generatedAt: string;
  center: Center;
  contours: Contour[];
  samples: Sample[];
  facilities: Facility[];
  complete: Completeness;
  gaps: Gap[];
  warnings: string[];
  usage: Usage;
  elapsedMs: number;
  parameters: {
    radiusMeters: number;
    coarseStepMeters: number;
    refinedStepMeters: number;
    refinementPoints: number;
    searchRadiusMeters: number;
    gapDistanceMeters: number;
    gapDistanceDefinition: string;
  };
  quality: { knownSamples: number; totalSamples: number; unknownFacilities: number; skippedTriangles: number };
}
export interface Job {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: Progress;
  result?: AnalysisResult;
  error?: string;
}
export interface PublicConfig { baiduConfigured: boolean; browserAk: string; version: string }
export const emptyUsage = (): Usage => ({ requests: 0, routePairs: 0, searchRequests: 0, cacheHits: 0, retries: 0 });
export const completeCategories = (value: boolean): Completeness => Object.fromEntries(CATEGORIES.map(c => [c.id, value])) as Completeness;

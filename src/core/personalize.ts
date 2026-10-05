import { cleanJourney, estimateJourney, journeyBands, type JourneyPreferences } from "../shared/journey.js";
import type { AnalysisResult, Sample, Travel } from "../shared/types.js";
import { gridTriangles, splitSharedEdges } from "./mesh.js";
import { pointKey } from "./geo.js";
import { contoursFromTriangles, polygonArea } from "./contours.js";
import { reconcileEvidence } from "./poi-evidence.js";

export function personalize(source: AnalysisResult, input: JourneyPreferences): AnalysisResult {
  const preferences = cleanJourney(input);
  const transform = (travel: Travel): Travel => travel.status === "ok" ? {
    status:"ok", meters:travel.meters,
    recordedSeconds: travel.recordedSeconds ?? travel.seconds,
    seconds:estimateJourney(travel.meters, preferences).seconds,
  } : { ...travel };
  const samples: Sample[] = source.samples.map(s=>({point:[...s.point], travel:transform(s.travel)}));
  const map = new Map(samples.map(s=>[pointKey(s.point), s]));
  const { radiusMeters:radius, coarseStepMeters:step } = source.parameters;
  if (radius <= 0 || radius / step > 20 || !Number.isInteger(radius / step)) throw new Error("这份结果的采样网格不支持试算，请使用完整体检结果。");
  let triangles = gridTriangles(source.center.point, radius, step, map);
  // Only use already measured vertices. No new route request or extrapolation.
  for (let pass = 0; pass < 2; pass++) triangles = splitSharedEdges(triangles, map);
  const contours = journeyBands(preferences.minutes).map(minutes=>{
    const polygons = contoursFromTriangles(triangles, minutes*60);
    const clipped = samples.some(s=>s.travel.status === "ok" && s.travel.seconds <= minutes*60 && (Math.abs(s.point[0]-source.center.point[0]) === radius || Math.abs(s.point[1]-source.center.point[1]) === radius));
    return {minutes, polygons, areaKm2:polygonArea(polygons)/1e6, clipped};
  });
  const warnings = source.warnings.filter(w=>!w.startsWith("出行试算："));
  warnings.push("出行试算：按已有路线距离÷个人步速计算，未叠加原接口耗时；沿用既有路径，未按个人偏好重新寻优。");
  warnings.push(preferences.signals.enabled ? "出行试算：路口数量、峰谷时段与等待时长均为手动假设，不是附近行人信号灯实测或实时数据。" : "出行试算：尚未计入等灯、停歇和临时障碍，所示时间不是保证到达时间。");
  warnings.push("出行试算：复用原有测时点，未为新时长补采样；轮廓附近仍需核验。");
  if (contours.some(c=>c.clipped)) warnings.push("出行试算：范围触及采样边界，当前面积仅覆盖已采样区域。");
  return reconcileEvidence({ ...source, id:crypto.randomUUID(), contours, samples,
    facilities:source.facilities.map(f=>({...f, ...(f.travel ? {travel:transform(f.travel)}:{})})),
    warnings, scenario:{ preferences, sourceId:source.scenario?.sourceId ?? source.id, createdAt:new Date().toISOString() },
    parameters:{...source.parameters, gapDistanceDefinition:`局部平面直线距离，非步行距离；仅检查${preferences.minutes}分钟试算可达采样点`},
    quality:{...source.quality, skippedTriangles:triangles.filter(t=>t.some(s=>s.travel.status!=="ok")).length},
  });
}

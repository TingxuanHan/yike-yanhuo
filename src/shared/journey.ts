export interface JourneyPreferences {
  minutes: number;
  speedMps: number;
  departure: string;
  signals: {
    enabled: boolean;
    crossingsPerKm: number;
    offPeakSeconds: number;
    peakSeconds: number;
    morningStart: string;
    morningEnd: string;
    eveningStart: string;
    eveningEnd: string;
  };
}
export const DEFAULT_JOURNEY: JourneyPreferences = {
  minutes: 15,
  speedMps: 1.2,
  departure: "09:00",
  signals: {
    enabled: false,
    crossingsPerKm: 2,
    offPeakSeconds: 20,
    peakSeconds: 50,
    morningStart: "07:00",
    morningEnd: "09:00",
    eveningStart: "17:00",
    eveningEnd: "19:00",
  },
};
export const clockMinute = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error("请输入有效的出发和高峰时段。");
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};
export function cleanJourney(value: unknown): JourneyPreferences {
  const p = value as JourneyPreferences;
  const bounded = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  if (
    !p ||
    !Number.isInteger(p.minutes) ||
    !bounded(p.minutes, 5, 30) ||
    !bounded(p.speedMps, 0.3, 2)
  )
    throw new Error("步行时长须为5—30分钟，步速须为0.3—2米/秒。");
  const s = p.signals;
  if (
    !s ||
    typeof s.enabled !== "boolean" ||
    !bounded(s.crossingsPerKm, 0, 10) ||
    !bounded(s.offPeakSeconds, 0, 300) ||
    !bounded(s.peakSeconds, 0, 300)
  )
    throw new Error("请检查路口数量与等灯时长（0—300秒）。");
  for (const time of [
    p.departure,
    s.morningStart,
    s.morningEnd,
    s.eveningStart,
    s.eveningEnd,
  ])
    clockMinute(time);
  for (const [a, b] of [
    [s.morningStart, s.morningEnd],
    [s.eveningStart, s.eveningEnd],
  ])
    if (a === b) throw new Error("高峰时段的开始与结束不能相同。");
  return {
    minutes: p.minutes,
    speedMps: p.speedMps,
    departure: p.departure,
    signals: {
      enabled: s.enabled,
      crossingsPerKm: s.crossingsPerKm,
      offPeakSeconds: s.offPeakSeconds,
      peakSeconds: s.peakSeconds,
      morningStart: s.morningStart,
      morningEnd: s.morningEnd,
      eveningStart: s.eveningStart,
      eveningEnd: s.eveningEnd,
    },
  };
}
const inBand = (minute: number, start: string, end: string) => {
  const a = clockMinute(start),
    b = clockMinute(end);
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
};
export function signalWaitSeconds(
  p: JourneyPreferences,
  elapsedSeconds: number,
) {
  if (!p.signals.enabled) return 0;
  const minute = (clockMinute(p.departure) + elapsedSeconds / 60) % 1440;
  const s = p.signals;
  return inBand(minute, s.morningStart, s.morningEnd) ||
    inBand(minute, s.eveningStart, s.eveningEnd)
    ? s.peakSeconds
    : s.offPeakSeconds;
}
// Scenario crossings are evenly spaced along route distance, not observed junctions.
// Evaluate the wait at arrival, including delays accumulated at previous crossings.
export function estimateJourney(
  meters: number,
  input: JourneyPreferences,
  elapsedSeconds = 0,
) {
  const p = cleanJourney(input);
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    elapsedSeconds > 86400
  )
    throw new Error("累计出行时间无效。");
  if (!Number.isFinite(meters) || meters < 0 || meters > 100_000)
    throw new Error("路线距离超出试算范围。");
  const walkingSeconds = meters / p.speedMps;
  const s = p.signals;
  let waitingSeconds = 0;
  const crossings = s.enabled
    ? Math.floor((meters * s.crossingsPerKm) / 1000)
    : 0;
  for (let i = 1; i <= crossings; i++) {
    waitingSeconds += signalWaitSeconds(
      p,
      elapsedSeconds +
        (i * 1000) / s.crossingsPerKm / p.speedMps +
        waitingSeconds,
    );
  }
  return {
    walkingSeconds,
    waitingSeconds,
    crossings,
    seconds: walkingSeconds + waitingSeconds,
  };
}
export function journeyBands(minutes: number) {
  return [...new Set([5, 10, minutes].filter((m) => m <= minutes))].sort(
    (a, b) => a - b,
  );
}

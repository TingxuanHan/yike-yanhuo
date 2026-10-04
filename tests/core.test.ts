import test from 'node:test';
import assert from 'node:assert/strict';
import { clipTriangle, contoursFromTriangles, polygonArea } from '../src/core/contours.js';
import { deduplicate, findGaps, facilityCount } from '../src/core/facilities.js';
import { DemoProvider, DEMO_CENTERS, demoFacilities } from '../src/core/demo.js';
import { analyze } from '../src/core/analyze.js';
import { toGeo, toLocal } from '../src/core/geo.js';
import { completeCategories, type Sample, type Triangle } from '../src/shared/types.js';

const s = (x: number, y: number, seconds: number): Sample => ({ point: [x, y], travel: { status: 'ok', seconds, meters: seconds } });
test('threshold clipping yields the analytical triangle area', () => {
  const triangle: Triangle = [s(0, 0, 0), s(100, 0, 100), s(0, 100, 100)];
  assert.equal(polygonArea(contoursFromTriangles([triangle], 50)), 1250);
  assert.equal(polygonArea(contoursFromTriangles([triangle], 100)), 5000);
});
test('unknown vertices never produce a fabricated polygon', () => {
  assert.deepEqual(clipTriangle([s(0, 0, 0), s(10, 0, 2), { point: [0, 10], travel: { status: 'unknown', reason: 'timeout' } }], 60), []);
});
test('disconnected pieces remain separate, without a convex hull bridge', () => {
  const geometry = contoursFromTriangles([[s(0, 0, 0), s(1, 0, 0), s(0, 1, 0)], [s(10, 10, 0), s(11, 10, 0), s(10, 11, 0)]], 300);
  assert.equal(geometry.length, 2);
  assert.equal(polygonArea(geometry), 1);
});
test('UID and fallback deduplication preserve distinct branches and categories', () => {
  const p = demoFacilities()[0];
  assert.equal(deduplicate([p, { ...p, id: 'second' }]).length, 1);
  assert.equal(deduplicate([p, { ...p, uid: 'other' }]).length, 2);
  assert.equal(deduplicate([{ ...p, uid: undefined }, { ...p, uid: undefined, name: ` ${p.name} ` }]).length, 1);
  assert.equal(deduplicate([p, { ...p, category: 'school' }]).length, 2);
});
test('incomplete searches and uncovered buffers produce unknown gaps', () => {
  assert.equal(findGaps([[0, 0]], [0, 0], [], completeCategories(false), 2000)[0].status, 'unknown');
  assert.equal(findGaps([[1500, 0]], [0, 0], [], completeCategories(true), 2000)[0].status, 'unknown');
  assert.equal(findGaps([[0, 0]], [0, 0], [], completeCategories(true), 2000)[0].status, 'missing');
});
test('river crossing requires an actual bridge detour', async () => {
  const [route] = await new DemoProvider().route([400, 0], [[600, 0]]);
  assert.equal(route.status, 'ok');
  if (route.status === 'ok') assert.equal(route.meters, 1400);
});
test('geographic projection round-trips longitude and latitude in the right order', () => {
  const origin = { lng: 121.5, lat: 31.2 };
  const point = { lng: 121.5123, lat: 31.2087 };
  const back = toGeo(toLocal(point, origin), origin);
  assert.ok(Math.abs(back.lng - point.lng) < 1e-10 && Math.abs(back.lat - point.lat) < 1e-10);
});
test('complete demo analysis produces nested contours and reproducible facility counts', async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0]);
  const areas = result.contours.map(c => c.areaKm2);
  assert.ok(areas[0] > 0 && areas[0] < areas[1] && areas[1] < areas[2]);
  assert.equal(result.quality.knownSamples, result.quality.totalSamples);
  assert.ok(result.parameters.refinementPoints <= 96);
  assert.equal(result.usage.requests, 0);
  assert.equal(facilityCount(result.facilities, 'market', 15), 1);
  assert.ok(result.warnings.some(w => w.includes('人工构造')));
});
test('sampling boundary contact is disclosed', async () => {
  const result = await analyze(new DemoProvider(), DEMO_CENTERS[0], { radius: 400, step: 200, maxRefinement: 0 });
  assert.ok(result.contours[2].clipped);
});
test('aborted analysis stops before making a request', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyze(new DemoProvider(), DEMO_CENTERS[0], { signal: controller.signal }), { name: 'AbortError' });
});

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_JOURNEY, cleanJourney, estimateJourney } from "../src/shared/journey.js";
import { personalize } from "../src/core/personalize.js";
import { analyze } from "../src/core/analyze.js";
import { DemoProvider, DEMO_CENTERS } from "../src/core/demo.js";
import { parseResultFile } from "../src/shared/result-file.js";

test("walking pace changes travel time without inventing waits or compounding provider duration",()=>{
  assert.equal(estimateJourney(1200,DEFAULT_JOURNEY).seconds,1000);
  assert.equal(estimateJourney(1200,{...DEFAULT_JOURNEY,speedMps:0.6}).seconds,2000);
  assert.equal(estimateJourney(0,DEFAULT_JOURNEY).seconds,0);
  assert.throws(()=>cleanJourney({...DEFAULT_JOURNEY,minutes:31}));
  assert.throws(()=>cleanJourney({...DEFAULT_JOURNEY,speedMps:0}));
  assert.throws(()=>cleanJourney({...DEFAULT_JOURNEY,departure:"25:00"}));
});
test("signal scenarios use arrival at each crossing, accumulated waits, and wrap midnight",()=>{
  const p={...DEFAULT_JOURNEY,departure:"08:58",speedMps:1,signals:{...DEFAULT_JOURNEY.signals,enabled:true,crossingsPerKm:10,peakSeconds:60,offPeakSeconds:10}};
  const t=estimateJourney(200,p);
  assert.equal(t.crossings,2);assert.equal(t.waitingSeconds,70);assert.equal(t.seconds,270);
  assert.equal(estimateJourney(200,{...p,departure:"14:00"}).waitingSeconds,20);
  assert.equal(estimateJourney(100,{...p,departure:"23:59",signals:{...p.signals,morningStart:"23:00",morningEnd:"01:00"}}).waitingSeconds,60);
});
test("custom contours reuse measured vertices, preserve raw times, unknowns and old result imports",async()=>{
  const provider=new DemoProvider();
  const baseline=await analyze(provider,DEMO_CENTERS[0]);
  const raw=JSON.stringify(baseline),calls=provider.usage.requests;
  const fast=personalize(baseline,{...DEFAULT_JOURNEY,minutes:20});
  const slow=personalize(baseline,{...DEFAULT_JOURNEY,minutes:20,speedMps:0.6});
  assert.deepEqual(fast.contours.map(c=>c.minutes),[5,10,20]);
  assert.ok(fast.contours.at(-1)!.areaKm2>slow.contours.at(-1)!.areaKm2);
  assert.deepEqual(personalize(fast,{...DEFAULT_JOURNEY,minutes:20}).samples,fast.samples);
  assert.equal(JSON.stringify(baseline),raw);assert.equal(provider.usage.requests,calls);
  const imported=parseResultFile(JSON.stringify(fast));
  assert.deepEqual(imported.scenario,fast.scenario);assert.deepEqual(imported.samples,fast.samples);
  assert.deepEqual(parseResultFile(raw).contours,baseline.contours);
  assert.equal(personalize(baseline,{...DEFAULT_JOURNEY,minutes:5}).contours.length,1);
  baseline.samples[0].travel={status:"unknown",reason:"missing"};
  assert.equal(personalize(baseline,DEFAULT_JOURNEY).samples[0].travel.status,"unknown");
});

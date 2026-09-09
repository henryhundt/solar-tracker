import test from 'node:test';
import assert from 'node:assert/strict';
import type { APIRequestContext } from 'playwright';
import type { Site } from '../shared/schema';
import { extractEnergyDataFromDashboardApis } from '../server/scrapers/solaredge-browser';

const site = { id: 11, timezone: 'America/Chicago' } as Site;
function fixture(handler: (url: URL) => unknown, status = 200): APIRequestContext {
  return { get: async (url: string) => ({ok:()=>status===200,status:()=>status,json:async()=>handler(new URL(url))}) } as unknown as APIRequestContext;
}
const window = { start: new Date('2026-01-01T06:00:00Z'), end: new Date('2026-05-06T04:59:59Z') };

test('dashboard history uses bounded daily chunks and repeated measurement parameters', async () => {
  const urls: URL[]=[];
  const result=await extractEnergyDataFromDashboardApis(fixture(url=>{
    urls.push(url);
    const day=url.searchParams.get('start-date');
    if(url.pathname.includes('/energy/'))return {chart:{measurements:[{measurementTime:`${day}T00:00:00-06:00`,production:1234}]}};
    return {measurements:[{measurementTime:`${day}T12:00:00-05:00`,production:1.5}]};
  }),site,'749000',window);
  const daily=urls.filter(u=>u.pathname.includes('/energy/'));
  assert.ok(daily.length>=4);
  for(const url of daily){
    const from=url.searchParams.get('start-date')!;
    const to=url.searchParams.get('end-date')!;
    assert.ok((Date.parse(to)-Date.parse(from))/86400000<=30);
    assert.deepEqual(url.searchParams.getAll('measurement-types'),['production','yield']);
    assert.equal(url.searchParams.get('isCniViewer'),'true');
  }
  for(let i=1;i<daily.length;i++)assert.equal(Date.parse(daily[i].searchParams.get('start-date')!)-Date.parse(daily[i-1].searchParams.get('end-date')!),86400000);
  assert.equal(result[0].timestamp.toISOString(),'2026-01-01T06:00:00.000Z');
  assert.equal(result[0].energyWh,1234);
  assert.equal(result[0].powerW,null);
  assert.equal(result.at(-1)?.energyWh,0.375);
  assert.deepEqual(urls.at(-1)?.searchParams.getAll('measurement-types'),['production','storage-charge-level']);
});

const recent={start:new Date('2026-09-07T05:00:00Z'),end:new Date('2026-09-10T04:59:59Z')};
test('zero production is a reading; null production is not',async()=>{
  const result=await extractEnergyDataFromDashboardApis(fixture(()=>({measurements:[
    {measurementTime:'2026-09-08T00:00:00-05:00',production:null},
    {measurementTime:'2026-09-08T00:15:00-05:00',production:0},
  ]})),site,'749000',recent);
  assert.equal(result.length,1);assert.equal(result[0].energyWh,0);
  assert.equal(result[0].timestamp.toISOString(),'2026-09-08T05:15:00.000Z');
});
test('missing production fails instead of inventing a daily total',async()=>{
  await assert.rejects(extractEnergyDataFromDashboardApis(fixture(()=>({measurements:[{measurementTime:'2026-09-08T00:00:00-05:00',production:null}]})),site,'749000',recent),/no production measurements/);
});
for(const body of [{}, {measurements:[{measurementTime:'bad',production:100}]},{measurements:[{measurementTime:'2026-09-08T00:00:00',production:100}]},{measurements:[{measurementTime:'2026-09-08T00:00:00Z',production:-10}]},{measurements:[{measurementTime:'2026-09-08T00:00:00Z',production:'100'}]}]){
  test(`rejects invalid measurement schema ${JSON.stringify(body)}`,async()=>{
    await assert.rejects(extractEnergyDataFromDashboardApis(fixture(()=>body),site,'749000',recent),/invalid timestamped production/);
  });
}
test('provider API errors propagate without a DOM fallback',async()=>{
  await assert.rejects(extractEnergyDataFromDashboardApis(fixture(()=>({}),400),site,'749000',window),/daily energy failed \(HTTP 400\)/);
});

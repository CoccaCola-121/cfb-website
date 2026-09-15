import test from 'node:test';
import assert from 'node:assert/strict';
import '../offer-window.js';
import {onRequestPut} from '../functions/api/league/state.js';
const {locked,toUTC,localTime,validate} = globalThis.NZCFLOfferWindow;
test('offer schedules honor exact boundaries and optional open or close', () => {
  const state = {offersLocked:true,offerSchedule:{opensAt:'2026-09-15T15:00:00Z',closesAt:'2026-09-16T15:00:00Z'}};
  assert.equal(locked(state,Date.parse('2026-09-15T14:59:59Z')),true);
  assert.equal(locked(state,Date.parse(state.offerSchedule.opensAt)),false);
  assert.equal(locked(state,Date.parse(state.offerSchedule.closesAt)),true);
  assert.equal(locked({offersLocked:false,offerSchedule:{closesAt:state.offerSchedule.closesAt}},Date.parse(state.offerSchedule.opensAt)),false);
  assert.equal(locked({offersLocked:true}),true);
  assert.ok(validate({opensAt:state.offerSchedule.closesAt,closesAt:state.offerSchedule.opensAt}));
});
test('timezone conversion includes DST and rejects nonexistent or repeated times', () => {
  assert.equal(toUTC('2026-09-15T10:00','America/Chicago'),'2026-09-15T15:00:00.000Z');
  assert.equal(toUTC('2026-12-15T10:00','America/Chicago'),'2026-12-15T16:00:00.000Z');
  assert.equal(toUTC('2026-09-15T10:00','Asia/Kolkata'),'2026-09-15T04:30:00.000Z');
  assert.equal(localTime('2026-09-15T15:00:00Z','America/Los_Angeles'),'2026-09-15T08:00');
  assert.throws(()=>toUTC('2026-03-08T02:30','America/Chicago'),/does not exist/);
  assert.throws(()=>toUTC('2026-11-01T01:30','America/Chicago'),/occurs twice/);
});
test('server checks saved schedule even when stale client says offers are open', async () => {
  let writes=0;
  const previous={recruitingStage:'hs',offersLocked:false,offerSchedule:{closesAt:'2020-01-01T00:00:00Z'},offersByProspect:{}};
  const env={AUTH_KV:{get:async()=>previous,put:async()=>{writes++;}}};
  const incoming={...previous,offerSchedule:null,offersByProspect:{r1:[{id:'new',text:'Hello'}]}};
  const response=await onRequestPut({env,request:new Request('https://test/api/league/state',{method:'PUT',body:JSON.stringify({state:incoming})})});
  assert.equal(response.status,403);
  assert.equal(writes,0);
});

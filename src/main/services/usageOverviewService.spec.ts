import {describe,expect,it,vi} from 'vitest';
vi.mock('../store/chat',()=>({getDb:vi.fn()}));
import {aggregateUsageOverview} from './usageOverviewService';
const now=new Date(2026,9,28,12);
describe('usage overview aggregation',()=>{
 it('includes lifetime usage while padding only the last 365 local days',()=>{
  const result=aggregateUsageOverview([
   {date:'2020-01-01',model:'old',source:'main',prompt:100,completion:20,total:120,records:3},
   {date:'2026-10-28',model:'new',source:'main',prompt:2,completion:3,total:5,records:1},
   {date:'2026-10-28',model:'new',source:'delegation',prompt:3,completion:4,total:7,records:2},
   {date:'2026-10-28',model:'memory',source:'memory',prompt:1,completion:1,total:2,records:1}
  ],{activeDays:4,runCount:8},now);
  expect(result.daily).toHaveLength(365);expect(result.startDate).toBe('2025-10-29');expect(result.endDate).toBe('2026-10-28');
  expect(result.totals).toMatchObject({totalTokens:134,peakDailyTokens:120,records:7,activeDays:4,runCount:8});
  expect(result.daily[result.daily.length-1]).toMatchObject({totalTokens:14,models:{new:12,memory:2}});
  expect(result.sources).toEqual({main:125,delegation:7,memory:2});expect(result.models[0].model).toBe('old');
 });
 it('supports model identifiers that match object prototype keys',()=>{
  const result=aggregateUsageOverview([{date:'2026-10-28',model:'__proto__',source:'main',prompt:1,completion:1,total:2,records:1}],{activeDays:0,runCount:0},now);
  expect(result.daily[result.daily.length-1]!.models.__proto__).toBe(2);
 });
 it('provides a real zero state and local dates through leap years',()=>{
  const result=aggregateUsageOverview([],{activeDays:0,runCount:0},new Date(2024,2,1,12));
  expect(result.totals.totalTokens).toBe(0);expect(result.models).toEqual([]);expect(result.daily).toHaveLength(365);expect(result.daily[result.daily.length-2]!.date).toBe('2024-02-29');
 });
});

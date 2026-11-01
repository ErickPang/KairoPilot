import {describe,expect,it} from 'vitest';
import {isValidDateValue,localDateValue} from './dateValue';
describe('local calendar values',()=>{
 it('validates leap days without normalizing invalid dates',()=>{
  expect(isValidDateValue('2024-02-29')).toBe(true);expect(isValidDateValue('2026-02-29')).toBe(false);expect(isValidDateValue('2026-04-31')).toBe(false);
 });
 it('rejects partial or ambiguous dates',()=>{
  for(const value of ['','2026-1-03','10/28/2026','2026-13-01','2026-00-10'])expect(isValidDateValue(value)).toBe(false);
 });
 it('uses local calendar fields',()=>expect(localDateValue(new Date(2026,9,28,0,1))).toBe('2026-10-28'));
});

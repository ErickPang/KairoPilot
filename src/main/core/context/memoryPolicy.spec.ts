import {describe,it,expect} from 'vitest';
import {canKeepMemory} from './memoryPolicy';
describe('memory source boundary',()=>{
 const fact={key:'release-branch',content:'Use staging for releases.',quote:'Use staging for releases.'};
 it('requires an exact user source quote',()=>{expect(canKeepMemory(fact,'Remember: '+fact.quote)).toBe(true);expect(canKeepMemory(fact,'Use main for releases.')).toBe(false);});
 it('rejects credentials and redacted substitutes',()=>{expect(canKeepMemory({...fact,content:'password=private-value'},fact.quote)).toBe(false);expect(canKeepMemory({...fact,quote:'[REDACTED]'},'[REDACTED]')).toBe(false);});
 it('rejects empty topic identifiers after normalization',()=>{expect(canKeepMemory({...fact,key:'---'},fact.quote)).toBe(false);});
});

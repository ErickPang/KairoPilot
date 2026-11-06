import {describe,it,expect} from 'vitest';
import type {ProjectMemoryEntry} from '../../../shared/contracts';
import {selectRelevantMemories} from './memoryRecall';
const memory=(id:string,content:string,key=id):ProjectMemoryEntry=>({id,projectId:'project',key,content,quote:content,status:'active',revision:1,sourceSessionId:'task',sourceRunId:'run',updatedAt:1});
describe('bounded project memory recall',()=>{
 const entries=[memory('release','正式发布分支为 release-amber','releasebranch'),memory('report','验收报告采用中文','reportlanguage'),memory('owner','负责团队是 Cedar','moduleowner'),memory('folder','文件夹为 /synthetic/atlas','workspaceroot')];
 it.each([['上线使用哪个 branch','release'],['deployment branch?','release'],['release 分支','release'],['汇报用什么 language','report'],['谁是 maintainer','owner'],['directory 在哪里','folder']])('recalls a topic through alternate wording: %s',(query,id)=>expect(selectRelevantMemories(entries,query)[0]?.id).toBe(id));
 it('uses topic keys when the fact contains only a terse value',()=>expect(selectRelevantMemories([memory('branch','release-amber','releasebranch')],'上线用哪一条分支')[0]?.id).toBe('branch'));
 it('does not fall back to unrelated or unconfirmed records',()=>{expect(selectRelevantMemories(entries,'烹饪温度是多少')).toEqual([]);expect(selectRelevantMemories([{...entries[0],status:'conflict'}],'release branch')).toEqual([]);expect(selectRelevantMemories(entries,'')).toEqual([]);});
 it('keeps a useful short entry when an earlier high-scoring entry cannot fit',()=>{const records=[memory('large','发布分支'.repeat(1000)),memory('small','发布分支为 main')];expect(selectRelevantMemories(records,'发布分支').map(item=>item.id)).toEqual(['small']);});
 it('retains snapshots within six entries and the existing character budget',()=>{const records=Array.from({length:10},(_,index)=>memory(String(index),'发布分支 '+index+'x'.repeat(700)));const result=selectRelevantMemories(records,'发布分支');expect(result.length).toBeLessThanOrEqual(6);expect(result.reduce((sum,item)=>sum+item.content.length,0)).toBeLessThanOrEqual(3200);expect(result.every(item=>item.revision===1)).toBe(true);});
});

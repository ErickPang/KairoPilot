import type {ProjectMemoryEntry,ProjectMemorySnapshot} from '../../../shared/contracts';
import {normalizeMemoryText} from './memoryPolicy';

const concepts=[
 ['发布','上线','发版','release','deploy','deployment'],
 ['分支','branch'],['验收','验证','测试','acceptance','validation','test'],
 ['语言','language'],['负责人','负责团队','归属','owner','maintainer'],
 ['报告','汇报','report'],['技术栈','框架','techstack','framework'],
 ['超时','timeout'],['权限','访问控制','permission'],
 ['目录','文件夹','folder','directory','workspace'],['数据库','database','db'],
] as const;
const ignoredWords=new Set(['the','and','for','with','this','that','what','please','project']);
function features(value:string,key=false){
 const lower=value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
 const words=new Set(lower.match(/[a-z][a-z0-9_-]*/g)||[]);
 return new Set(concepts.flatMap((aliases,index)=>aliases.some(alias=>/[\u3400-\u9fff]/.test(alias)?lower.includes(alias):words.has(alias)||key&&alias.length>=4&&normalizeMemoryText(lower).includes(alias))?[index]:[]));
}
function scoreMemory(item:ProjectMemoryEntry,query:string):number {
 const text=normalizeMemoryText(query);
 const target=normalizeMemoryText(`${item.key} ${item.content} ${item.quote}`);
 const queryConcepts=features(query);
 const targetConcepts=new Set([...features(item.content+' '+item.quote),...features(item.key,true)]);
 const conceptual=[...queryConcepts].filter(term=>targetConcepts.has(term)).length;
 const words=[...new Set(query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[])].filter(term=>!ignoredWords.has(term));
 const exactWords=words.filter(term=>target.includes(normalizeMemoryText(term))).length;
 const pairs=new Set(Array.from({length:Math.max(0,text.length-1)},(_,index)=>text.slice(index,index+2)).filter(term=>/[\u3400-\u9fff]/.test(term)));
 const overlap=[...pairs].filter(term=>target.includes(term)).length;
 return conceptual*20+exactWords*10+overlap;
}
export function selectRelevantMemories(items:ProjectMemoryEntry[],query:string):ProjectMemorySnapshot['entries'] {
 if(!query.trim())return [];
 const ranked=items.filter(item=>item.status==='active').map(item=>({item,score:scoreMemory(item,query)})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||b.item.updatedAt-a.item.updatedAt||a.item.id.localeCompare(b.item.id));
 const entries:ProjectMemorySnapshot['entries']=[];let length=0;
 for(const {item} of ranked){
  if(entries.length===6)break;
  if(length+item.content.length>3200)continue;
  entries.push({id:item.id,revision:item.revision,content:item.content});length+=item.content.length;
 }
 return entries;
}

import type {ChatMessage} from '../llm/types';

/** Keep assistant tool-call envelopes and their results together. Orphan results are never sent. */
export function historyGroups(history:ChatMessage[]){
 const groups:ChatMessage[][]=[];
 for(let i=0;i<history.length;i++){
  const message=history[i];if(message.role==='system'||message.role==='tool')continue;
  const group=[message];
  if(message.role==='assistant'&&message.tool_calls?.length){
   const ids=new Set(message.tool_calls.map(call=>call.id).filter((id):id is string=>typeof id==='string'));
   while(i+1<history.length&&history[i+1].role==='tool'){
    const result=history[++i];if(result.tool_call_id&&ids.has(result.tool_call_id))group.push(result);
   }
   const resultIds=new Set(group.slice(1).map(result=>result.tool_call_id));
   if(ids.size!==message.tool_calls.length||resultIds.size!==ids.size||group.length!==ids.size+1)continue;
  }
  groups.push(group);
 }
 return groups;
}
export function compactToolResult(message:ChatMessage,maxBytes=12000):ChatMessage {
 if(message.role!=='tool'||Buffer.byteLength(message.content,'utf8')<=maxBytes)return message;
 let text=message.content;while(Buffer.byteLength(text,'utf8')>maxBytes)text=text.slice(0,Math.floor(text.length*0.8));
 return {...message,content:`${text}\n[Tool output shortened for model context. Original result remains in this run's execution record; read a smaller range or rerun a narrower query if needed.]`};
}

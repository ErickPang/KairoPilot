import {randomUUID} from 'node:crypto';
import type {QueuedTaskMessage} from '../../shared/contracts';
import {getDb} from './chat';
export interface StoredQueueMessage extends QueuedTaskMessage {basis:string;draftRevision:number}
export function queueMessage(id:string):StoredQueueMessage|undefined{
 const row=getDb().prepare('SELECT data FROM task_message_queue WHERE id=?').get(id) as {data:string}|undefined;
 return row?JSON.parse(row.data):undefined;
}
export function queuedMessages(sessionId?:string):StoredQueueMessage[]{
 const rows=getDb().prepare(`SELECT data FROM task_message_queue WHERE status!='sent' ${sessionId?'AND session_id=?':''} ORDER BY position,rowid`).all(...(sessionId?[sessionId]:[])) as {data:string}[];
 return rows.map(row=>JSON.parse(row.data));
}
export function saveQueueMessage(item:StoredQueueMessage){
 getDb().prepare('INSERT INTO task_message_queue VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,status=excluded.status,revision=excluded.revision,data=excluded.data').run(item.id,item.sessionId,item.draftRevision,item.position,item.status,item.revision,JSON.stringify(item));
}
export function insertQueueMessage(value:Omit<StoredQueueMessage,'id'|'position'|'revision'|'createdAt'>){
 const item={...value,id:randomUUID(),position:Date.now()*1000,revision:1,createdAt:Date.now()};
 const last=getDb().prepare('SELECT MAX(position) AS position FROM task_message_queue').get() as {position:number|null};
 item.position=Math.max(item.position,(last.position||0)+1);saveQueueMessage(item);return item;
}
export function updateQueueMessage(item:StoredQueueMessage,patch:Partial<StoredQueueMessage>){
 const current=queueMessage(item.id);if(!current||current.revision!==item.revision)throw new Error('Queued message changed. Reload it.');
 const next={...current,...patch,revision:current.revision+1};saveQueueMessage(next);return next;
}
export function recoverTaskQueue(db=getDb()){
 const rows=db.prepare("SELECT data FROM task_message_queue WHERE status!='sent'").all() as {data:string}[];
 for(const row of rows){const item:StoredQueueMessage=JSON.parse(row.data);const next={...item,status:'blocked' as const,revision:item.revision+1,error:'Application restarted. Review and continue the queue explicitly.'};db.prepare("UPDATE task_message_queue SET status='blocked',revision=?,data=? WHERE id=?").run(next.revision,JSON.stringify(next),item.id);}
}

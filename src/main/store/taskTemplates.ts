import {randomUUID} from 'node:crypto';
import type {TaskTemplate} from '../../shared/contracts';
import {BUILTIN_TASK_TEMPLATES} from '../../shared/taskTemplates';
import {getDb} from './chat';
export function listTaskTemplates():TaskTemplate[] {
 const custom=(getDb().prepare('SELECT data FROM task_templates ORDER BY rowid DESC').all() as Array<{data:string}>).map(row=>JSON.parse(row.data) as TaskTemplate);
 return structuredClone([...BUILTIN_TASK_TEMPLATES,...custom]);
}
export function getTaskTemplate(id:string):TaskTemplate {
 const template=listTaskTemplates().find(item=>item.id===id);
 if(!template)throw new Error('Task template is unavailable.');
 return template;
}
export function saveTaskTemplate(value:Pick<TaskTemplate,'name'|'instructions'|'output'|'acceptance'> & {id?:string;version?:number}) {
 return getDb().transaction(()=>{
  const previous=value.id?getTaskTemplate(value.id):undefined;
  if(previous?.builtin)throw new Error('Save a copy to customize a built-in template.');
  if(previous&&previous.version!==value.version)throw new Error('Template changed. Reload before saving.');
  const template:TaskTemplate={id:previous?.id || randomUUID(),version:(previous?.version || 0)+1,name:value.name,instructions:value.instructions,output:value.output,acceptance:value.acceptance,builtin:false};
  getDb().prepare('INSERT INTO task_templates(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(template.id,JSON.stringify(template));
  return template;
 })();
}

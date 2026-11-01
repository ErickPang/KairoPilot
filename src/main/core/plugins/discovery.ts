import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pluginManager} from './manager';
import type {PermissionGuard} from '../security/permissions';
import type {ToolDefinition} from '../llm/types';
import {toolOk} from '../tools/result';

export interface DeferredToolSelection {pluginId:string;scope:string;names:string[]}
export function pluginToolName(pluginId:string,scope:string,name:string) {
  const prefix=createHash('sha256').update(`${scope}:${pluginId}`).digest('hex').slice(0,12);
  const suffix=createHash('sha256').update(name).digest('hex').slice(0,8);
  return `plugin_${prefix}__${name.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,31)}_${suffix}`;
}
export function createPluginDiscovery(agentId:string,permissions:PermissionGuard,register:(tool:ToolDefinition)=>void) {
  const load=async (selection:DeferredToolSelection) => {
    const tools=await pluginManager.loadPluginTools(selection,agentId,permissions);
    return tools.map(tool=>{
      const exposed={...tool,metadata:{...tool.metadata,originalToolName:tool.name},name:pluginToolName(selection.pluginId,selection.scope,tool.name)};
      register(exposed);return {name:exposed.name,description:exposed.description,pluginId:selection.pluginId};
    });
  };
  const search:ToolDefinition={
    name:'search_tools',
    description:'Search enabled plugin tools by capability, plugin id or tool name. Loads up to 5 matching parameter schemas for subsequent calls. Discovery does not execute the plugin action. If no match, try another query or report the missing capability.',
    parameters:z.object({query:z.string().trim().min(1).max(300),limit:z.number().int().min(1).max(5).optional()}),
    execute:async args=>{
      const query=String(args.query).toLowerCase();
      const tokens=query.match(/[\p{L}\p{N}_-]+/gu)||[];
      const catalog=await pluginManager.listToolCatalog(agentId,permissions);
      const matches=catalog.map(item=>{
        const identity=`${item.pluginId} ${item.pluginName} ${item.name}`.toLowerCase();
        const text=`${identity} ${item.description} ${item.pluginDescription}`.toLowerCase();
        return {item,score:tokens.reduce((score,token)=>score+(identity.includes(token)?4:text.includes(token)?1:0),0)};
      }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.item.pluginId.localeCompare(b.item.pluginId)||a.item.name.localeCompare(b.item.name)).slice(0,Number(args.limit)||5);
      const selected=new Map<string,DeferredToolSelection>();
      for(const {item} of matches){const key=`${item.scope}:${item.pluginId}`;const group=selected.get(key)||{pluginId:item.pluginId,scope:item.scope,names:[]};group.names.push(item.name);selected.set(key,group);}
      const loaded=[];
      for(const selection of selected.values())loaded.push(...await load(selection));
      return toolOk({tools:loaded,matched:matches.length,notice:loaded.length?'Use the returned names on the next model step.':'No enabled, permission-eligible tools matched. No plugin action was executed.'});
    }
  };
  return {search,load};
}

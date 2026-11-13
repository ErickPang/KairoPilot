import {beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import type {PermissionGuard} from '../security/permissions';
import type {ToolDefinition} from '../llm/types';
const mocks=vi.hoisted(()=>({listToolCatalog:vi.fn(),loadPluginTools:vi.fn()}));
vi.mock('./manager',()=>({pluginManager:mocks}));
import {createPluginDiscovery,pluginToolName} from './discovery';
describe('deferred plugin discovery',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('does not evaluate code on construction; searches metadata then loads only matched tools',async()=>{
  const execute=vi.fn();const register=vi.fn();const guard={} as PermissionGuard;
  const discovery=createPluginDiscovery('workbench',guard,register);expect(mocks.loadPluginTools).not.toHaveBeenCalled();
  mocks.listToolCatalog.mockResolvedValue([{pluginId:'weather',pluginName:'Weather',scope:'public',name:'forecast',description:'City forecast',pluginDescription:'Weather forecasts'},{pluginId:'finance',pluginName:'Finance',scope:'public',name:'quote',description:'Asset quotes',pluginDescription:'Prices'}]);
  mocks.loadPluginTools.mockResolvedValue([{name:'forecast',description:'Forecast',parameters:z.object({city:z.string()}),execute,metadata:{source:'plugin',pluginId:'weather',pluginScope:'public'}}] satisfies ToolDefinition[]);
  const result=await discovery.search.execute({query:'weather',limit:1});expect(mocks.loadPluginTools).toHaveBeenCalledExactlyOnceWith({pluginId:'weather',scope:'public',names:['forecast']},'workbench',guard,undefined);expect(register).toHaveBeenCalledWith(expect.objectContaining({name:pluginToolName('weather','public','forecast')}));expect(execute).not.toHaveBeenCalled();expect(JSON.stringify(result)).toContain(pluginToolName('weather','public','forecast'));
 });
 it('does not load a best guess when no tool matches',async()=>{mocks.listToolCatalog.mockResolvedValue([{pluginId:'weather',name:'forecast',pluginName:'Weather',scope:'public',description:'forecast',pluginDescription:'weather'}]);await createPluginDiscovery('workbench',{} as PermissionGuard,vi.fn()).search.execute({query:'unrelated'});expect(mocks.loadPluginTools).not.toHaveBeenCalled();});
 it('rejects restored approvals when package or tool definitions changed',async()=>{const register=vi.fn();mocks.loadPluginTools.mockResolvedValue([{name:'forecast',metadata:{source:'plugin',pluginPackageHash:'new',pluginCatalogHash:'new'}}]);const discovery=createPluginDiscovery('workbench',{} as PermissionGuard,register,()=> 'task');await expect(discovery.load({pluginId:'weather',scope:'public',names:['forecast'],packageHash:'old',catalogHash:'old'})).rejects.toThrow('changed');expect(register).not.toHaveBeenCalled();});
 it('namespaces equal tool names across plugins and scopes with bounded names',()=>{const names=[pluginToolName('a','public','read_file'),pluginToolName('b','public','read_file'),pluginToolName('a','agent:x','read_file'),pluginToolName('a','public','x'.repeat(100)+'a'),pluginToolName('a','public','x'.repeat(100)+'b')];expect(new Set(names).size).toBe(5);expect(names.every(name=>name.length<=64&&/^[\w-]+$/.test(name))).toBe(true);expect(names).not.toContain('read_file');});
});

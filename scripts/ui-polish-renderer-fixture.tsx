import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../src/renderer/App';
import {I18nProvider} from '../src/renderer/components/layout/I18nProvider';
import {installWorkbenchPreview} from '../src/renderer/workbenchPreview';
import {KAIRO_INVOKE as C} from '../src/shared/ipc';
import type {SkillSummary,PluginRegistryEntry,KairoPilotConfig} from '../src/shared/contracts';
import '../src/renderer/index.css';

// Synthetic browser bridge: no native file operations, network or model calls.
installWorkbenchPreview();
const original=window.kairo.invoke as (channel:string,...args:unknown[])=>Promise<unknown>;
const titles=['项目资料整理','绘本分镜提示词','主题讲解视频','AI 新闻核验','公开关键词调研','邮件处理助手'];
let skills:SkillSummary[]=titles.map((name,index)=>({id:`fixture-${index}`,name,description:index===4?'按公开来源整理关键词、检查搜索意图并保留核验依据。'.repeat(8):['整理项目中的资料，形成摘要与后续核验清单。','按布局和风格生成语义一致的绘本分镜提示词。','根据主题设计画面，以配音为主线制作讲解视频。','核验官方来源，整理新闻事实与创作方向。','按公开来源整理关键词与核验依据。','通过工具处理邮件，发送前遵守用户授权。'][index],content:`# ${name}\n\n仅用于界面验收的合成技能内容。\n执行前核对用户目标与授权。${index===1?'\n合成技能正文\n'.repeat(100):''}`,source:index<4?'public':'agent',allowedTools:['Read'],removable:true,version:'1.0.0',rollbackAvailable:index===0}));
let plugins:PluginRegistryEntry[]=Array.from({length:28},(_,index)=>({id:`plugin-fixture-${index}`,name:['资料检索助手','文件格式转换','项目检查工具','文档提取助手'][index%4]+(index>3?` ${index}`:''),description:'仅用于界面验收的合成插件，按用户目标处理资料并保留结果。',version:'1.0.0',author:'Synthetic fixture',installedAt:100-index,filePath:'/synthetic/plugins/fixture.js',scope:'public',enabled:true,riskLevel:'medium',tools:[{name:'synthetic_read',description:'合成工具'}],capabilities:[{id:'read',label:'读取指定文件',description:'合成权限说明',riskLevel:'low',requiredPermissions:{fileSystem:{read:true}}}],previousVersion:{version:'0.9.0',filePath:'/synthetic/backup.js',backedUpAt:1}}));
window.kairo.invoke=(async(channel:string,...args:unknown[])=>{
  if(channel===C.configGetAll){const config=await original(channel,...args) as KairoPilotConfig;const count=Number(new URLSearchParams(location.search).get('model-count')||1);config.models.providers=Object.fromEntries(Array.from({length:count},(_,index)=>[index?'provider'+index:'preview',{provider:'custom',apiKey:'',baseUrl:'',model:[{id:'demo-model',name:'Synthetic model'}]}]));return config;}
  if(channel===C.pluginsGetInstalled)return plugins.slice(0,Number(document.documentElement.dataset.pluginCount||4));
  if(channel===C.pluginsGetStore||channel===C.pluginsGetStoreByRegistry)return [];
  if(channel===C.pluginsSetEnabled){const value=args[0] as {id:string;enabled:boolean};plugins=plugins.map(plugin=>plugin.id===value.id?{...plugin,enabled:value.enabled}:plugin);return {success:true};}
  if(channel===C.pluginsUninstall){const id=(args[0] as {id:string}).id;plugins=plugins.filter(plugin=>plugin.id!==id);return {success:true};}
  if(channel===C.pluginsRollback){document.documentElement.dataset.pluginRollback='true';return {success:true};}
  if(channel===C.systemSelectFile)return '/synthetic/plugin.zip';
  if(channel===C.pluginsPrepareUpdate||channel===C.pluginsPrepareImport){const value=args[0] as {id?:string};return {requestId:'synthetic-review',pluginId:value.id||'synthetic-import',pluginName:'合成插件审核',scope:'public',version:'1.0.1',author:'Synthetic fixture',recommendation:'caution',summary:'合成审核：确认后才安装。',findings:[],downloadedBytes:120,codeHash:'synthetic-hash',operation:channel===C.pluginsPrepareUpdate?'update':'import'};}
  if(channel===C.pluginsDiscardInstall)return {success:true};
  if(channel===C.skillsGetAll)return {public:skills.filter(skill=>skill.source==='public'),workbench:skills.filter(skill=>skill.source==='agent')};
  if(channel===C.skillsGetRegistry||channel===C.skillsGetStoreByQuery)return [];
  if(channel===C.configSaveAppearance||channel===C.skillsSetRegistry)return {success:true};
  if(channel===C.skillsUninstall){const id=(args[0] as {id:string}).id;skills=skills.filter(skill=>skill.id!==id);return {success:true};}
  if(channel===C.skillsRollback){document.documentElement.dataset.rollback='true';return {success:true};}
  if(channel===C.configGetWebSearch)return {timeoutMs:10000,preferredProviders:['bing'],providers:{searxng:{enabled:false,baseUrl:''},tavily:{enabled:false,baseUrl:'',apiKey:''},bing:{enabled:true},duckduckgo:{enabled:false},baidu:{enabled:false}}};
  return original(channel,...args);
}) as KairoBridge['invoke'];
createRoot(document.getElementById('root')!).render(<I18nProvider><App/></I18nProvider>);

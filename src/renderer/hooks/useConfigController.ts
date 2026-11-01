import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import type { AgentConfig,AppConfirmationOptions, KairoPilotConfig,SessionContextState,SessionContextUpdate,WorkbenchSettingsInput } from '../types';
import type { I18nContextValue } from '../components/layout/I18nContext';
import { toModelList } from './configUtils';
import { useModelConfig } from './useModelConfig';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { createErrorNotice,getErrorMessage } from './errorUtils';
interface Options {
  sessionContext:SessionContextState;
  requestConfirmation:(request:AppConfirmationOptions)=>Promise<boolean>;
  t:I18nContextValue['t'];updateSessionContext:(patch:SessionContextUpdate)=>void;
  loadActiveSession:()=>Promise<void>;loadSessions:()=>Promise<void>;
}
export function useConfigController({requestConfirmation,t,updateSessionContext,loadActiveSession,loadSessions}:Options) {
  const [config,setConfig]=useState<KairoPilotConfig|null>(null);
  const initialization=useRef<Promise<unknown>|null>(null);
  const [initializing,setInitializing]=useState(true);
  const refreshConfig=useCallback(async()=> {
    const value=await window.kairo.invoke(KAIRO_INVOKE.configGetAll);
    setConfig(value);updateSessionContext({activeAgentId:'workbench'});return value;
  },[updateSessionContext]);
  useEffect(()=> {
    let cancelled=false;
    const load=async()=> {
      try {
        await refreshConfig();
        initialization.current ||= window.kairo.invoke(KAIRO_INVOKE.workbenchInit).finally(()=> {initialization.current=null;});
        const result=await initialization.current as {success?:boolean;error?:string};
        if(cancelled)return;
        if(!result.success)throw new Error(result.error || 'Workbench initialization failed.');
        updateSessionContext(current=>current.appNotice?.source==='auto_init'?{appNotice:null}:{});
        await loadSessions();await loadActiveSession();
      } catch(error) {if(!cancelled)updateSessionContext({appNotice:createErrorNotice(getErrorMessage(error),'auto_init')});}
      finally {if(!cancelled)setInitializing(false);}
    };
    void load();return()=>{cancelled=true;};
  },[refreshConfig,loadActiveSession,loadSessions,updateSessionContext,t]);
  const models=useMemo(()=>toModelList(config?.models.providers || {}),[config]);
  const workbench=config?.workbench;
  const agent=useMemo<AgentConfig|null>(()=>workbench?{id:'workbench',name:'KairoPilot',workspace:workbench.managementRoot,model:workbench.defaultModel,permissions:workbench.permissions,systemPrompt:workbench.instructions}:null,[workbench]);
  const modelActions=useModelConfig({requestConfirmation,refreshConfig:async()=>{await refreshConfig();},reportConfigError:(message,source)=>updateSessionContext({appNotice:createErrorNotice(message,source)}),t});
  const handleSaveWorkbench=useCallback(async(value:WorkbenchSettingsInput)=> {
    const result=await window.kairo.invoke(KAIRO_INVOKE.configSaveWorkbench,{defaultModel:value.defaultModel,permissions:value.permissions,instructions:value.instructions});
    if(!result.success)throw new Error(result.error || 'Unable to save workbench settings.');
    await refreshConfig();
  },[refreshConfig]);
  return {...modelActions,models,workbench,handleSaveWorkbench,refreshWorkbenchConfig:refreshConfig,initializing,agents:agent?[agent]:[],activeAgentName:'KairoPilot'};
}

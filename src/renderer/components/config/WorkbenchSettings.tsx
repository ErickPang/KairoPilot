import {Select} from '../Select';
import {ProjectMemorySettings} from '../ProjectMemoryPanel';
import { useEffect,useState,useRef } from 'react';
import type { ModelConfig,WorkbenchConfig,WorkbenchSettingsInput } from '../../types';
import { createDefaultPolicyConfig, type ExecutionProfile } from '../../../shared/contracts';
import { useTranslation } from '../../hooks/useTranslation';
interface Props {config:WorkbenchConfig;models:ModelConfig[];section:string;onSave:(value:WorkbenchSettingsInput)=>Promise<void>}
export function WorkbenchSettings({config,models,section,onSave}:Props) {
  const {t}=useTranslation();
  const [draft,setDraft]=useState(config);
  const [error,setError]=useState('');const [saving,setSaving]=useState(false);const [saved,setSaved]=useState(false);const lastSaved=useRef('');
  useEffect(()=>{setDraft(config);setSaved(current=>current&&lastSaved.current===JSON.stringify([config.defaultModel,config.permissions,config.instructions]));},[config]);
  const patchPermissions=(value:Partial<WorkbenchConfig['permissions']>)=>{setSaved(false);setDraft(current=>({...current,permissions:{...current.permissions,...value}}));};
  const save=async()=>{setSaving(true);setError('');try{await onSave({defaultModel:draft.defaultModel,permissions:draft.permissions,instructions:draft.instructions});lastSaved.current=JSON.stringify([draft.defaultModel,draft.permissions,draft.instructions]);setSaved(true);}catch(reason){setError(String(reason));}finally{setSaving(false);}};
  return <div className="workbench-settings-form">
    {section==='execution' ? <>
      <section className="settings-card">
      <label className="form-group settings-row"><span>{t('workbench.defaultModel')}</span><Select aria-label={t('workbench.defaultModel')} searchable value={draft.defaultModel} onChange={value=>{setSaved(false);setDraft({...draft,defaultModel:value});}} options={[{value:'',label:t('chat.selectModelTitle')},...models.flatMap(provider=>(provider.availableModels?.length?provider.availableModels:[{id:provider.model,name:provider.model}]).map(model=>({value:`${provider.id}/${model.id}`,label:model.id,group:provider.name})))]}/><small>{t('workbench.defaultsScope')}</small></label>
      <label className="form-group settings-row"><span>{t('workbench.defaultProfile')}</span><Select aria-label={t('workbench.defaultProfile')} value={draft.permissions.executionProfile} onChange={value=>{const profile=value as ExecutionProfile;patchPermissions({executionProfile:profile,policy:createDefaultPolicyConfig(profile)});}} options={(['chat_only','read_only_workspace','approved_execution','trusted_automation'] as const).map(profile=>({value:profile,label:t(`config.executionProfile.${profile}`)}))}/></label>
      </section>
      <section className="config-card"><h3>{t('workbench.capabilityLimits')}</h3><p className="config-subtitle">{t('workbench.capabilityLimitsHelp')}</p>
        <label className="workbench-checkbox"><input type="checkbox" checked={draft.permissions.fileSystem.read} onChange={event=>patchPermissions({fileSystem:{...draft.permissions.fileSystem,read:event.target.checked}})}/>{t('workbench.allowRead')}</label>
        <label className="workbench-checkbox"><input type="checkbox" checked={draft.permissions.fileSystem.write} onChange={event=>patchPermissions({fileSystem:{...draft.permissions.fileSystem,write:event.target.checked}})}/>{t('workbench.allowWrite')}</label>
        <label className="workbench-checkbox"><input type="checkbox" checked={draft.permissions.shell.enabled} onChange={event=>patchPermissions({shell:{...draft.permissions.shell,enabled:event.target.checked}})}/>{t('workbench.allowShell')}</label>
        <label className="form-group"><span>{t('workbench.allowedCommands')}</span><textarea className="form-control" value={draft.permissions.shell.allowedCommands.join('\n')} onChange={event=>patchPermissions({shell:{...draft.permissions.shell,allowedCommands:event.target.value.split('\n').map(item=>item.trim()).filter(Boolean)}})}/></label>
        <label className="workbench-checkbox"><input type="checkbox" checked={draft.permissions.network.enabled} onChange={event=>patchPermissions({network:{...draft.permissions.network,enabled:event.target.checked}})}/>{t('workbench.allowNetwork')}</label>
        <label className="form-group"><span>{t('workbench.allowedDomains')}</span><textarea className="form-control" value={draft.permissions.network.allowedDomains.join('\n')} onChange={event=>patchPermissions({network:{...draft.permissions.network,allowedDomains:event.target.value.split('\n').map(item=>item.trim()).filter(Boolean)}})}/></label>
      </section>
    </> : <>
      <label className="form-group instruction-editor"><span>AGENTS.md</span><small>{config.instructionPath}</small><textarea className="form-control workbench-rule-input" value={draft.instructions} maxLength={32768} onChange={event=>{setSaved(false);setDraft({...draft,instructions:event.target.value});}}/></label>
      <ProjectMemorySettings/>

    </>}
    {error&&<p role="alert" className="workbench-error">{error}</p>}{saved&&<p role="status">{t('workbench.settingsSaved')}</p>}
    <div className="form-actions"><button type="button" className="btn btn-primary" disabled={saving} data-save-workbench onClick={()=>void save()}>{saving?t('common.loading'):t('common.save')}</button></div>
  </div>;
}

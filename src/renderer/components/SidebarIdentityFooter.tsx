import {IconBot,IconSettings} from './Icons';
import {useTranslation} from '../hooks/useTranslation';

export function SidebarIdentityFooter({name,disabled,onOpenSettings}:{name:string;disabled:boolean;onOpenSettings:()=>void}){
 const {t}=useTranslation();
 return <div className="sidebar-identity-footer" data-sidebar-identity>
  <IconBot size={18}/><span title={name||'KairoPilot'}>{name||'KairoPilot'}</span>
  <button type="button" data-nav-tab="settings" className="workbench-icon-button workbench-settings-entry" disabled={disabled} onClick={onOpenSettings} title={t('nav.settings')} aria-label={t('nav.settings')}><IconSettings size={18}/></button>
 </div>;
}

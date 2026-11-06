import type { ComponentProps } from 'react';
import { Sidebar } from './Sidebar';
import { SidebarIdentityFooter } from './SidebarIdentityFooter';
import { useTranslation } from '../hooks/useTranslation';

type Tab = 'chat' | 'dashboard' | 'plugins' | 'skills' | 'settings';
interface Props {
  collapsed: boolean;
  hidden: boolean;
  agentId: string | null;
  name: string;
  disabled: boolean;
  onTabChange: (tab: Tab) => void;
  onOpenSettings: () => void;
  sidebar: ComponentProps<typeof Sidebar>;
}

export function WorkbenchNavigation(props: Props) {
  const { t } = useTranslation();
  return <aside className={`workbench-navigation ${props.collapsed ? 'is-collapsed' : ''} ${props.hidden ? 'is-settings-hidden' : ''}`}>
    <div className="workbench-task-navigation"><Sidebar key={props.agentId} {...props.sidebar}/></div>
    {props.disabled && <p className="workbench-navigation-hint">{t('workbench.navigationLocked')}</p>}
    <SidebarIdentityFooter name={props.name} disabled={props.disabled} onOpenSettings={props.onOpenSettings}/>
  </aside>;
}

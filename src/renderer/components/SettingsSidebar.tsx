import { ArrowLeft } from 'lucide-react';
import { IconCpu, IconBot, IconSettings, IconPlugin, IconSkill, IconDashboard } from './Icons';
import './SettingsSidebar.css';
import { SidebarIdentityFooter } from './SidebarIdentityFooter';
import { useTranslation } from '../hooks/useTranslation';

interface SettingsSidebarProps {
  activeSection: string;
  disabled: boolean;
  agentName: string;
  onSelectSection: (sectionId: string) => void;
  onBack: () => void;
}

export function SettingsSidebar({ activeSection, disabled, agentName, onSelectSection, onBack }: SettingsSidebarProps) {
  const { t } = useTranslation();
  const groups = [
    { label: t('settings.group.basic'), sections: [
      { id: 'general', label: t('settings.general'), icon: IconSettings },
      { id: 'model', label: t('settings.models'), icon: IconCpu },
    ] },
    { label: t('settings.group.capabilities'), sections: [
      { id: 'execution', label: t('workbench.executionSettings'), icon: IconBot },
      { id: 'rules', label: t('workbench.rulesSettings'), icon: IconSettings },
      { id: 'plugins', label: t('nav.plugins'), icon: IconPlugin },
      { id: 'skills', label: t('nav.skills'), icon: IconSkill },
    ] },
    { label: t('settings.group.data'), sections: [
      { id: 'dashboard', label: t('nav.dashboard'), icon: IconDashboard },
    ] },
  ];

  return (
    <aside className="settings-sidebar workbench-settings-navigation" aria-label={t('settings.title')}>
      <button type="button" data-settings-back className="settings-back-button" onClick={onBack}>
        <ArrowLeft size={17} /><span>{t('settings.backToWorkspace')}</span>
      </button>
      <nav className="settings-sidebar-menu">
        {groups.map(group => <div className="settings-menu-group" key={group.label}>
          <h2>{group.label}</h2>
          {group.sections.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" data-settings-section={id}
              data-nav-tab={['general', 'model', 'execution', 'rules'].includes(id) ? undefined : id}
              className={`settings-menu-item ${activeSection === id ? 'active' : ''}`}
              aria-current={activeSection === id ? 'page' : undefined}
              disabled={disabled && ['general', 'model', 'execution', 'rules'].includes(id)}
              onClick={() => onSelectSection(id)} title={label}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </div>)}
      </nav>
      <SidebarIdentityFooter name={agentName} disabled={disabled} onOpenSettings={()=>onSelectSection('general')}/>
    </aside>
  );
}

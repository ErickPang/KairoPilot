import { IconCpu, IconBot, IconSettings } from './Icons';
import './SettingsSidebar.css';
import { useTranslation } from '../hooks/useTranslation';

interface SettingsSidebarProps {
  activeSection: string;
  onSelectSection: (sectionId: string) => void;
}

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const { t } = useTranslation();

  const sections = [
    { id: 'general', label: t('settings.general'), icon: IconSettings },
    { id: 'model', label: t('settings.models'), icon: IconCpu },
    { id: 'agent', label: t('settings.agents'), icon: IconBot },
  ];

  return (
    <div className="settings-sidebar">
      <div className="settings-sidebar-header">
        <h2>{t('settings.title')}</h2>
        <p>{t('settings.subtitle')}</p>
      </div>
      
      <div className="settings-sidebar-menu">
        {sections.map(section => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          
          return (
            <button
              key={section.id}
              type="button"
              className={`settings-menu-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(section.id)}
              title={section.label}
            >
              <Icon size={20} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

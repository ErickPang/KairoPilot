import { IconCpu, IconBot } from './Icons';
import './SettingsSidebar.css';

interface SettingsSidebarProps {
  activeSection: string;
  onSelectSection: (sectionId: string) => void;
}

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const sections = [
    { id: 'model', label: 'Model Configuration', icon: IconCpu },
    { id: 'agent', label: 'Agent Capabilities', icon: IconBot },
  ];

  return (
    <div className="settings-sidebar">
      <div className="settings-sidebar-header">
        <h2>Settings</h2>
      </div>
      
      <div className="settings-sidebar-menu">
        {sections.map(section => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;
          
          return (
            <button
              key={section.id}
              className={`settings-menu-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(section.id)}
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

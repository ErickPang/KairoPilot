import { IconCpu, IconBot } from './Icons';

interface SettingsSidebarProps {
  activeSection: string;
  onSelectSection: (section: string) => void;
}

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const sections = [
    { id: 'model', label: 'Model Configuration', icon: IconCpu },
    { id: 'agent', label: 'Agent Capabilities', icon: IconBot },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header" style={{ paddingLeft: '1rem', fontWeight: 600 }}>
        Settings
      </div>
      <div className="session-list">
        {sections.map(section => (
          <div 
            key={section.id} 
            className={`session-item ${section.id === activeSection ? 'active' : ''}`}
            onClick={() => onSelectSection(section.id)}
            style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <section.icon size={18} />
            <span className="session-title">{section.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

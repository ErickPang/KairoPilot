import { useState } from 'react';
import { Session } from '../types';
import { IconPlus, IconEdit, IconTrash } from './Icons';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  handleCreateSession: () => void;
  handleSelectSession: (id: string) => void;
  handleDeleteSession: (e: React.MouseEvent, id: string) => void;
  handleUpdateSessionTitle: (id: string, title: string) => void;
}

export function Sidebar({ 
  sessions, 
  activeSessionId, 
  handleCreateSession, 
  handleSelectSession, 
  handleDeleteSession, 
  handleUpdateSessionTitle
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEditing = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
  };

  const saveTitle = (id: string) => {
    if (editTitle.trim()) {
      handleUpdateSessionTitle(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      saveTitle(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={handleCreateSession}>
          <IconPlus size={16} /> New Chat
        </button>
      </div>
      {sessions.length > 0 && (
        <div className="sidebar-section-label">Recent</div>
      )}
      <div className="session-list">
        {sessions.map(session => (
          <div 
            key={session.id} 
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => handleSelectSession(session.id)}
          >
            {editingId === session.id ? (
              <input
                type="text"
                className="session-title-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveTitle(session.id)}
                onKeyDown={(e) => handleKeyDown(e, session.id)}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="session-title" title={session.title}>{session.title || 'New Chat'}</span>
                <div className="session-actions">
                  <button 
                    className="icon-btn"
                    onClick={(e) => startEditing(e, session)}
                    title="Rename"
                  >
                    <IconEdit size={14} />
                  </button>
                  <button 
                    className="icon-btn"
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    title="Delete"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

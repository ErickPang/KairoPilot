import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, SystemStats, ModelConfig } from '../types';
import { IconUser, IconBot, IconTool, IconSend, IconTrash, IconCpu } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { Select } from './Select';

interface ChatInterfaceProps {
  messages: Message[];
  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;
  loading: boolean;
  handleSend: () => void;
  handleClear: () => void;
  systemStats: SystemStats | null;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  models: ModelConfig[];
  activeModelId: string | null;
  onModelChange: (modelId: string) => void;
}

export function ChatInterface({ 
  messages, 
  input, 
  setInput, 
  loading, 
  handleSend, 
  handleClear, 
  systemStats,
  messagesEndRef,
  models,
  activeModelId,
  onModelChange
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = React.useRef(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Try to get path from File object
      const filePaths = files.map(f => (f as any).path).filter(p => p);
      
      if (filePaths.length > 0) {
        const pathString = filePaths.map(p => `Context file: ${p}`).join('\n');
        setInput(prev => prev ? `${prev}\n${pathString}` : pathString);
      }
    }
  };

  return (
    <div 
      className="chat-interface"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          Drop files to add context
        </div>
      )}

      <div className="chat-header">
        <div className="header-title">
          {loading ? 'Thinking...' : 'KairoPilot Agent'}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {systemStats && (
            <div className="system-stats">
              CPU: {systemStats.cpuUsage}% | MEM: {systemStats.memoryUsage}%
            </div>
          )}
          <button onClick={handleClear} className="icon-btn" title={t('common.delete')}>
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%', 
            color: 'var(--muted-fg)',
            paddingBottom: '20%'
          }}>
            <h2 style={{ color: 'var(--foreground)', marginBottom: '0.5rem' }}>Welcome to KairoPilot</h2>
            <p>Start a conversation or drag & drop files to begin.</p>
          </div>
        )}
        
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="avatar">
              {msg.role === 'user' ? <IconUser size={18} /> : (msg.role === 'tool' ? <IconTool size={18} /> : <IconBot size={18} />)}
            </div>
            <div className="message-content">
              {msg.role === 'user' || msg.role === 'tool' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                  {msg.details && (
                    <details className="message-details">
                      <summary className="message-summary">Details</summary>
                      <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <div className="input-box">
          <textarea
            className="input-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('chat.placeholder')}
            disabled={loading}
            rows={1}
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <div className="input-actions">
            <div className="input-tools" style={{ display: 'flex', alignItems: 'center' }}>
              <Select 
                value={activeModelId || ''}
                onChange={onModelChange}
                options={models.map(m => ({ 
                  value: m.id, 
                  label: m.name, 
                  description: m.model 
                }))}
                placeholder="Select a model..."
                disabled={loading}
                placement="top"
                size="sm"
                icon={<IconCpu size={14} style={{ color: 'var(--muted-fg)' }} />}
                dropdownTitle="Select a model"
              />
            </div>
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={loading || !input.trim()}
              title={t('chat.send')}
            >
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, SystemStats, ModelConfig } from '../types';
import { IconUser, IconBot, IconTool, IconSend, IconTrash, IconCpu, IconChevronDown, IconCheck } from './Icons';

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
  
  const [isDragging, setIsDragging] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dragCounter = React.useRef(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);

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
          <button onClick={handleClear} className="icon-btn" title="Clear Chat">
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
            placeholder="Type a message..."
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
              <div 
                className="model-selector" 
                ref={dropdownRef}
                style={{ 
                  position: 'relative',
                  display: 'flex', 
                  alignItems: 'center'
                }}
              >
                <div 
                  onClick={() => !loading && setIsModelDropdownOpen(!isModelDropdownOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    color: 'var(--foreground)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    userSelect: 'none',
                    opacity: loading ? 0.7 : 1,
                    transition: 'all 0.2s ease'
                  }}
                >
                  <IconCpu size={14} style={{ marginRight: '6px', color: 'var(--muted-fg)' }} />
                  <span style={{ marginRight: '8px' }}>
                    {activeModelId 
                      ? models.find(m => m.id === activeModelId)?.name || 'Select a model...'
                      : 'Select a model...'}
                  </span>
                  <IconChevronDown size={12} style={{ color: 'var(--muted-fg)' }} />
                </div>

                {isModelDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: '8px',
                    width: 'max-content',
                    minWidth: '200px',
                    background: 'var(--sidebar-bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 50,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    <div style={{ 
                      padding: '8px 12px', 
                      fontSize: '0.75rem', 
                      fontWeight: 600, 
                      color: 'var(--muted-fg)',
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: 'var(--background)'
                    }}>
                      Select a model
                    </div>
                    <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                      {models.map(m => (
                        <div 
                          key={m.id}
                          onClick={() => {
                            onModelChange(m.id);
                            setIsModelDropdownOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            color: 'var(--foreground)',
                            transition: 'background-color 0.2s ease',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--sidebar-accent)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <div style={{ width: '20px', display: 'flex', justifyContent: 'center' }}>
                            {m.id === activeModelId && <IconCheck size={14} style={{ color: 'var(--primary)' }} />}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 500 }}>{m.name}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--muted-fg)' }}>{m.model}</span>
                          </div>
                        </div>
                      ))}
                      {models.length === 0 && (
                        <div style={{ padding: '8px', fontSize: '0.8rem', color: 'var(--muted-fg)', textAlign: 'center' }}>
                          No models available
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={loading || !input.trim()}
              title="Send Message"
            >
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

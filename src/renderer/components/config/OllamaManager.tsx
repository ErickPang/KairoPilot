import { useState, useEffect } from 'react';
import { ModelConfig } from '../../types';
import { IconCpu } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';

interface OllamaManagerProps {
  editingModel: ModelConfig;
  onFetchModels: (model: ModelConfig) => void;
}

export function OllamaManager({ editingModel, onFetchModels }: OllamaManagerProps) {
  const [ollamaStatus, setOllamaStatus] = useState<{running: boolean; message?: string, error?: string} | null>(null);
  const [modelToPull, setModelToPull] = useState('');
  const [pullProgress, setPullProgress] = useState<{status: string, completed?: number, total?: number} | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [isStartingOllama, setIsStartingOllama] = useState(false);

  const { t } = useTranslation();

  const checkOllamaStatus = async (baseUrl?: string) => {
    try {
      const url = (baseUrl || 'http://localhost:11434').replace('/v1', '');
      const res = await window.ipcRenderer.invoke('ollama:check', url);
      setOllamaStatus(res);
    } catch (error) {
      setOllamaStatus({ running: false, error: 'Failed to check status' });
    }
  };

  useEffect(() => {
    if (editingModel?.provider === 'ollama') {
      checkOllamaStatus(editingModel.baseUrl);
    } else {
      setOllamaStatus(null);
    }
  }, [editingModel?.provider, editingModel?.baseUrl]);

  useEffect(() => {
    const removeListener = window.ipcRenderer.on('ollama:pull-progress', (_event: unknown, ...args: unknown[]) => {
      const data = args[0] as { status: string; completed?: number; total?: number };
      setPullProgress(data);
    });
    return () => removeListener();
  }, []);

  const handlePullModel = async () => {
    if (!modelToPull || !editingModel) return;
    setIsPulling(true);
    setPullProgress({ status: 'Starting pull...' });
    
    try {
      const url = editingModel.baseUrl.replace('/v1', '');
      const res = await window.ipcRenderer.invoke('ollama:pull', { baseUrl: url, modelName: modelToPull });
      
      if (res.success) {
        setPullProgress({ status: 'Success! Model pulled.' });
        onFetchModels(editingModel); // Refresh model list
        setModelToPull('');
      } else {
        setPullProgress({ status: `Error: ${res.error}` });
      }
    } catch (e) {
      setPullProgress({ status: `Error: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setIsPulling(false);
      setTimeout(() => {
        if (!isPulling) setPullProgress(null);
      }, 5000);
    }
  };

  const handleStartOllama = async () => {
    setIsStartingOllama(true);
    try {
      const res = await window.ipcRenderer.invoke('ollama:start');
      if (res.success) {
        setTimeout(() => {
          checkOllamaStatus(editingModel?.baseUrl);
          setIsStartingOllama(false);
        }, 2000);
      } else {
        alert(t('config.startOllamaFailed', { error: res.error || 'Unknown' }));
        setIsStartingOllama(false);
      }
    } catch (e) {
      alert(t('config.startOllamaError', { error: e instanceof Error ? e.message : 'Unknown' }));
      setIsStartingOllama(false);
    }
  };

  return (
    <div className="form-group" style={{ 
      marginTop: '1rem', 
      padding: '1.25rem', 
      background: 'var(--sidebar-bg)', 
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)' 
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <IconCpu size={18} /> Ollama Manager
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
          <span style={{ 
            display: 'inline-block', 
            width: '8px', height: '8px', 
            borderRadius: '50%', 
            background: ollamaStatus?.running ? 'var(--success)' : 'var(--danger)' 
          }}></span>
          {ollamaStatus?.running ? t('config.ollamaRunning') : t('config.ollamaNotRunning')}
          
          {!ollamaStatus?.running && (
            <button 
              onClick={handleStartOllama} 
              disabled={isStartingOllama} 
              className="btn btn-secondary" 
              style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', marginLeft: '0.5rem' }}
            >
              {isStartingOllama ? t('config.ollamaStarting') : t('config.ollamaStart')}
            </button>
          )}
        </div>
      </div>
      
      <label>{t('config.ollamaPull')}</label>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
         <input 
            className="form-control"
            value={modelToPull} 
            onChange={e => setModelToPull(e.target.value)} 
            placeholder={t('config.placeholder.ollamaModel')} 
            disabled={isPulling || !ollamaStatus?.running}
         />
         <button 
            onClick={handlePullModel} 
            className="btn btn-primary" 
            disabled={isPulling || !modelToPull || !ollamaStatus?.running}
         >
           {isPulling ? t('config.pulling') : t('config.pull')}
         </button>
      </div>
      <div className="form-help">{t('config.ollamaPullHelp')}</div>
      {pullProgress && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
          <div>Status: {pullProgress.status}</div>
          {pullProgress.total && pullProgress.completed && (
            <div style={{ marginTop: '0.25rem', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                background: 'var(--primary)', 
                width: `${Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))}%`,
                transition: 'width 0.2s'
              }}></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

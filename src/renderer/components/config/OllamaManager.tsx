import { useState, useEffect } from 'react';
import { AppNotice, FetchModelsResult, ModelConfig } from '../../types';
import { IconCpu } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../../shared/ipc';
import { createErrorNotice } from '../../hooks/errorUtils';

interface OllamaManagerProps {
  editingModel: ModelConfig;
  onClearNotice: () => void;
  onFetchModels: (model: ModelConfig) => Promise<FetchModelsResult>;
  onReportNotice: (notice: AppNotice) => void;
}

export function OllamaManager({ editingModel, onClearNotice, onFetchModels, onReportNotice }: OllamaManagerProps) {
  const [ollamaStatus, setOllamaStatus] = useState<{running: boolean; message?: string, error?: string} | null>(null);
  const [modelToPull, setModelToPull] = useState('');
  const [pullProgress, setPullProgress] = useState<{status: string, completed?: number, total?: number} | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [isStartingOllama, setIsStartingOllama] = useState(false);

  const { t } = useTranslation();

  const checkOllamaStatus = async (baseUrl?: string) => {
    try {
      const url = (baseUrl || 'http://localhost:11434').replace('/v1', '');
      const res = await window.kairo.invoke(KAIRO_INVOKE.ollamaCheck, url);
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
    const removeListener = window.kairo.on(KAIRO_EVENT.ollamaPullProgress, (data) => {
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
      const res = await window.kairo.invoke(KAIRO_INVOKE.ollamaPull, { baseUrl: url, modelName: modelToPull });
      
      if (res.success) {
        setPullProgress({ status: 'Success! Model pulled.' });
        void onFetchModels(editingModel);
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
    onClearNotice();
    try {
      const res = await window.kairo.invoke(KAIRO_INVOKE.ollamaStart);
      if (res.success) {
        setTimeout(() => {
          checkOllamaStatus(editingModel?.baseUrl);
          setIsStartingOllama(false);
        }, 2000);
      } else {
        onReportNotice(createErrorNotice(t('config.startOllamaFailed', { error: res.error || 'Unknown' }), 'start_ollama'));
        setIsStartingOllama(false);
      }
    } catch (e) {
      onReportNotice(createErrorNotice(t('config.startOllamaError', { error: e instanceof Error ? e.message : 'Unknown' }), 'start_ollama'));
      setIsStartingOllama(false);
    }
  };

  return (
    <div className="form-group ollama-manager">
      <div className="ollama-manager-header">
        <h4 className="ollama-manager-title">
          <IconCpu size={18} /> Ollama Manager
        </h4>
        <div className="ollama-manager-status-row">
          <span className={`ollama-status-dot ${ollamaStatus?.running ? 'is-running' : 'is-stopped'}`}></span>
          {ollamaStatus?.running ? t('config.ollamaRunning') : t('config.ollamaNotRunning')}
          
          {!ollamaStatus?.running && (
            <button 
              type="button"
              onClick={handleStartOllama} 
              disabled={isStartingOllama} 
              className="btn btn-secondary ollama-start-btn"
            >
              {isStartingOllama ? t('config.ollamaStarting') : t('config.ollamaStart')}
            </button>
          )}
        </div>
      </div>
      
      <label>{t('config.ollamaPull')}</label>
      <div className="ollama-manager-actions">
         <input 
            className="form-control"
            value={modelToPull} 
            onChange={e => setModelToPull(e.target.value)} 
            placeholder={t('config.placeholder.ollamaModel')} 
            disabled={isPulling || !ollamaStatus?.running}
         />
         <button 
            type="button"
            onClick={handlePullModel} 
            className="btn btn-primary" 
            disabled={isPulling || !modelToPull || !ollamaStatus?.running}
         >
           {isPulling ? t('config.pulling') : t('config.pull')}
         </button>
      </div>
      <div className="form-help">{t('config.ollamaPullHelp')}</div>
      {pullProgress && (
        <div className="ollama-progress">
          <div>Status: {pullProgress.status}</div>
          {pullProgress.total && pullProgress.completed && (
            <div className="ollama-progress-track">
              <div
                className="ollama-progress-fill"
                style={{ width: `${Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))}%` }}
              ></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

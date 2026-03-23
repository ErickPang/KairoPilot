import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FetchModelsResult, ModelConfig } from '../../types';
import { IconArrowLeft, IconRefresh, IconChevronDown, IconCheck } from '../Icons';
import { Select, type SelectOption } from '../Select';
import { OllamaManager } from './OllamaManager';
import { useTranslation } from '../../hooks/useTranslation';

interface ModelEditorProps {
  editingModel: ModelConfig;
  setEditingModel: (model: ModelConfig) => void;
  isEditingExisting: boolean;
  availableModels: string[];
  onFetchModels: (model: ModelConfig) => Promise<FetchModelsResult>;
  onSave: () => void;
  onCancel: () => void;
}

export const ModelEditor = memo(function ModelEditor({ 
  editingModel, 
  setEditingModel, 
  isEditingExisting,
  availableModels, 
  onFetchModels, 
  onSave, 
  onCancel 
}: ModelEditorProps) {
  const { t } = useTranslation();
  const canFetchModels = editingModel.baseUrl.trim().length > 0;
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [activeModelIndex, setActiveModelIndex] = useState(-1);
  const [modelDropdownPlacement, setModelDropdownPlacement] = useState<'top' | 'bottom'>('bottom');
  const [manualModelId, setManualModelId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedModelIds = useMemo(
    () => (editingModel.availableModels && editingModel.availableModels.length > 0)
      ? editingModel.availableModels.map(item => item.id)
      : (editingModel.model ? [editingModel.model] : []),
    [editingModel.availableModels, editingModel.model]
  );
  const selectableModels = useMemo(
    () => Array.from(new Set([
      ...selectedModelIds,
      ...availableModels,
      ...(editingModel.model ? [editingModel.model] : [])
    ])),
    [availableModels, editingModel.model, selectedModelIds]
  );

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const updatePlacement = () => {
      const trigger = modelTriggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const requiredSpace = 260;
      if (spaceBelow < requiredSpace && spaceAbove > spaceBelow) {
        setModelDropdownPlacement('top');
        return;
      }
      setModelDropdownPlacement('bottom');
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      setActiveModelIndex(-1);
      return;
    }
    const selectedIndex = selectableModels.findIndex(id => selectedModelIds.includes(id));
    setActiveModelIndex(selectedIndex >= 0 ? selectedIndex : (selectableModels.length > 0 ? 0 : -1));
  }, [isModelDropdownOpen, selectableModels, selectedModelIds]);

  const providerOptions: SelectOption[] = [
    { value: 'openai', label: 'OpenAI' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'zhipu', label: '智谱 (Zhipu)' },
    { value: 'kimi', label: 'Kimi (Moonshot)' },
    { value: 'qianwen', label: '通义千问 (Qianwen)' },
    { value: 'ollama', label: 'Ollama (Local)' },
    { value: 'custom', label: t('config.providerCustom') }
  ];

  const handleProviderChange = (value: string) => {
    const provider = value as ModelConfig['provider'];
    setEditingModel({
      ...editingModel,
      provider
    });
  };

  const toggleModelSelection = (id: string) => {
    const selected = selectedModelIds.includes(id);
    const nextSelected = selected
      ? selectedModelIds.filter(item => item !== id)
      : [...selectedModelIds, id];
    setEditingModel({
      ...editingModel,
      availableModels: nextSelected.map(item => ({ id: item, name: item })),
      model: nextSelected.includes(editingModel.model) ? editingModel.model : (nextSelected[0] || '')
    });
  };

  const addManualModelId = () => {
    const trimmed = manualModelId.trim();
    if (!trimmed) {
      return;
    }
    const nextSelected = selectedModelIds.includes(trimmed)
      ? selectedModelIds
      : [...selectedModelIds, trimmed];
    setEditingModel({
      ...editingModel,
      availableModels: nextSelected.map(item => ({ id: item, name: item })),
      model: editingModel.model || trimmed
    });
    setManualModelId('');
  };

  const handleFetchModels = async () => {
    const result = await onFetchModels(editingModel);
    if (result.success) {
      setShowManualInput(false);
      alert(t('config.fetchModelsSuccess', { count: String(result.models.length) }));
      return;
    }
    setShowManualInput(true);
    alert(t('config.fetchModelsFailed', { error: result.error || t('common.error') }));
  };

  return (
    <>
      <div className="config-header">
        <div className="config-title">
          <button onClick={onCancel} className="btn-icon" style={{ marginRight: '0.5rem' }}>
            <IconArrowLeft size={24} />
          </button>
          <span>{editingModel.id ? t('config.editModel') : t('config.newModel')}</span>
        </div>
      </div>

      <div className="config-content">
        <div className="form-section-title">{t('config.generalInfo')}</div>
        
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>{t('config.configName')}</label>
            <input 
              className="form-control"
              value={editingModel.name} 
              onChange={e => {
                const normalizedName = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                setEditingModel({
                  ...editingModel,
                  name: normalizedName,
                  id: normalizedName
                });
              }}
              placeholder={t('config.placeholder.modelName')}
              autoFocus
              disabled={isEditingExisting}
            />
            <div className="form-help">{t('config.configNameHelp')}</div>
            <div className="form-help">仅支持英文、数字、下划线和短横线</div>
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('config.provider')}</label>
            <Select 
              value={editingModel.provider || ''}
              onChange={handleProviderChange}
              options={providerOptions}
              placeholder={t('config.selectProvider')}
            />
            {editingModel.provider === 'custom' && (
              <div className="form-help">{t('config.providerCustomHelp')}</div>
            )}
          </div>
        </div>

        <div className="form-section-title">{t('config.connectionDetails')}</div>

        <div className="form-group">
          <label>{t('config.baseUrl')}</label>
          <input 
              className="form-control"
              value={editingModel.baseUrl || ''} 
              onChange={e => setEditingModel({...editingModel, baseUrl: e.target.value})}
              placeholder={editingModel.provider === 'custom' ? t('config.placeholder.customBaseUrl') : t('config.placeholder.baseUrl')}
            />
          <div className="form-help">
            {editingModel.provider === 'custom' ? t('config.baseUrlHelpCustom') : t('config.baseUrlHelp')}
          </div>
        </div>

        <div className="form-group">
          <label>{t('config.apiKey')}</label>
          <input 
            className="form-control"
            type="password" 
            value={editingModel.apiKey} 
            onChange={e => setEditingModel({...editingModel, apiKey: e.target.value})}
            placeholder={t('config.placeholder.apiKey')} 
          />
          <div className="form-help">{t('config.apiKeyHelp')}</div>
        </div>

        <div className="form-group">
          <label>{t('config.modelId')}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div style={{ flex: 1, position: 'relative' }} ref={modelDropdownRef}>
              <button
                ref={modelTriggerRef}
                type="button"
                className="form-control"
                onClick={() => setIsModelDropdownOpen(prev => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (selectableModels.length > 0) {
                      setActiveModelIndex(prev => (prev + 1 + selectableModels.length) % selectableModels.length);
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (selectableModels.length > 0) {
                      setActiveModelIndex(prev => (prev - 1 + selectableModels.length) % selectableModels.length);
                    }
                    return;
                  }
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!isModelDropdownOpen) {
                      setIsModelDropdownOpen(true);
                      return;
                    }
                    if (activeModelIndex >= 0 && selectableModels[activeModelIndex]) {
                      toggleModelSelection(selectableModels[activeModelIndex]);
                    }
                    return;
                  }
                  if (e.key === 'Escape' && isModelDropdownOpen) {
                    e.preventDefault();
                    setIsModelDropdownOpen(false);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: selectedModelIds.length > 0 ? 'var(--foreground)' : 'var(--muted-fg)' }}>
                  {selectedModelIds.length > 0 ? selectedModelIds.join(', ') : t('config.selectModelIds')}
                </span>
                <IconChevronDown size={16} style={{ color: 'var(--muted-fg)', marginLeft: '8px' }} />
              </button>
              {isModelDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    ...(modelDropdownPlacement === 'top'
                      ? { bottom: '100%', marginBottom: '8px' }
                      : { top: '100%', marginTop: '8px' }),
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 50,
                    overflow: 'hidden'
                  }}
                >
                  <div style={{ maxHeight: '240px', overflowY: 'auto', padding: '4px' }}>
                    {selectableModels.map(id => {
                      const itemIndex = selectableModels.indexOf(id);
                      const selected = selectedModelIds.includes(id);
                      const highlighted = itemIndex === activeModelIndex;
                      return (
                        <div
                          key={id}
                          onMouseEnter={() => setActiveModelIndex(itemIndex)}
                          onClick={() => {
                            toggleModelSelection(id);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            background: selected || highlighted ? 'var(--sidebar-accent)' : 'transparent'
                          }}
                        >
                          <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                            {selected && <IconCheck size={14} style={{ color: 'var(--primary)' }} />}
                          </div>
                          <span>{id}</span>
                        </div>
                      );
                    })}
                    {selectableModels.length === 0 && (
                      <div style={{ padding: '10px', color: 'var(--muted-fg)', fontSize: '0.85rem' }}>暂无模型</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={handleFetchModels}
              className="btn btn-secondary"
              title={t('config.fetchModels')}
              disabled={!canFetchModels}
            >
              <IconRefresh size={18} /> {t('config.fetchModels')}
            </button>
          </div>
          {showManualInput && (
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <input
                className="form-control"
                value={manualModelId}
                onChange={e => setManualModelId(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addManualModelId();
                  }
                }}
                placeholder={t('config.placeholder.manualModelId')}
              />
              <button type="button" className="btn btn-secondary" onClick={addManualModelId}>
                {t('config.addModelId')}
              </button>
            </div>
          )}
          <div className="form-help">{t('config.modelIdHelp')}</div>
          {showManualInput && <div className="form-help">{t('config.manualModelIdHelp')}</div>}
        </div>

        {editingModel.provider === 'ollama' && (
          <OllamaManager editingModel={editingModel} onFetchModels={onFetchModels} />
        )}

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onSave}>{t('common.save')}</button>
        </div>
      </div>
    </>
  );
});

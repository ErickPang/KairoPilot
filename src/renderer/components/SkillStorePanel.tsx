import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconChevronDown, IconFolder, IconRefresh, IconSkill } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';
import type { TranslationKey } from '../i18n';
import { Select, type SelectOption } from './Select';
import type { AgentConfig, SkillSummary } from '../types';
import {
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  SKILL_IMPORT_ERROR,
  type SkillMarketplaceQuery,
  type SkillInstallReview,
  type SkillImportErrorCode,
  type SkillReviewFinding,
  type SkillsRegistryEntry,
  type SkillsRegistrySourceType,
  type SkillStoreEntry
} from '../../shared/contracts';
import { KAIRO_INVOKE } from '../../shared/ipc';

const DEFAULT_REGISTRY_ENTRIES: SkillsRegistryEntry[] = DEFAULT_SKILL_MARKETPLACE_PRESETS.map((preset) => ({
  type: preset.type,
  url: preset.url,
  name: preset.name
}));
const DEFAULT_REGISTRY_URL_SET = new Set(DEFAULT_SKILL_MARKETPLACE_PRESETS.map((preset) => preset.url));
const MARKETPLACE_PAGE_SIZE = 12;

const CURATED_MARKETPLACE_TAB_ID = 'curated-marketplace';
const IMPORT_ERROR_KEYS = new Set<SkillImportErrorCode>(Object.values(SKILL_IMPORT_ERROR));

interface MarketplaceSourceTab {
  id: string;
  label: string;
  type: 'curated' | 'registry';
  url?: string;
  removable?: boolean;
}

function resolveImportErrorMessage(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  error?: string,
) {
  if (error && IMPORT_ERROR_KEYS.has(error as SkillImportErrorCode)) {
    return t(error as TranslationKey);
  }

  return t(SKILL_IMPORT_ERROR.unknown);
}

export const SkillStorePanel = memo(function SkillStorePanel() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Record<string, SkillSummary[]>>({});
  const [storeSkillsByTab, setStoreSkillsByTab] = useState<Record<string, SkillStoreEntry[]>>({});
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [registryEntries, setRegistryEntries] = useState<SkillsRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketplaceLoadingByTab, setMarketplaceLoadingByTab] = useState<Record<string, boolean>>({});
  const [savingRegistry, setSavingRegistry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'installed' | 'store'>('installed');
  const [activeMarketplaceTabId, setActiveMarketplaceTabId] = useState(CURATED_MARKETPLACE_TAB_ID);
  const [loadedMarketplaceTabIds, setLoadedMarketplaceTabIds] = useState<string[]>([]);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceDraftName, setSourceDraftName] = useState('');
  const [sourceDraftUrl, setSourceDraftUrl] = useState('');
  const [sourceDraftType, setSourceDraftType] = useState<SkillsRegistrySourceType>('manifest');
  const [marketplaceTabErrors, setMarketplaceTabErrors] = useState<Record<string, string>>({});
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSkill, setReviewSkill] = useState<SkillStoreEntry | null>(null);
  const [reviewScope, setReviewScope] = useState('public');
  const [reviewResult, setReviewResult] = useState<SkillInstallReview | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importScope, setImportScope] = useState('public');
  const [importArchivePath, setImportArchivePath] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [marketplaceSearchText, setMarketplaceSearchText] = useState('');
  const [marketplacePage, setMarketplacePage] = useState(1);

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedSkills, fetchedAgents, fetchedRegistry] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.skillsGetAll),
        window.kairo.invoke(KAIRO_INVOKE.configGetAgents),
        window.kairo.invoke(KAIRO_INVOKE.skillsGetRegistry)
      ]);
      setSkills(fetchedSkills as Record<string, SkillSummary[]>);
      setAgents(fetchedAgents as AgentConfig[]);
      const normalizedRegistry = Array.isArray(fetchedRegistry) ? fetchedRegistry as SkillsRegistryEntry[] : [];
      const effectiveRegistry = normalizedRegistry.length > 0 ? normalizedRegistry : DEFAULT_REGISTRY_ENTRIES;
      setRegistryEntries(effectiveRegistry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch skills');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMarketplaceData = useCallback(async (tabId: string, force = false) => {
    if (!force && loadedMarketplaceTabIds.includes(tabId)) {
      return;
    }

    const query = getMarketplaceQueryByTabId(tabId, registryEntries);
    if (!query) {
      return;
    }

    setMarketplaceLoadingByTab((currentValue) => ({
      ...currentValue,
      [tabId]: true
    }));
    setMarketplaceTabErrors((currentValue) => {
      if (!(tabId in currentValue)) {
        return currentValue;
      }

      const nextValue = { ...currentValue };
      delete nextValue[tabId];
      return nextValue;
    });
    try {
      const fetchedStoreSkills = await window.kairo.invoke(KAIRO_INVOKE.skillsGetStoreByQuery, query);
      setStoreSkillsByTab((currentValue) => ({
        ...currentValue,
        [tabId]: fetchedStoreSkills as SkillStoreEntry[]
      }));
      setLoadedMarketplaceTabIds((currentValue) => currentValue.includes(tabId) ? currentValue : [...currentValue, tabId]);
    } catch (e) {
      setMarketplaceTabErrors((currentValue) => ({
        ...currentValue,
        [tabId]: e instanceof Error ? e.message : 'Failed to fetch marketplace skills'
      }));
    } finally {
      setMarketplaceLoadingByTab((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[tabId];
        return nextValue;
      });
    }
  }, [loadedMarketplaceTabIds, registryEntries]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  const getCategoryTitle = useCallback((agentId: string) => {
    if (agentId === 'public') return t('skills.publicCategory');
    const agent = agents.find(a => a.id === agentId);
    return agent ? t('skills.agentCategory', { agent: agent.name }) : t('skills.agentCategory', { agent: agentId });
  }, [agents, t]);

  const getScopeLabel = (scope: string) => {
    if (scope === 'public') {
      return t('skills.publicScope');
    }

    if (scope.startsWith('agent:')) {
      const agentId = scope.slice('agent:'.length);
      const agent = agents.find((item) => item.id === agentId);
      return t('skills.agentScope', { agent: agent?.name ?? agentId });
    }

    return scope;
  };

  const scopeOptions = useMemo(() => ([
    { value: 'public', label: t('skills.publicScope') },
    ...agents.map((agent) => ({
      value: `agent:${agent.id}`,
      label: t('skills.agentScope', { agent: agent.name })
    }))
  ]), [agents, t]);
  const scopeSelectOptions = useMemo<SelectOption[]>(() => scopeOptions.map((option) => ({
    value: option.value,
    label: option.label
  })), [scopeOptions]);
  const sourceTypeOptions = useMemo<SelectOption[]>(() => ([
    {
      value: 'manifest',
      label: t('skills.sourceType.manifest')
    },
    {
      value: 'claude_marketplace',
      label: t('skills.sourceType.claudeMarketplace')
    }
  ]), [t]);
  const marketplaceTabs = useMemo<MarketplaceSourceTab[]>(() => ([
    {
      id: CURATED_MARKETPLACE_TAB_ID,
      label: t('skills.curatedMarketplaceTab'),
      type: 'curated'
    },
    ...registryEntries.map((entry) => {
      const url = getRegistryEntryUrl(entry);
      return {
        id: getMarketplaceTabId(url),
        label: getRegistryEntryLabel(entry),
        type: 'registry' as const,
        url,
        removable: !DEFAULT_REGISTRY_URL_SET.has(url)
      };
    })
  ]), [registryEntries, t]);
  const activeMarketplaceTab = marketplaceTabs.find((tab) => tab.id === activeMarketplaceTabId) ?? marketplaceTabs[0];
  const activeMarketplaceTabError = activeMarketplaceTab ? marketplaceTabErrors[activeMarketplaceTab.id] ?? null : null;
  const activeMarketplaceTabLoading = activeMarketplaceTab ? marketplaceLoadingByTab[activeMarketplaceTab.id] === true : false;
  const activeMarketplaceTabLoaded = activeMarketplaceTab ? loadedMarketplaceTabIds.includes(activeMarketplaceTab.id) : false;
  const visibleStoreSkills = useMemo(
    () => storeSkillsByTab[activeMarketplaceTab?.id ?? ''] ?? [],
    [activeMarketplaceTab, storeSkillsByTab]
  );
  const hasMarketplaceLoading = useMemo(
    () => Object.values(marketplaceLoadingByTab).some(Boolean),
    [marketplaceLoadingByTab]
  );
  const activeMarketplaceStatusLabel = useMemo(() => {
    if (activeMarketplaceTabLoading) {
      return t('skills.marketplaceStatus.loading');
    }

    if (activeMarketplaceTabError) {
      return t('skills.marketplaceStatus.failed');
    }

    if (activeMarketplaceTabLoaded) {
      return t('skills.marketplaceStatus.loaded');
    }

    return t('skills.marketplaceStatus.idle');
  }, [activeMarketplaceTabError, activeMarketplaceTabLoaded, activeMarketplaceTabLoading, t]);
  const reviewFindingStats = useMemo(
    () => getReviewFindingStats(reviewResult?.findings ?? []),
    [reviewResult]
  );
  const normalizedMarketplaceSearchText = useMemo(
    () => marketplaceSearchText.trim().toLowerCase(),
    [marketplaceSearchText]
  );
  const filteredStoreSkills = useMemo(() => {
    if (!normalizedMarketplaceSearchText) {
      return [...visibleStoreSkills].sort((a, b) => {
        const installDelta = Number(b.installedScopes.length > 0) - Number(a.installedScopes.length > 0);
        if (installDelta !== 0) {
          return installDelta;
        }
        return a.name.localeCompare(b.name);
      });
    }

    return visibleStoreSkills
      .filter((skill) => getMarketplaceSearchableText(skill).includes(normalizedMarketplaceSearchText))
      .sort((a, b) => {
        const installDelta = Number(b.installedScopes.length > 0) - Number(a.installedScopes.length > 0);
        if (installDelta !== 0) {
          return installDelta;
        }
        return a.name.localeCompare(b.name);
      });
  }, [normalizedMarketplaceSearchText, visibleStoreSkills]);
  const marketplaceTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredStoreSkills.length / MARKETPLACE_PAGE_SIZE)),
    [filteredStoreSkills.length]
  );
  const paginatedStoreSkills = useMemo(() => {
    const pageStart = (marketplacePage - 1) * MARKETPLACE_PAGE_SIZE;
    return filteredStoreSkills.slice(pageStart, pageStart + MARKETPLACE_PAGE_SIZE);
  }, [filteredStoreSkills, marketplacePage]);
  const hasMarketplaceSearch = normalizedMarketplaceSearchText.length > 0;

  useEffect(() => {
    if (!scopeOptions.some((option) => option.value === reviewScope)) {
      setReviewScope(scopeOptions[0]?.value ?? 'public');
    }
  }, [reviewScope, scopeOptions]);

  useEffect(() => {
    if (!scopeOptions.some((option) => option.value === importScope)) {
      setImportScope(scopeOptions[0]?.value ?? 'public');
    }
  }, [importScope, scopeOptions]);

  useEffect(() => {
    if (!marketplaceTabs.some((tab) => tab.id === activeMarketplaceTabId)) {
      setActiveMarketplaceTabId(marketplaceTabs[0]?.id ?? CURATED_MARKETPLACE_TAB_ID);
    }
  }, [activeMarketplaceTabId, marketplaceTabs]);

  useEffect(() => {
    if (activeTab !== 'store' || !activeMarketplaceTab) {
      return;
    }

    void loadMarketplaceData(activeMarketplaceTab.id);
  }, [activeTab, activeMarketplaceTab, loadMarketplaceData]);

  useEffect(() => {
    setMarketplacePage(1);
  }, [activeMarketplaceTabId, marketplaceSearchText]);

  useEffect(() => {
    setMarketplacePage((currentValue) => Math.min(currentValue, marketplaceTotalPages));
  }, [marketplaceTotalPages]);

  const resetReviewState = () => {
    setReviewSkill(null);
    setReviewResult(null);
    setReviewLoading(false);
    setInstallingSkillId(null);
  };

  const resetImportState = () => {
    setImportModalOpen(false);
    setImportLoading(false);
    setImportArchivePath('');
    setImportError(null);
  };

  const discardPreparedReview = async (requestId?: string) => {
    if (!requestId) {
      return;
    }
    await window.kairo.invoke(KAIRO_INVOKE.skillsDiscardInstall, { requestId });
  };

  const closeInstallModal = async () => {
    const requestId = reviewResult?.requestId;
    try {
      await discardPreparedReview(requestId);
    } catch {
      return;
    } finally {
      resetReviewState();
    }
  };

  const handleOpenInstallModal = (skill: SkillStoreEntry) => {
    setError(null);
    setReviewSkill(skill);
    setReviewResult(null);
    setInstallingSkillId(null);
    setReviewScope(scopeOptions[0]?.value ?? 'public');
  };

  const handlePrepareInstall = async () => {
    if (!reviewSkill) {
      return;
    }

    setReviewLoading(true);
    setInstallingSkillId(reviewSkill.id);
    setError(null);
    try {
      const review = await window.kairo.invoke(KAIRO_INVOKE.skillsPrepareInstall, {
        id: reviewSkill.id,
        scope: reviewScope,
        marketplaceQuery: reviewSkill.registryUrl
          ? { kind: 'registry', url: reviewSkill.registryUrl }
          : { kind: 'curated' }
      });
      setReviewResult(review);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to audit skill');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleConfirmInstall = async () => {
    if (!reviewResult) {
      return;
    }

    setReviewLoading(true);
    setInstallingSkillId(reviewResult.skillId);
    setError(null);
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.skillsInstall, { requestId: reviewResult.requestId });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to install skill');
      }
      resetReviewState();
      await loadBaseData();
      if (activeTab === 'store' && activeMarketplaceTab) {
        setLoadedMarketplaceTabIds([]);
        await loadMarketplaceData(activeMarketplaceTab.id, true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to install skill');
    } finally {
      setReviewLoading(false);
      setInstallingSkillId(null);
    }
  };

  const handleRejectInstall = async () => {
    if (!reviewResult) {
      resetReviewState();
      return;
    }

    setReviewLoading(true);
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.skillsDiscardInstall, { requestId: reviewResult.requestId });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to discard skill package');
      }
      resetReviewState();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to discard skill package');
    } finally {
      setReviewLoading(false);
      setInstallingSkillId(null);
    }
  };

  const handleRefresh = async () => {
    await loadBaseData();
    if (activeTab === 'store' && activeMarketplaceTab) {
      setLoadedMarketplaceTabIds([]);
      await loadMarketplaceData(activeMarketplaceTab.id, true);
    }
  };

  const handleOpenImportModal = () => {
    setError(null);
    setImportScope(scopeOptions[0]?.value ?? 'public');
    setImportArchivePath('');
    setImportError(null);
    setImportLoading(false);
    setImportModalOpen(true);
  };

  const handleSelectImportArchive = async () => {
    try {
      const selectedFile = await window.kairo.invoke(KAIRO_INVOKE.systemSelectFile, {
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
      });
      if (typeof selectedFile === 'string' && selectedFile.trim()) {
        setImportArchivePath(selectedFile);
        setImportError(null);
      }
    } catch {
      setImportError(resolveImportErrorMessage(t, SKILL_IMPORT_ERROR.selectArchiveFailed));
    }
  };

  const handleConfirmImport = async () => {
    if (!importArchivePath.trim()) {
      setImportError(t('skills.importDirectoryRequired'));
      return;
    }

    setImportLoading(true);
    setImportError(null);
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.skillsImport, {
        sourceFile: importArchivePath,
        scope: importScope
      });
      if (!result?.success) {
        throw new Error(result?.error || SKILL_IMPORT_ERROR.unknown);
      }
      resetImportState();
      await loadBaseData();
    } catch (e) {
      setImportError(resolveImportErrorMessage(t, e instanceof Error ? e.message : SKILL_IMPORT_ERROR.unknown));
    } finally {
      setImportLoading(false);
    }
  };

  const handleOpenSourceModal = () => {
    setSourceDraftName('');
    setSourceDraftUrl('');
    setSourceDraftType('manifest');
    setSourceModalOpen(true);
  };

  const handleCloseSourceModal = () => {
    setSourceModalOpen(false);
    setSavingRegistry(false);
  };

  const handleAddRegistrySource = async () => {
    const nextUrl = sourceDraftUrl.trim();
    if (!nextUrl) {
      setError(t('skills.sourceUrlRequired'));
      return;
    }

    const existingEntry = registryEntries.find((entry) => getRegistryEntryUrl(entry) === nextUrl);
    if (existingEntry) {
      setSourceModalOpen(false);
      setActiveMarketplaceTabId(getMarketplaceTabId(nextUrl));
      return;
    }

    const nextEntry: SkillsRegistryEntry = {
      type: sourceDraftType,
      url: nextUrl,
      name: sourceDraftName.trim() || deriveMarketplaceLabelFromUrl(nextUrl)
    };

    setSavingRegistry(true);
    setError(null);
    try {
      const nextEntries = [...registryEntries, nextEntry];
      const result = await window.kairo.invoke(KAIRO_INVOKE.skillsSetRegistry, nextEntries);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save registry');
      }

      setRegistryEntries(nextEntries);
      setStoreSkillsByTab((currentValue) => ({
        ...currentValue,
        [getMarketplaceTabId(nextUrl)]: []
      }));
      setLoadedMarketplaceTabIds([]);
      setActiveMarketplaceTabId(getMarketplaceTabId(nextUrl));
      setSourceModalOpen(false);
      await loadMarketplaceData(getMarketplaceTabId(nextUrl), true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save registry');
    } finally {
      setSavingRegistry(false);
    }
  };

  const handleRetryActiveMarketplaceTab = async () => {
    if (!activeMarketplaceTab) {
      return;
    }

    await loadMarketplaceData(activeMarketplaceTab.id, true);
  };

  const handleRemoveRegistrySource = async (url: string) => {
    const tabId = getMarketplaceTabId(url);
    setSavingRegistry(true);
    setError(null);
    try {
      const nextEntries = registryEntries.filter((entry) => getRegistryEntryUrl(entry) !== url);
      const result = await window.kairo.invoke(KAIRO_INVOKE.skillsSetRegistry, nextEntries);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to remove registry');
      }

      setRegistryEntries(nextEntries);
      setStoreSkillsByTab((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[tabId];
        return nextValue;
      });
      setMarketplaceTabErrors((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[tabId];
        return nextValue;
      });
      setMarketplaceLoadingByTab((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[tabId];
        return nextValue;
      });
      setLoadedMarketplaceTabIds((currentValue) => currentValue.filter((currentTabId) => currentTabId !== tabId));
      if (activeMarketplaceTabId === tabId) {
        setActiveMarketplaceTabId(CURATED_MARKETPLACE_TAB_ID);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove registry');
    } finally {
      setSavingRegistry(false);
    }
  };

  const publicSkills = useMemo(() => skills.public ?? [], [skills]);
  const sortedPublicSkills = useMemo(
    () => [...publicSkills].sort((a, b) => a.name.localeCompare(b.name)),
    [publicSkills]
  );
  const agentSkillEntries = useMemo(
    () =>
      Object.entries(skills)
        .filter(([key]) => key !== 'public')
        .sort(([agentA], [agentB]) => getCategoryTitle(agentA).localeCompare(getCategoryTitle(agentB))),
    [getCategoryTitle, skills]
  );
  const totalInstalled = publicSkills.length + agentSkillEntries.reduce((sum, [, agentSkills]) => sum + agentSkills.length, 0);
  const agentInstalled = totalInstalled - publicSkills.length;

  return (
    <div className="config-panel">
      <div className="config-header skill-store-header">
        <div className="skill-store-header-row">
          <div>
            <div className="config-title">
              <div className="skill-store-title-icon">
                <IconSkill size={20} />
              </div>
              {t('skills.title')}
            </div>
            <div className="config-subtitle">{t('skills.subtitle')}</div>
          </div>
          <button
            type="button"
            onClick={() => { void handleRefresh(); }}
            className={`btn btn-secondary ${loading || hasMarketplaceLoading ? 'is-loading' : ''}`}
            disabled={loading || savingRegistry || hasMarketplaceLoading}
            title={t('common.refresh')}
          >
            <IconRefresh size={16} className={loading || hasMarketplaceLoading ? 'spinning' : ''} />
          </button>
        </div>

        <div className="store-tabs">
          <button 
            className={`store-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            {t('skills.installed')}
          </button>
          <button 
            className={`store-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            {t('skills.marketplace')}
          </button>
        </div>
      </div>

      <div className="config-content skill-store-content">
        {error && (
          <div className="skill-store-alert">
            {error}
          </div>
        )}

        {loading && (
          <div className="skill-store-loading">
            {t('skills.loading')}
          </div>
        )}

        {!loading && activeTab === 'installed' && (
          <div className="installed-skills-container">
            <div className="skills-overview-grid">
              <div className="config-card skill-overview-card">
                <div className="skill-overview-label">{t('skills.totalInstalled')}</div>
                <div className="skill-overview-value">{totalInstalled}</div>
              </div>
              <div className="config-card skill-overview-card">
                <div className="skill-overview-label">{t('skills.publicInstalled')}</div>
                <div className="skill-overview-value">{publicSkills.length}</div>
              </div>
              <div className="config-card skill-overview-card">
                <div className="skill-overview-label">{t('skills.agentInstalled')}</div>
                <div className="skill-overview-value">{agentInstalled}</div>
              </div>
            </div>

            <div className="config-card skill-installed-toolbar">
              <div className="skill-installed-toolbar-copy">
                <div className="skill-card-title">{t('skills.importSkill')}</div>
                <div className="config-subtitle">{t('skills.importSkillHint')}</div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleOpenImportModal}
                disabled={savingRegistry || reviewLoading || importLoading}
              >
                <IconFolder size={16} />
                {t('skills.importSkill')}
              </button>
            </div>

            <SkillSectionPanel
              title={getCategoryTitle('public')}
              count={sortedPublicSkills.length}
              defaultOpen={true}
            >
              {sortedPublicSkills.length === 0 ? (
                <div className="empty-state">{t('skills.noPublic')}</div>
              ) : (
                <div className="skills-grid">
                  {sortedPublicSkills.map(skill => (
                    <SkillItem key={skill.id} skill={skill} />
                  ))}
                </div>
              )}
            </SkillSectionPanel>

            {agentSkillEntries.map(([agentId, agentSkills]) => {
              const sortedAgentSkills = [...agentSkills].sort((a, b) => a.name.localeCompare(b.name));

              return (
                <SkillSectionPanel
                  key={agentId}
                  title={getCategoryTitle(agentId)}
                  count={sortedAgentSkills.length}
                  defaultOpen={false}
                >
                  <div className="skills-grid">
                    {sortedAgentSkills.length === 0 ? (
                      <div className="empty-state">{t('skills.noAgent')}</div>
                    ) : (
                      sortedAgentSkills.map(skill => (
                        <SkillItem key={skill.id} skill={skill} />
                      ))
                    )}
                  </div>
                </SkillSectionPanel>
              );
            })}
          </div>
        )}

        {!loading && activeTab === 'store' && (
          <div className="store-skills-container">
            <div className="skill-marketplace-tab-bar">
              <div className="skill-marketplace-tab-list" role="tablist" aria-label={t('skills.marketplace')}>
                {marketplaceTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`skill-marketplace-tab-item ${activeMarketplaceTab?.id === tab.id ? 'active' : ''} ${tab.type === 'registry' && tab.url && tab.removable ? 'removable' : ''}`}
                  >
                    <button
                      type="button"
                      className={`skill-marketplace-tab ${activeMarketplaceTab?.id === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveMarketplaceTabId(tab.id)}
                      role="tab"
                      aria-selected={activeMarketplaceTab?.id === tab.id}
                    >
                      <span className="skill-marketplace-tab-label">{tab.label}</span>
                    </button>
                    {tab.type === 'registry' && tab.url && tab.removable && (
                      <button
                        type="button"
                        className="skill-marketplace-tab-remove"
                        onClick={() => { void handleRemoveRegistrySource(tab.url!); }}
                        aria-label={t('skills.removeMarketplaceSource')}
                        title={t('skills.removeMarketplaceSource')}
                        disabled={savingRegistry}
                      >
                        <span className="skill-marketplace-tab-remove-symbol" aria-hidden="true">×</span>
                      </button>
                    )}
                  </div>
                ))}
                <div className="skill-marketplace-tab-item add-source">
                  <button
                    type="button"
                    className="skill-marketplace-tab-add"
                    onClick={handleOpenSourceModal}
                    aria-label={t('skills.addMarketplaceSource')}
                    title={t('skills.addMarketplaceSource')}
                  >
                    <span className="skill-marketplace-tab-add-symbol" aria-hidden="true">+</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="skill-marketplace-toolbar">
              <div className="skill-marketplace-search">
                <input
                  className="form-control"
                  value={marketplaceSearchText}
                  onChange={(event) => setMarketplaceSearchText(event.target.value)}
                  placeholder={t('skills.marketplaceSearchPlaceholder')}
                />
              </div>
              <div className="skill-marketplace-toolbar-meta">
                <span className={`skill-badge skill-marketplace-status-badge is-${getMarketplaceStatusTone(activeMarketplaceTabLoading, activeMarketplaceTabError)}`}>
                  {activeMarketplaceStatusLabel}
                </span>
                <span className="skill-marketplace-results-info">
                  {t('skills.marketplaceFilteredCount', {
                    shown: filteredStoreSkills.length,
                    total: visibleStoreSkills.length
                  })}
                </span>
                {hasMarketplaceSearch && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setMarketplaceSearchText('')}
                  >
                    {t('skills.clearSearch')}
                  </button>
                )}
              </div>
            </div>

            {activeMarketplaceTabLoading && visibleStoreSkills.length === 0 ? (
              <div className="skill-store-loading">
                {t('skills.loading')}
              </div>
            ) : activeMarketplaceTabError && visibleStoreSkills.length === 0 ? (
              <div className="empty-state skill-marketplace-empty skill-marketplace-empty-compact">
                <div className="skill-marketplace-empty-icon">⚠️</div>
                <h3 className="skill-marketplace-empty-title">{activeMarketplaceTab?.label ?? t('skills.marketplace')}</h3>
                <p className="skill-marketplace-empty-description">{t('skills.marketplaceLoadFailed')}</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { void handleRetryActiveMarketplaceTab(); }}
                  disabled={activeMarketplaceTabLoading}
                >
                  {t('skills.retryLoadSource')}
                </button>
              </div>
            ) : hasMarketplaceSearch && filteredStoreSkills.length === 0 ? (
              <div className="empty-state skill-marketplace-empty">
                <div className="skill-marketplace-empty-icon">🔎</div>
                <h3 className="skill-marketplace-empty-title">{activeMarketplaceTab?.label ?? t('skills.marketplace')}</h3>
                <p className="skill-marketplace-empty-description">{t('skills.marketplaceSearchEmptyHint')}</p>
              </div>
            ) : visibleStoreSkills.length === 0 ? (
              <div className="empty-state skill-marketplace-empty">
                <div className="skill-marketplace-empty-icon">🛒</div>
                <h3 className="skill-marketplace-empty-title">{activeMarketplaceTab?.label ?? t('skills.marketplace')}</h3>
                <p className="skill-marketplace-empty-description">{t('skills.marketplaceEmptyHint')}</p>
              </div>
            ) : (
              <div className="skill-marketplace-content-stack">
                {activeMarketplaceTabLoading && (
                  <div className="skill-marketplace-inline-loading">
                    {t('skills.marketplaceRefreshing')}
                  </div>
                )}
                <div className="skills-grid">
                {paginatedStoreSkills.map((skill) => (
                  <StoreSkillItem
                    key={skill.id}
                    skill={skill}
                    installing={installingSkillId === skill.id}
                    getScopeLabel={getScopeLabel}
                    onInstall={handleOpenInstallModal}
                  />
                ))}
                </div>
                <div className="skill-marketplace-pagination">
                  <div className="skill-marketplace-pagination-info">
                    {t('skills.marketplacePageInfo', {
                      page: marketplacePage,
                      totalPages: marketplaceTotalPages,
                      total: filteredStoreSkills.length
                    })}
                  </div>
                  <div className="skill-marketplace-pagination-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setMarketplacePage((currentValue) => Math.max(1, currentValue - 1))}
                      disabled={activeMarketplaceTabLoading || marketplacePage <= 1}
                    >
                      {t('common.previous')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setMarketplacePage((currentValue) => Math.min(marketplaceTotalPages, currentValue + 1))}
                      disabled={activeMarketplaceTabLoading || marketplacePage >= marketplaceTotalPages}
                    >
                      {t('common.next')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {sourceModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content skill-source-modal">
            <div className="skill-install-modal-header">
              <div>
                <div className="skill-card-title">{t('skills.addMarketplaceSource')}</div>
                <div className="config-subtitle skill-install-modal-subtitle">{t('skills.addMarketplaceSourceHint')}</div>
              </div>
            </div>
            <div className="skill-install-modal-body">
              <div className="skill-source-form-card">
                <div className="skill-source-form-grid">
                  <label className="skill-source-field">
                    <span className="skill-card-detail-label">{t('skills.sourceNameLabel')}</span>
                    <input
                      className="form-control"
                      value={sourceDraftName}
                      onChange={(event) => setSourceDraftName(event.target.value)}
                      placeholder={t('skills.sourceNamePlaceholder')}
                    />
                  </label>
                  <label className="skill-source-field">
                    <span className="skill-card-detail-label">{t('skills.sourceTypeLabel')}</span>
                    <Select
                      value={sourceDraftType}
                      onChange={(value) => setSourceDraftType(value as SkillsRegistrySourceType)}
                      options={sourceTypeOptions}
                      className="select-fill"
                    />
                  </label>
                  <label className="skill-source-field skill-source-field-full">
                    <span className="skill-card-detail-label">{t('skills.sourceUrlLabel')}</span>
                    <input
                      className="form-control"
                      value={sourceDraftUrl}
                      onChange={(event) => setSourceDraftUrl(event.target.value)}
                      placeholder={t('skills.registryPlaceholder')}
                    />
                  </label>
                </div>
              </div>
              <div className="skill-install-modal-actions skill-source-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseSourceModal} disabled={savingRegistry}>
                  {t('common.cancel')}
                </button>
                <button type="button" className={`btn btn-primary ${savingRegistry ? 'is-loading' : ''}`} onClick={() => { void handleAddRegistrySource(); }} disabled={savingRegistry}>
                  {savingRegistry && <IconRefresh size={14} className="spinning" />}
                  {savingRegistry ? t('skills.savingSource') : t('skills.saveSource')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content skill-install-modal">
            <div className="skill-install-modal-header">
              <div>
                <div className="skill-card-title">{t('skills.importSkill')}</div>
                <div className="config-subtitle skill-install-modal-subtitle">{t('skills.importSkillHint')}</div>
              </div>
            </div>
            <div className="skill-install-modal-body">
              <div className="skill-install-form-card">
                <div className="skill-card-detail-label">{t('skills.installScope')}</div>
                <div className="skill-install-form-help">{t('skills.importScopePrompt')}</div>
                <Select
                  value={importScope}
                  onChange={setImportScope}
                  options={scopeSelectOptions}
                  className="select-fill"
                  dropdownTitle={t('skills.installScope')}
                />
              </div>
              <div className="skill-install-form-card">
                <div className="skill-card-detail-label">{t('skills.importDirectoryLabel')}</div>
                <div className="skill-install-form-help">{t('skills.importDirectoryHelp')}</div>
                <div className="skill-import-directory-row">
                  <input
                    className="form-control"
                    value={importArchivePath}
                    readOnly
                    placeholder={t('skills.importDirectoryPlaceholder')}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { void handleSelectImportArchive(); }}
                    disabled={importLoading}
                  >
                    {t('skills.selectImportDirectory')}
                  </button>
                </div>
              </div>
              {importError && (
                <div className="skill-import-error" role="alert">
                  {importError}
                </div>
              )}
              <div className="skill-install-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetImportState}
                  disabled={importLoading}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { void handleConfirmImport(); }}
                  disabled={importLoading}
                >
                  {importLoading ? t('skills.importingSkill') : t('skills.confirmImportSkill')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reviewSkill && (
        <div className="modal-overlay">
          <div className="modal-content skill-install-modal">
            <div className="skill-install-modal-header">
              <div>
                <div className="skill-card-title">{t('skills.installDialogTitle', { skill: reviewSkill.name })}</div>
                <div className="config-subtitle skill-install-modal-subtitle">{t('skills.installDialogSubtitle')}</div>
              </div>
            </div>

            {!reviewResult && (
              <div className="skill-install-modal-body">
                <div className="skill-install-hero">
                  <div className="skill-install-hero-header">
                    <div>
                      <div className="skill-install-hero-title">{reviewSkill.name}</div>
                      <p className="skill-install-hero-description">{reviewSkill.description}</p>
                    </div>
                  </div>
                  <div className="skill-card-chips">
                    {reviewSkill.sourceType && (
                      <span className="skill-meta-chip">
                        {getSkillSourceTypeLabel(reviewSkill.sourceType, t)}
                      </span>
                    )}
                    {reviewSkill.marketplace && (
                      <span className="skill-meta-chip">{reviewSkill.marketplace}</span>
                    )}
                    {reviewSkill.version && (
                      <span className="skill-meta-chip">
                        {t('skills.versionLabel', { version: reviewSkill.version })}
                      </span>
                    )}
                    {reviewSkill.author && (
                      <span className="skill-meta-chip">{t('skills.by', { author: reviewSkill.author })}</span>
                    )}
                  </div>
                </div>
                <div className="skill-install-form-card">
                  <div className="skill-card-detail-label">{t('skills.installScope')}</div>
                  <div className="skill-install-form-help">{t('skills.installScopePrompt')}</div>
                  <Select
                    value={reviewScope}
                    onChange={setReviewScope}
                    options={scopeSelectOptions}
                    className="select-fill"
                    dropdownTitle={t('skills.installScope')}
                  />
                </div>
                <div className="skill-install-process">
                  <div className="skill-install-process-title">{t('skills.reviewProcessTitle')}</div>
                  <div className="skill-install-process-item">{t('skills.reviewStepDownload')}</div>
                  <div className="skill-install-process-item">{t('skills.reviewStepVet')}</div>
                  <div className="skill-install-process-item">{t('skills.reviewStepReport')}</div>
                </div>
                <div className="skill-install-modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      void closeInstallModal();
                    }}
                    disabled={reviewLoading}
                  >
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handlePrepareInstall} disabled={reviewLoading}>
                    {reviewLoading ? t('skills.preparingReview') : t('skills.startReview')}
                  </button>
                </div>
              </div>
            )}

            {reviewResult && (
              <div className="skill-install-modal-body">
                <div className="skill-install-review-hero">
                  <div className="skill-install-review-summary">
                    <span className={`skill-badge skill-review-badge is-${reviewResult.recommendation}`}>
                      {t(`skills.recommendation.${reviewResult.recommendation}`)}
                    </span>
                    <span className="skill-meta-chip">
                      {reviewResult.usedSkillVetter ? t('skills.skillVetterUsed') : t('skills.skillVetterFallback')}
                    </span>
                  </div>
                  <div className="skill-install-review-summary-title">{t('skills.reviewSummaryTitle')}</div>
                  <p className="skill-card-detail-description skill-install-review-summary-text">{reviewResult.summary}</p>
                  <div className="skill-install-metrics-grid">
                    <div className="skill-install-metric-card">
                      <div className="skill-install-metric-label">{t('skills.reviewMetricScope')}</div>
                      <div className="skill-install-metric-value">{getScopeLabel(reviewResult.scope)}</div>
                    </div>
                    <div className="skill-install-metric-card">
                      <div className="skill-install-metric-label">{t('skills.reviewMetricSource')}</div>
                      <div className="skill-install-metric-value">{reviewResult.marketplace || t('skills.unknownSource')}</div>
                    </div>
                    <div className="skill-install-metric-card">
                      <div className="skill-install-metric-label">{t('skills.reviewMetricFiles')}</div>
                      <div className="skill-install-metric-value">{reviewResult.downloadedFiles}</div>
                    </div>
                    <div className="skill-install-metric-card">
                      <div className="skill-install-metric-label">{t('skills.reviewMetricSize')}</div>
                      <div className="skill-install-metric-value">{formatBytes(reviewResult.downloadedBytes)}</div>
                    </div>
                  </div>
                </div>
                <div className="skill-install-findings-overview">
                  <div className="skill-install-findings-overview-title">{t('skills.reviewFindingsTitle')}</div>
                  <div className="skill-install-findings-overview-chips">
                    <span className="skill-meta-chip">{t('skills.reviewFindingCount', { count: reviewResult.findings.length })}</span>
                    <span className="skill-meta-chip">{t('skills.severity.high')} {reviewFindingStats.high}</span>
                    <span className="skill-meta-chip">{t('skills.severity.medium')} {reviewFindingStats.medium}</span>
                    <span className="skill-meta-chip">{t('skills.severity.low')} {reviewFindingStats.low}</span>
                  </div>
                </div>
                <div className="skill-install-findings">
                  {reviewResult.findings.length === 0 ? (
                    <div className="empty-state">{t('skills.noReviewFindings')}</div>
                  ) : (
                    reviewResult.findings.map((finding) => (
                      <div key={finding.id} className="skill-install-finding">
                        <div className="skill-install-finding-header">
                          <span className={`skill-badge skill-review-badge is-${finding.severity}`}>{t(`skills.severity.${finding.severity}`)}</span>
                          <span className="skill-install-finding-title">{finding.title}</span>
                        </div>
                        <div className="skill-install-finding-detail">{finding.detail}</div>
                        {finding.filePath && <div className="skill-card-id">{finding.filePath}</div>}
                      </div>
                    ))
                  )}
                </div>
                <div className="skill-card-code-wrap skill-install-report-wrap">
                  <div className="skill-card-detail-label">{t('skills.reviewReport')}</div>
                  <pre className="skill-card-code">{reviewResult.report}</pre>
                </div>
                <div className="skill-install-modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleRejectInstall} disabled={reviewLoading}>
                    {t('skills.rejectInstall')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleConfirmInstall} disabled={reviewLoading}>
                    {reviewLoading ? t('skills.installing') : t('skills.confirmInstall')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function SkillSectionPanel({
  title,
  count,
  defaultOpen,
  children
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details className="skill-section-panel" open={defaultOpen}>
      <summary className="skill-section-summary">
        <span className="skill-section-title">{title}</span>
        <span className="skill-section-count">{count}</span>
      </summary>
      <div className="skill-section-body">
        {children}
      </div>
    </details>
  );
}

function SkillItem({ skill }: { skill: SkillSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const sourceLabel = skill.source === 'public' ? t('skills.publicTag') : t('skills.agentTag');

  return (
    <article className={`config-card skill-card ${expanded ? 'expanded' : ''}`}>
      <div className="skill-card-header">
        <div className="skill-card-icon">
          <IconSkill size={22} />
        </div>
        <div className="skill-card-main">
          <div className="skill-card-heading">
            <h4 className="skill-card-title">{skill.name}</h4>
            <span className={`skill-badge ${skill.source === 'public' ? 'is-public' : 'is-agent'}`}>
              {sourceLabel}
            </span>
          </div>
          <div className="skill-card-meta-row">
            <span className="skill-card-id">ID: {skill.id}</span>
            {skill.version && (
              <span className="skill-badge">
                {t('skills.versionLabel', { version: skill.version })}
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="skill-card-description">
        {skill.description}
      </p>

      <div className="skill-card-chips">
        <span className="skill-meta-chip">
          {t('skills.allowedToolsCount', { count: skill.allowedTools.length })}
        </span>
        <span className="skill-meta-chip">
          {t('skills.promptLength', { count: skill.content.length })}
        </span>
      </div>

      <div className="skill-card-footer">
        <button
          type="button"
          className={`skill-card-toggle ${expanded ? 'expanded' : ''}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? t('skills.hideContent') : t('skills.showContent')}</span>
          <IconChevronDown size={16} />
        </button>
      </div>

      {expanded && (
        <div className="skill-card-details">
          <div className="skill-card-detail-section">
            <div className="skill-card-detail-label">{t('skills.description')}</div>
            <p className="skill-card-detail-description">{skill.description}</p>
          </div>
          <div className="skill-card-code-wrap">
            <div className="skill-card-detail-label">{t('skills.content')}</div>
            <pre className="skill-card-code">
              {skill.content}
            </pre>
          </div>
        </div>
      )}
    </article>
  );
}

function StoreSkillItem({
  skill,
  installing,
  getScopeLabel,
  onInstall
}: {
  skill: SkillStoreEntry;
  installing: boolean;
  getScopeLabel: (scope: string) => string;
  onInstall: (skill: SkillStoreEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const sourceTypeLabel = getSkillSourceTypeLabel(skill.sourceType, t);
  const homepageLabel = skill.homepage ? getCompactUrlLabel(skill.homepage) : null;
  const visibleTags = skill.tags.slice(0, 2);
  const remainingTagCount = Math.max(skill.tags.length - visibleTags.length, 0);

  return (
    <article className={`config-card skill-card ${expanded ? 'expanded' : ''}`}>
      <div className="skill-card-header">
        <div className="skill-card-icon">
          {skill.icon ? <span className="skill-card-emoji">{skill.icon}</span> : <IconSkill size={22} />}
        </div>
        <div className="skill-card-main">
          <div className="skill-card-heading">
            <h4 className="skill-card-title">{skill.name}</h4>
            <div className="skill-card-heading-tags">
              {sourceTypeLabel && (
                <span className="skill-badge">{sourceTypeLabel}</span>
              )}
              {skill.installedScopes.length > 0 && (
                <span className="skill-badge is-public">{t('skills.installed')}</span>
              )}
            </div>
          </div>
          <div className="skill-card-meta-row">
            <span className="skill-card-id">ID: {skill.id}</span>
            {skill.version && (
              <span className="skill-badge">
                {t('skills.versionLabel', { version: skill.version })}
              </span>
            )}
            {skill.author && (
              <span className="skill-badge">{t('skills.by', { author: skill.author })}</span>
            )}
          </div>
        </div>
      </div>

      <p className="skill-card-description">
        {skill.description}
      </p>

      <div className="skill-card-inline-meta">
        <span className="skill-card-inline-meta-item">{skill.marketplace || t('skills.unknownSource')}</span>
        {skill.author && <span className="skill-card-inline-meta-item">{t('skills.by', { author: skill.author })}</span>}
        {homepageLabel && <span className="skill-card-inline-meta-item">{homepageLabel}</span>}
      </div>

      <div className="skill-card-chips">
        {skill.installedScopes.map((scope) => (
          <span key={`${skill.id}-${scope}`} className="skill-meta-chip skill-meta-chip-success">
            {t('skills.installedInScope', { scope: getScopeLabel(scope) })}
          </span>
        ))}
        {visibleTags.map((tag) => (
          <span key={`${skill.id}-${tag}`} className="skill-meta-chip">#{tag}</span>
        ))}
        {remainingTagCount > 0 && (
          <span className="skill-meta-chip">+{remainingTagCount}</span>
        )}
      </div>

      <div className="skill-card-footer skill-card-footer-between">
        <button
          type="button"
          className={`skill-card-toggle ${expanded ? 'expanded' : ''}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? t('skills.hideContent') : t('skills.showContent')}</span>
          <IconChevronDown size={16} />
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onInstall(skill)}
          disabled={installing}
        >
          {installing ? t('skills.installing') : t('skills.install')}
        </button>
      </div>

      {expanded && (
        <div className="skill-card-details">
          <div className="skill-card-detail-section">
            <div className="skill-card-detail-label">{t('skills.description')}</div>
            <p className="skill-card-detail-description">{skill.description}</p>
          </div>
          {skill.homepage && (
            <div className="skill-card-detail-section">
              <div className="skill-card-detail-label">{t('skills.homepage')}</div>
              <p className="skill-card-detail-description">{skill.homepage}</p>
            </div>
          )}
          {skill.sourceType && (
            <div className="skill-card-detail-section">
              <div className="skill-card-detail-label">{t('skills.sourceTypeLabel')}</div>
              <p className="skill-card-detail-description">
                {sourceTypeLabel}
              </p>
            </div>
          )}
          {skill.author && (
            <div className="skill-card-detail-section">
              <div className="skill-card-detail-label">{t('skills.authorLabel')}</div>
              <p className="skill-card-detail-description">{skill.author}</p>
            </div>
          )}
          <div className="skill-card-code-wrap">
            <div className="skill-card-detail-label">{t('skills.marketplaceSources')}</div>
            <pre className="skill-card-code">{skill.marketplace || t('skills.unknownSource')}</pre>
          </div>
        </div>
      )}
    </article>
  );
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getRegistryEntryUrl(entry: SkillsRegistryEntry) {
  return typeof entry === 'string' ? entry : entry.url;
}

function getRegistryEntryLabel(entry: SkillsRegistryEntry) {
  if (typeof entry !== 'string' && entry.name?.trim()) {
    return entry.name.trim();
  }

  return deriveMarketplaceLabelFromUrl(getRegistryEntryUrl(entry));
}

function getSkillSourceTypeLabel(
  sourceType: SkillsRegistrySourceType | undefined,
  t: (key: Parameters<ReturnType<typeof useTranslation>['t']>[0], params?: Record<string, string | number>) => string
) {
  if (!sourceType) {
    return '';
  }

  return sourceType === 'claude_marketplace'
    ? t('skills.sourceType.claudeMarketplace')
    : t('skills.sourceType.manifest');
}

function getMarketplaceTabId(url: string) {
  return `marketplace:${url}`;
}

function getMarketplaceQueryByTabId(tabId: string, registryEntries: SkillsRegistryEntry[]): SkillMarketplaceQuery | null {
  if (tabId === CURATED_MARKETPLACE_TAB_ID) {
    return { kind: 'curated' };
  }

  const matchedEntry = registryEntries.find((entry) => getMarketplaceTabId(getRegistryEntryUrl(entry)) === tabId);
  if (!matchedEntry) {
    return null;
  }

  return {
    kind: 'registry',
    url: getRegistryEntryUrl(matchedEntry)
  };
}

function getMarketplaceStatusTone(isLoading: boolean, error: string | null) {
  if (isLoading) {
    return 'pending';
  }

  if (error) {
    return 'danger';
  }

  return 'success';
}

function getCompactUrlLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getReviewFindingStats(findings: SkillReviewFinding[]) {
  return findings.reduce(
    (accumulator, finding) => {
      accumulator[finding.severity] += 1;
      return accumulator;
    },
    {
      low: 0,
      medium: 0,
      high: 0
    }
  );
}

function getMarketplaceSearchableText(skill: SkillStoreEntry) {
  return [
    skill.id,
    skill.name,
    skill.description,
    skill.author,
    skill.version,
    skill.marketplace,
    skill.homepage,
    ...skill.tags
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function deriveMarketplaceLabelFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1];
    if (filename && filename !== 'marketplace.json' && filename !== 'manifest.json') {
      return filename.replace(/\.[^.]+$/, '');
    }

    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

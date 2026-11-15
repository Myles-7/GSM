
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import React, { useState } from 'react';
import {
  Search,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Ruler,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { EmbeddingApiType } from '../../types';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  EMBEDDING_API_TYPES,
  embeddingApiTypeLabelKey,
} from '../../constants/embeddingApiTypes';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { SliderInput } from '../ui/SliderInput';
import { useDialog } from '../../hooks/useDialog';
import { useVectorSearchActions } from '../../features/settings/hooks/useVectorSearchActions';
import { hasCompatibleVectorIndex } from '../../services/vectorIndexIdentity';
import { VectorIndexOperationsPanel } from './VectorIndexOperationsPanel';
import { revealSection } from './vectorIndexSection';
import { isAIConfigAvailable, isHttpAIConfig } from '../../utils/aiConfig';

interface VectorSearchSettingsProps {
  t: TranslateFn;
}

/** 表单控件的共享样式（原为 6 处重复长串，抽取后内容不变）。 */
const inputClassName = 'w-full px-3 py-2 text-sm border border-input rounded-md bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent';
const testButtonClassName = 'flex h-auto min-h-9 max-w-full items-center gap-2 whitespace-normal px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const commandButtonClassName = 'h-auto min-h-9 max-w-full whitespace-normal rounded-md bg-accent px-4 py-2 text-sm text-accent-foreground hover:bg-muted hover:text-foreground';

/** 区块标题旁的「未保存」徽标；amber 警示色与 AgyConfigPanel 的警告语义一致。 */
const UnsavedBadge = ({ t }: { t: TranslateFn }) => (
  <span
    className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50/60 px-2 py-0.5 text-xs font-normal text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400"
    title={t('vectorSearchSettings.unsaved-changes')}
  >
    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
    {t('vectorSearchSettings.unsaved-changes')}
  </span>
);

export const VectorSearchSettings: React.FC<VectorSearchSettingsProps> = ({ t }) => {
  const {
    embeddingConfigs, activeEmbeddingConfig, vectorSearchConfig, vectorSearchStatus,
    vectorIndexingState, addEmbeddingConfig, updateEmbeddingConfig,
    setActiveEmbeddingConfig, setVectorSearchConfig,
    aiConfigs, activeAIConfig, setCurrentView,
  } = useAppStore(useShallow((state) => ({
    embeddingConfigs: state.embeddingConfigs,
    activeEmbeddingConfig: state.activeEmbeddingConfig,
    vectorSearchConfig: state.vectorSearchConfig,
    vectorSearchStatus: state.vectorSearchStatus,
    vectorIndexingState: state.vectorIndexingState,
    addEmbeddingConfig: state.addEmbeddingConfig,
    updateEmbeddingConfig: state.updateEmbeddingConfig,
    setActiveEmbeddingConfig: state.setActiveEmbeddingConfig,
    setVectorSearchConfig: state.setVectorSearchConfig,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    setCurrentView: state.setCurrentView,
  })));
  const { toast, confirm } = useDialog();
  const {
    testingEmbedding, embeddingTestResult, testingWorker, workerTestResult,
    incrementalTargetCount, unindexedRepoCount, testEmbedding, testWorker, rebuildIndex,
    incrementalIndex, abortIndexing, cancelEmbeddingTest, cancelWorkerTest,
  } = useVectorSearchActions();

  const activeConfig = embeddingConfigs.find((config) => config.id === activeEmbeddingConfig);
  // 首次使用（无嵌入配置且未填 Worker）：只渲染引导卡 + ①②⑦，隐藏对其无意义的区块。
  const isFirstTime = !activeConfig && !vectorSearchConfig.workerUrl;
  const [formApiType, setFormApiType] = useState<EmbeddingApiType>(activeConfig?.apiType || 'openai');
  const [formBaseUrl, setFormBaseUrl] = useState(activeConfig?.baseUrl || '');
  const [formApiKey, setFormApiKey] = useState(activeConfig?.apiKey || '');
  const [formModel, setFormModel] = useState(activeConfig?.model || '');
  const [formDimensions, setFormDimensions] = useState(
    activeConfig?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS.openai,
  );
  const [formDimensionsInput, setFormDimensionsInput] = useState(
    String(activeConfig?.dimensions || DEFAULT_EMBEDDING_DIMENSIONS.openai),
  );
  const dimensionsInputRef = React.useRef<HTMLInputElement>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [formWorkerUrl, setFormWorkerUrl] = useState(vectorSearchConfig.workerUrl || '');
  const [formAuthToken, setFormAuthToken] = useState(vectorSearchConfig.authToken || '');
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [formIndexMode, setFormIndexMode] = useState<'description' | 'readme'>(vectorSearchConfig.indexMode || 'readme');
  const [formReadmeMaxChars, setFormReadmeMaxChars] = useState(vectorSearchConfig.readmeMaxChars || 6000);
  const [formReadmeMaxCharsInput, setFormReadmeMaxCharsInput] = useState(String(vectorSearchConfig.readmeMaxChars || 6000));
  const [formSearchThreshold, setFormSearchThreshold] = useState(vectorSearchConfig.searchThreshold ?? 0.35);
  const [formSearchTopK, setFormSearchTopK] = useState(vectorSearchConfig.searchTopK ?? 30);
  const [formSearchTopKInput, setFormSearchTopKInput] = useState(String(vectorSearchConfig.searchTopK ?? 30));
  const [formEnableHyDE, setFormEnableHyDE] = useState(vectorSearchConfig.enableHyDE ?? true);
  const [formEnableReranking, setFormEnableReranking] = useState(vectorSearchConfig.enableReranking ?? true);
  const [formSearchAIConfigId, setFormSearchAIConfigId] = useState(vectorSearchConfig.searchAIConfigId ?? '');
  const selectedSearchAI = aiConfigs.find(config => config.id === (formSearchAIConfigId || activeAIConfig));
  const missingSearchAI = !!formSearchAIConfigId && !aiConfigs.some(config => config.id === formSearchAIConfigId);
  const searchAIUnavailable = !!formSearchAIConfigId && !isAIConfigAvailable(selectedSearchAI);
  const hasDeepSeekConfig = aiConfigs.some(config => isHttpAIConfig(config) && config.apiType === 'deepseek');
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [workerSaved, setWorkerSaved] = useState(false);
  const [indexSaved, setIndexSaved] = useState(false);
  const [searchSaved, setSearchSaved] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<'delete' | 'create' | null>(null);
  const [lastIndexOp, setLastIndexOp] = useState<'rebuild' | 'incremental' | null>(null);
  const copyFlashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashSaved = (key: string, setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    clearTimeout(savedFlashTimers.current[key]);
    setter(true);
    savedFlashTimers.current[key] = setTimeout(() => setter(false), 2000);
  };
  React.useEffect(() => () => {
    Object.values(savedFlashTimers.current).forEach(clearTimeout);
    if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
  }, []);

  React.useEffect(() => {
    if (activeConfig) {
      setFormApiType(activeConfig.apiType);
      setFormBaseUrl(activeConfig.baseUrl);
      setFormApiKey(activeConfig.apiKey);
      setFormModel(activeConfig.model);
      setFormDimensions(activeConfig.dimensions);
      setFormDimensionsInput(String(activeConfig.dimensions));
    }
  }, [activeConfig]);
  React.useEffect(() => {
    setFormWorkerUrl(vectorSearchConfig.workerUrl);
    setFormAuthToken(vectorSearchConfig.authToken);
  }, [vectorSearchConfig.workerUrl, vectorSearchConfig.authToken]);
  React.useEffect(() => {
    setFormSearchAIConfigId(vectorSearchConfig.searchAIConfigId ?? '');
  }, [vectorSearchConfig.searchAIConfigId]);

  // 区块级 dirty 模型：每个保存按钮只提交自己区块的字段，dirty 精确到区块。
  const embeddingDirty = !activeConfig
    || activeConfig.apiType !== formApiType
    || activeConfig.baseUrl !== formBaseUrl
    || activeConfig.apiKey !== formApiKey
    || activeConfig.model !== formModel
    || activeConfig.dimensions !== formDimensions;
  const workerDirty = vectorSearchConfig.workerUrl !== formWorkerUrl
    || vectorSearchConfig.authToken !== formAuthToken
    || vectorSearchConfig.embeddingConfigId !== (activeEmbeddingConfig || '');
  const indexDirty = (vectorSearchConfig.indexMode || 'readme') !== formIndexMode
    || (vectorSearchConfig.readmeMaxChars || 6000) !== formReadmeMaxChars;
  const searchParamsDirty = (vectorSearchConfig.searchThreshold ?? 0.35) !== formSearchThreshold
    || (vectorSearchConfig.searchTopK ?? 30) !== formSearchTopK
    || (vectorSearchConfig.enableHyDE ?? true) !== formEnableHyDE
    || (vectorSearchConfig.enableReranking ?? true) !== formEnableReranking
    || (vectorSearchConfig.searchAIConfigId ?? '') !== formSearchAIConfigId;
  const hasUnsavedChanges = embeddingDirty || workerDirty || indexDirty || searchParamsDirty;

  const handleSaveEmbeddingConfig = () => {
    const configData = {
      name: t('vectorSearchSettings.default-embedding-name', { label: t(embeddingApiTypeLabelKey(formApiType)) }),
      apiType: formApiType, baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel, dimensions: formDimensions,
    };
    if (activeConfig) updateEmbeddingConfig(activeConfig.id, configData);
    else {
      // 随机后缀避免同一毫秒内连续创建撞 id
      const id = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      addEmbeddingConfig({ ...configData, id, isActive: true });
      setActiveEmbeddingConfig(id);
    }
    flashSaved('embedding', setEmbeddingSaved);
  };
  const handleSaveWorkerConnection = () => {
    setVectorSearchConfig({
      workerUrl: formWorkerUrl, authToken: formAuthToken, embeddingConfigId: activeEmbeddingConfig || '',
    });
    flashSaved('worker', setWorkerSaved);
  };
  const handleSaveIndexConfig = () => {
    setVectorSearchConfig({ indexMode: formIndexMode, readmeMaxChars: formReadmeMaxChars });
    flashSaved('index', setIndexSaved);
  };
  const handleSaveSearchParams = () => {
    setVectorSearchConfig({
      searchThreshold: formSearchThreshold, searchTopK: formSearchTopK,
      enableHyDE: formEnableHyDE, enableReranking: formEnableReranking,
      searchAIConfigId: formSearchAIConfigId,
    });
    flashSaved('search', setSearchSaved);
  };
  const handleConfigureDeepSeek = async () => {
    if (hasUnsavedChanges) {
      const proceed = await confirm(
        t('vectorSearchSettings.unsaved-changes'),
        t('vectorSearchSettings.leave-unsaved-message'),
      );
      if (!proceed) return;
    }
    sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
    setCurrentView('settings');
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'ai' } }));
  };
  const draft = () => ({ apiType: formApiType, baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel, dimensions: formDimensions, workerUrl: formWorkerUrl, authToken: formAuthToken, indexMode: formIndexMode, readmeMaxChars: formReadmeMaxChars });
  const handleTestEmbedding = () => testEmbedding(draft());
  const handleTestWorker = () => testWorker({ workerUrl: formWorkerUrl, authToken: formAuthToken });
  const handleRebuildIndex = () => { setLastIndexOp('rebuild'); rebuildIndex(draft()); };
  const handleIncrementalIndex = () => { setLastIndexOp('incremental'); incrementalIndex(draft()); };
  const handleAbortIndexing = () => abortIndexing();
  const handleRetryIndex = () => {
    if (lastIndexOp === 'rebuild') handleRebuildIndex();
    else if (lastIndexOp === 'incremental') handleIncrementalIndex();
  };
  const handleCopyCommand = async (key: 'delete' | 'create', command: string, failureKey: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(key);
      if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current);
      copyFlashTimer.current = setTimeout(() => setCopiedCommand(null), 2000);
    } catch (error) {
      console.warn('Failed to copy command:', error);
      toast(t(failureKey), 'error');
    }
  };
  // withDeadline 的超时错误是原始英文（Request deadline exceeded），UI 层映射为本地化提示。
  const describeTestError = (error?: string) => error === 'Request deadline exceeded'
    ? t('vectorSearchSettings.deadline-exceeded')
    : error ?? '';
  const isConfigComplete = !!(activeConfig && formBaseUrl && formModel && (formApiType === 'ollama' || formApiKey) && formWorkerUrl && formAuthToken);
  const compatibleIndex = hasCompatibleVectorIndex(draft(), { ...draft(), activeIndex: vectorSearchConfig.activeIndex });
  // 索引只依赖 ①②④ 区的已保存状态；搜索参数（⑤区）不阻断索引。
  const settingsSaved = !embeddingDirty && !workerDirty && !indexDirty;
  const unsavedSections = [
    embeddingDirty && { id: 'vector-section-embedding', label: t('vectorSearchSettings.embedding-model-configuration') },
    workerDirty && { id: 'vector-section-worker', label: t('vectorSearchSettings.cloudflare-vectorize-connection') },
    indexDirty && { id: 'vector-section-index-content', label: t('vectorSearchSettings.index-content') },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-foreground">
          <Search className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('vectorSearchSettings.vector-semantic-search')}
          </h2>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.semantic-search-powered-by-cloudflare-vectorize')}
          </p>
        </div>
      </div>

      {/* 首次使用引导：只保留 ①②⑦ 与引导卡 */}
      {isFirstTime && (
        <div className="rounded-lg border border-dashed border-border bg-accent/30 dark:bg-card/40 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="font-medium text-foreground dark:text-foreground">
                {t('vectorSearchSettings.empty-title')}
              </h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.empty-description')}
              </p>
            </div>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground dark:text-muted-foreground">
            <li>{t('vectorSearchSettings.embedding-model-configuration')}</li>
            <li>{t('vectorSearchSettings.cloudflare-vectorize-connection')}</li>
            <li>{t('vectorSearchSettings.rebuild-vector-index')}</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => revealSection('vector-section-embedding')} className="h-9 px-4 text-sm">
              {t('vectorSearchSettings.empty-cta')}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowDeployGuide(true); revealSection('vector-section-deploy-guide'); }}
              className="h-9 px-4 text-sm"
            >
              {t('vectorSearchSettings.empty-view-deploy-guide')}
            </Button>
          </div>
        </div>
      )}

      {/* Toggle */}
      {!isFirstTime && (
        <div className="flex items-center justify-between p-4 bg-accent/50 dark:bg-card/50 rounded-lg">
          <div>
            <div className="font-medium text-foreground dark:text-foreground">
              {t('vectorSearchSettings.enable-vector-search')}
            </div>
            <div className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.when-enabled-ai-search-will-use-vector-retrieval')}
            </div>
          </div>
          <Switch
            checked={vectorSearchConfig.enabled}
            onCheckedChange={(enabled) => setVectorSearchConfig({ enabled })}
            aria-label={t('vectorSearchSettings.enable-vector-search')}
          />
        </div>
      )}

      {!isFirstTime && (
        <VectorIndexOperationsPanel
          t={t}
          state={vectorIndexingState}
          configComplete={isConfigComplete}
          settingsSaved={settingsSaved}
          compatibleIndex={compatibleIndex}
          candidateCount={incrementalTargetCount}
          localPendingCount={unindexedRepoCount}
          unsavedSections={unsavedSections}
          onRebuild={handleRebuildIndex}
          onIncremental={handleIncrementalIndex}
          onAbort={handleAbortIndexing}
          onRetry={lastIndexOp ? handleRetryIndex : undefined}
        />
      )}

      {/* Section 1: Embedding Model Config */}
      <div id="vector-section-embedding" className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">①</span>
          {t('vectorSearchSettings.embedding-model-configuration')}
          {embeddingDirty && <UnsavedBadge t={t} />}
        </h3>

        {/* API Type */}
        <div>
          <h4 id="embedding-model-source-label" className="mb-1.5 block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.model-source')}
          </h4>
          <div role="group" aria-labelledby="embedding-model-source-label" className="flex flex-wrap gap-2">
            {EMBEDDING_API_TYPES.map((apiType) => (
              <Button
                key={apiType}
                onClick={() => {
                  const dimensions = DEFAULT_EMBEDDING_DIMENSIONS[apiType];
                  setFormApiType(apiType);
                  setFormDimensions(dimensions);
                  setFormDimensionsInput(String(dimensions));
                }}
                aria-pressed={formApiType === apiType}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  formApiType === apiType
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted dark:bg-card text-muted-foreground dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                }`}
              >
                {t(embeddingApiTypeLabelKey(apiType))}
              </Button>
            ))}
          </div>
        </div>

        {/* Base URL */}
        <div>
          <label htmlFor="embedding-api-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.api-url')}
          </label>
          <Input
            id="embedding-api-url"
            type="text"
            value={formBaseUrl}
            onChange={(e) => setFormBaseUrl(e.target.value)}
            placeholder={
              formApiType === 'openai'
                ? 'https://api.openai.com'
                : formApiType === 'siliconflow'
                ? 'https://api.siliconflow.cn'
                : formApiType === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : formApiType === 'cohere'
                ? 'https://api.cohere.com'
                : formApiType === 'ollama'
                ? 'http://localhost:11434'
                : 'https://api.example.com/v1/embeddings'
            }
            className={inputClassName}
          />
        </div>

        {/* API Key */}
        <div>
          <label htmlFor="embedding-api-key" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.api-key')}
          </label>
          <div className="relative">
            <Input
              id="embedding-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={formApiKey}
              onChange={(e) => setFormApiKey(e.target.value)}
              placeholder={formApiType === 'ollama' ? t('vectorSearchSettings.optional') : 'sk-xxx'}
              className={`${inputClassName} pr-10`}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showApiKey ? t('vectorSearchSettings.hide-api-key') : t('vectorSearchSettings.show-api-key')}
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
          {formApiType === 'ollama' && (
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
              {t('vectorSearchSettings.ollama-local-models-can-leave-this-empty')}
            </p>
          )}
        </div>

        {/* Model Name */}
        <div>
          <label htmlFor="embedding-model" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.model-name')}
          </label>
          <Input
            id="embedding-model"
            type="text"
            value={formModel}
            onChange={(e) => setFormModel(e.target.value)}
            placeholder={
              formApiType === 'openai'
                ? 'text-embedding-3-small'
                : formApiType === 'siliconflow'
                ? 'BAAI/bge-large-zh-v1.5'
                : formApiType === 'ollama'
                ? 'nomic-embed-text'
                : 'model-name'
            }
            className={inputClassName}
          />
        </div>

        {/* Dimensions */}
        <div>
          <label htmlFor="embedding-dimensions" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.vector-dimensions')}
          </label>
          <div className="flex gap-2">
            <NumberInput
              id="embedding-dimensions"
              ref={dimensionsInputRef}
              min={1}
              draftValue={formDimensionsInput}
              onDraftChange={setFormDimensionsInput}
              onDraftCommit={(parsed) => {
                const dimensions = parsed !== null && parsed > 0 ? parsed : DEFAULT_EMBEDDING_DIMENSIONS[formApiType];
                setFormDimensions(dimensions);
                setFormDimensionsInput(String(dimensions));
              }}
              className="flex-1 text-sm"
            />
            <Button
              onClick={() => {
                const dim = DEFAULT_EMBEDDING_DIMENSIONS[formApiType];
                setFormDimensions(dim);
                setFormDimensionsInput(String(dim));
                // 临时高亮显示已设置的维度
                dimensionsInputRef.current?.focus();
                dimensionsInputRef.current?.select();
              }}
              className="px-3 py-2 text-sm bg-muted dark:bg-card text-muted-foreground dark:text-muted-foreground rounded-md hover:bg-accent dark:hover:bg-accent"
            >
              {t('vectorSearchSettings.restore-default-dimensions')}
            </Button>
          </div>
          <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            {t('vectorSearchSettings.must-match-vectorize-index-dimensions')}
          </p>
        </div>

        {/* Test & Save */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={testingEmbedding ? cancelEmbeddingTest : handleTestEmbedding}
            disabled={!testingEmbedding && (!formBaseUrl || !formModel)}
            className={testButtonClassName}
          >
            {testingEmbedding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {testingEmbedding ? t('settingsUx.cancelTest') : t('vectorSearchSettings.test-embedding-connection')}
          </Button>
          <Button
            onClick={handleSaveEmbeddingConfig}
            variant={embeddingSaved ? 'default' : 'outline'}
            className="h-9 px-4 text-sm"
          >
            {embeddingSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-config')}
          </Button>
        </div>

        {/* Test Result */}
        {embeddingTestResult && (
          <Alert variant={embeddingTestResult.success ? 'default' : 'destructive'}>
            {embeddingTestResult.success ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            <AlertDescription>
              {embeddingTestResult.success
                ? t('vectorSearchSettings.connection-successful-dimensions', { dimensions: embeddingTestResult.dimensions })
                : t('vectorSearchSettings.connection-failed-detail', { error: describeTestError(embeddingTestResult.error) }) }
              {embeddingTestResult.success && embeddingTestResult.dimensions !== formDimensions && (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-8"
                    onClick={() => {
                      setFormDimensions(embeddingTestResult.dimensions);
                      setFormDimensionsInput(String(embeddingTestResult.dimensions));
                    }}
                  >
                    {t('vectorSearchSettings.use-detected-dimensions', { dimensions: embeddingTestResult.dimensions })}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Section 2: Cloudflare Vectorize Connection */}
      <div id="vector-section-worker" className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">②</span>
          {t('vectorSearchSettings.cloudflare-vectorize-connection')}
          {workerDirty && <UnsavedBadge t={t} />}
        </h3>

        {/* Worker URL */}
        <div>
          <label htmlFor="vectorize-worker-url" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.worker-url')}
          </label>
          <Input
            id="vectorize-worker-url"
            type="text"
            value={formWorkerUrl}
            onChange={(e) => setFormWorkerUrl(e.target.value)}
            placeholder="https://github-stars-vectorize.your-name.workers.dev"
            className={inputClassName}
          />
        </div>

        {/* Auth Token */}
        <div>
          <label htmlFor="vectorize-auth-token" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1.5">
            {t('vectorSearchSettings.auth-token')}
          </label>
          <div className="relative">
            <Input
              id="vectorize-auth-token"
              type={showAuthToken ? 'text' : 'password'}
              value={formAuthToken}
              onChange={(e) => setFormAuthToken(e.target.value)}
              placeholder={t('vectorSearchSettings.worker-authentication-token')}
              className={`${inputClassName} pr-10`}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={showAuthToken ? t('vectorSearchSettings.hide-auth-token') : t('vectorSearchSettings.show-auth-token')}
              onClick={() => setShowAuthToken(!showAuthToken)}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
            >
              {showAuthToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Test & Save */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={testingWorker ? cancelWorkerTest : handleTestWorker}
            disabled={!testingWorker && !formWorkerUrl}
            className={testButtonClassName}
          >
            {testingWorker ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {testingWorker ? t('settingsUx.cancelTest') : t('vectorSearchSettings.test-worker-connection')}
          </Button>
          <Button
            onClick={handleSaveWorkerConnection}
            variant={workerSaved || workerDirty ? 'default' : 'outline'}
            className="h-9 px-4 text-sm"
          >
            {workerSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-connection')}
          </Button>
        </div>

        {/* Test Result */}
        {workerTestResult && (
          <Alert variant={workerTestResult.success ? 'default' : 'destructive'}>
            {workerTestResult.success ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
            <AlertDescription>
              {workerTestResult.success
                ? t('vectorSearchSettings.connection-successful-vectors', { vectorCount: workerTestResult.vectorCount, dimensions: workerTestResult.dimensions })
                : t('vectorSearchSettings.connection-failed-detail', { error: describeTestError(workerTestResult.error) }) }
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Sections 3-6: 配置完成后的高级区块，首次使用时隐藏 */}
      {!isFirstTime && (
        <>
      {/* Section 3: Status */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">③</span>
          {t('vectorSearchSettings.status')}
        </h3>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {vectorSearchStatus?.connected ? (
              <CheckCircle className="h-4 w-4 text-foreground" aria-hidden="true" />
            ) : (
              <XCircle className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-muted-foreground dark:text-muted-foreground">
              {vectorSearchStatus?.connected
                ? t('vectorSearchSettings.worker-connected')
                : t('vectorSearchSettings.worker-not-connected')}
            </span>
          </div>

          {activeConfig && (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-foreground" aria-hidden="true" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.embedding-model')}: {activeConfig.model}
              </span>
            </div>
          )}

          {vectorSearchStatus?.vectorCount !== undefined && (
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.indexed-vectors')}: {vectorSearchStatus.vectorCount.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.dimensions !== undefined && (
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.vector-dimensions-2')}: {vectorSearchStatus.dimensions.toLocaleString()}
              </span>
            </div>
          )}

          {vectorSearchStatus?.lastSyncAt && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.last-sync')}: {new Date(vectorSearchStatus.lastSyncAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Index Content */}
      <details id="vector-section-index-content" className="border border-border rounded-lg p-4 space-y-4">
        <summary className="cursor-pointer font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">④</span>
          {t('vectorSearchSettings.index-content')}
          {indexDirty && <UnsavedBadge t={t} />}
        </summary>

        {/* 索引内容选择 */}
        <div className="space-y-2">
          <h4 id="embedding-index-content-label" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.index-content')}
          </h4>
          <div role="group" aria-labelledby="embedding-index-content-label" className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setFormIndexMode('description')}
              aria-pressed={formIndexMode === 'description'}
              className={`h-auto flex-col items-start whitespace-normal p-3 text-left text-sm rounded-lg border transition-colors ${
                formIndexMode === 'description'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-border hover:border-input'
              }`}
            >
              <span className="block font-medium text-foreground dark:text-foreground">
                {t('vectorSearchSettings.description')}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.fast-lower-precision')}
              </span>
            </Button>
            <Button
              variant="outline"
              onClick={() => setFormIndexMode('readme')}
              aria-pressed={formIndexMode === 'readme'}
              className={`h-auto flex-col items-start whitespace-normal p-3 text-left text-sm rounded-lg border transition-colors ${
                formIndexMode === 'readme'
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-border hover:border-input'
              }`}
            >
              <span className="block font-medium text-foreground dark:text-foreground">
                {t('vectorSearchSettings.readme-content')}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground dark:text-muted-foreground">
                {t('vectorSearchSettings.high-precision-slower')}
              </span>
            </Button>
          </div>
        </div>

        {/* README 字符数设置 */}
        {formIndexMode === 'readme' && (
          <div className="space-y-1">
            <label htmlFor="readme-max-characters" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.readme-max-characters')}
            </label>
            <NumberInput
              id="readme-max-characters"
              min={500}
              max={20000}
              step={1000}
              draftValue={formReadmeMaxCharsInput}
              onDraftChange={setFormReadmeMaxCharsInput}
              onDraftCommit={(parsed) => {
                const maxChars = parsed !== null ? parsed : 6000;
                setFormReadmeMaxChars(maxChars);
                setFormReadmeMaxCharsInput(String(maxChars));
              }}
              className="w-full text-sm"
            />
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.recommended-4000-8000-longer-higher-precision-bu')}
            </p>
          </div>
        )}

        {/* 保存索引配置 */}
        <Button
          onClick={handleSaveIndexConfig}
          variant={indexSaved || indexDirty ? 'default' : 'outline'}
          className="h-9 px-4 text-sm"
        >
          {indexSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-index-config')}
        </Button>

      </details>

      {/* Section 5: Search Parameters */}
      <details className="border border-border rounded-lg p-4 space-y-4">
        <summary className="cursor-pointer font-medium text-foreground dark:text-foreground flex items-center gap-2">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑤</span>
          {t('vectorSearchSettings.search-parameters')}
          {searchParamsDirty && <UnsavedBadge t={t} />}
        </summary>

        {/* Similarity Threshold */}
        <div className="space-y-1">
          <div className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.similarity-threshold')}
          </div>
          <SliderInput
            value={formSearchThreshold}
            onChange={setFormSearchThreshold}
            min={0.1}
            max={0.8}
            step={0.05}
            label={t('vectorSearchSettings.similarity-threshold')}
            formatValue={(value) => value.toFixed(2)}
            showMarks={false}
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.higher-stricter-fewer-but-more-precise-results-l')}
          </p>
        </div>

        {/* Top K */}
        <div className="space-y-1">
          <label htmlFor="search-topk" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.results-count-top-k')}
          </label>
          <NumberInput
            id="search-topk"
            min={5}
            max={50}
            draftValue={formSearchTopKInput}
            onDraftChange={setFormSearchTopKInput}
            onDraftCommit={(parsed) => {
              const topK = parsed !== null ? parsed : 30;
              setFormSearchTopK(topK);
              setFormSearchTopKInput(String(topK));
            }}
            className="w-full text-sm"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('vectorSearchSettings.max-results-from-vector-search-more-wider-recall')}
          </p>
        </div>

        <div className="space-y-2">
          <label id="search-ai-config-label" className="block text-sm font-medium text-muted-foreground">
            {t('vectorSearchSettings.search-ai-config')}
          </label>
          <Select value={formSearchAIConfigId || '__follow_current__'} onValueChange={value => setFormSearchAIConfigId(value === '__follow_current__' ? '' : value)}>
            <SelectTrigger aria-labelledby="search-ai-config-label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__follow_current__">{t('vectorSearchSettings.follow-current-ai-config')}</SelectItem>
              {missingSearchAI && <SelectItem value={formSearchAIConfigId} disabled>{t('vectorSearchSettings.missing-ai-config')} · {formSearchAIConfigId}</SelectItem>}
              {aiConfigs.map(config => <SelectItem key={config.id} value={config.id}>{config.name} · {config.model}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('vectorSearchSettings.search-ai-config-help')}</p>
          {searchAIUnavailable && <p role="alert" className="text-sm text-destructive">{t('vectorSearchSettings.search-ai-unavailable')}</p>}
          {!hasDeepSeekConfig && <Button type="button" variant="link" className="h-auto whitespace-normal px-0 text-sm" onClick={() => {
            void handleConfigureDeepSeek();
          }}>{t('vectorSearchSettings.configure-deepseek')}</Button>}
        </div>

        {/* HyDE Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.hyde-query-preprocessing')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.ai-generates-ideal-repo-description-before-searc')}
            </p>
          </div>
          <Switch
            checked={formEnableHyDE}
            onCheckedChange={setFormEnableHyDE}
            aria-label={t('vectorSearchSettings.hyde-query-preprocessing')}
          />
        </div>

        {/* Reranking Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.llm-semantic-reranking')}
            </div>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.llm-reranks-vector-results-by-semantic-relevance')}
            </p>
          </div>
          <Switch
            checked={formEnableReranking}
            onCheckedChange={setFormEnableReranking}
            aria-label={t('vectorSearchSettings.llm-semantic-reranking')}
          />
        </div>

        {/* Save */}
        <Button
          onClick={handleSaveSearchParams}
          variant={searchSaved || searchParamsDirty ? 'default' : 'outline'}
          className="h-9 px-4 text-sm"
        >
          {searchSaved ? `✓ ${t('vectorSearchSettings.saved')}` : t('vectorSearchSettings.save-search-parameters')}
        </Button>
      </details>

      {/* Section 6: Delete Index */}
      <details className="border border-border rounded-lg p-4 space-y-3">
        <summary className="cursor-pointer font-medium text-foreground dark:text-foreground">
          <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑥</span>
          {t('vectorSearchSettings.delete-index')}
        </summary>
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t('vectorSearchSettings.if-you-changed-the-embedding-model-different-dim')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => { void handleCopyCommand('delete', 'npx wrangler vectorize delete github-stars', 'vectorSearchSettings.failed-to-copy-delete-command'); }}
            className={commandButtonClassName}
          >
            {copiedCommand === 'delete'
              ? `✓ ${t('vectorSearchSettings.copied')}`
              : t('vectorSearchSettings.copy-delete-command')}
          </Button>
          <Button
            onClick={() => { void handleCopyCommand('create', `npx wrangler vectorize create github-stars --dimensions=${formDimensions} --metric=cosine`, 'vectorSearchSettings.failed-to-copy-create-command'); }}
            className={commandButtonClassName}
          >
            {copiedCommand === 'create'
              ? `✓ ${t('vectorSearchSettings.copied')}`
              : t('vectorSearchSettings.copy-create-command')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground">
          {t('vectorSearchSettings.run-these-commands-in-the-cloudflare-worker-dire')}
        </p>
      </details>
        </>
      )}

      {/* Section 7: Deploy Guide */}
      <div id="vector-section-deploy-guide" className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h3 className="font-medium text-foreground dark:text-foreground flex items-center gap-2">
            <span className="text-xs bg-accent dark:bg-muted px-2 py-0.5 rounded">⑦</span>
            {t('vectorSearchSettings.deploy-guide')}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowDeployGuide(!showDeployGuide)}
            aria-expanded={showDeployGuide}
            aria-controls="vector-deploy-guide"
            aria-label={t('vectorSearchSettings.toggle-deploy-guide')}
            className="h-8 w-8 p-0"
          >
            {showDeployGuide ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </Button>
        </div>

        <div id="vector-deploy-guide" hidden={!showDeployGuide} className="px-4 pb-4 text-sm text-muted-foreground dark:text-muted-foreground space-y-4">
            {/* 首次部署 */}
            <div className="p-3 bg-accent/50 dark:bg-card/50 rounded-md">
              <p className="font-medium text-foreground dark:text-foreground mb-2">
                {t('vectorSearchSettings.initial-deployment')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install -g wrangler</code>
                  {t('vectorSearchSettings.then')}
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">wrangler login</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">
                    npx wrangler vectorize create github-stars --dimensions={formDimensions} --metric=cosine
                  </code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">cd cloudflare-worker && npm install</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">wrangler secret put AUTH_TOKEN</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm run deploy</code>
                </li>
              </ol>
            </div>

            {/* 更新部署 */}
            <div className="p-3 bg-accent/50 dark:bg-card/50 rounded-md">
              <p className="font-medium text-foreground dark:text-foreground mb-2">
                {t('vectorSearchSettings.redeploy-after-code-changes')}
              </p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">cd cloudflare-worker</code>
                </li>
                <li>
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm run deploy</code>
                  {t('vectorSearchSettings.if-dependencies-changed-run')}
                  <code className="bg-accent dark:bg-muted px-1.5 py-0.5 rounded text-xs">npm install</code>
                  {t('vectorSearchSettings.text')}
                </li>
              </ol>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('vectorSearchSettings.note-redeployment-does-not-require-recreating-th')}
              </p>
            </div>

            {/* 模型变更警告 */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground">
              <p className="font-medium text-foreground">
                {t('vectorSearchSettings.must-rebuild-index-after-changing-embedding-mode')}
              </p>
              <p className="mt-1 text-xs">
                {t('vectorSearchSettings.different-models-produce-vectors-with-different')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('vectorSearchSettings.for-detailed-instructions-see')}{' '}
              <a
                href="https://github.com/AmintaCCCP/GithubStarsManager/blob/main/cloudflare-worker/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-4 hover:underline"
              >
                cloudflare-worker/README.md
              </a>
            </p>
        </div>
      </div>
    </div>
  );
};

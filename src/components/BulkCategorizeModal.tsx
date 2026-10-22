import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useId, useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useClassificationStore as useAppStore, getAllCategories } from '../store/useClassificationStore';
import { useShallow } from 'zustand/react/shallow';
import type { ClassificationTarget } from '../store/helpers/classificationEdits';

interface BulkCategorizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: Repository[];
  onCategorize: (categoryName: string) => Promise<void>;
  onAssignTarget?: (target: ClassificationTarget) => Promise<boolean | void>;
}

export const BulkCategorizeModal: React.FC<BulkCategorizeModalProps> = ({
  isOpen,
  onClose,
  repositories,
  onCategorize,
  onAssignTarget,
}) => {
  const { customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides, language, classificationContext, subcategories, subcategoryOrder } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    classificationContext: state.classificationContext,
    language: state.language,
    subcategories: state.subcategories,
    subcategoryOrder: state.subcategoryOrder,
  })));
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const categorySelectionLabelId = useId();

  const allCategories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, classificationContext);

  useEffect(() => {
    if (isOpen) {
      setSelectedCategory(null);
    }
  }, [isOpen]);

  const [error, setError] = useState<string | null>(null);

  const handleCategorize = async () => {
    if (!selectedCategory) return;

    const child = (subcategories ?? []).find(group => group.id === selectedCategory);
    const category = allCategories.find(cat => cat.id === (child?.parentId ?? selectedCategory));
    if (!category) { setError(language.startsWith('zh') ? '目标分类已变化，请重新选择。' : 'The destination changed. Please select it again.'); return; }

    setIsProcessing(true);
    setError(null);
    try {
      if (onAssignTarget) { if (await onAssignTarget({ categoryId: category.id, subcategoryId: child?.id ?? null }) === false) return; }
      else await onCategorize(category.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bulkCategorizeModal.categorization-failed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const t = useT('app');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('bulkCategorizeModal.bulk-categorize')}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          {t('bulkCategorizeModal.will-set-category-for-v1-repositories', { v1: repositories.length })}
        </p>

        <div className="space-y-2">
          <h3 id={categorySelectionLabelId} className="mb-2 block text-sm font-medium text-foreground dark:text-foreground">
            {t('bulkCategorizeModal.select-category')}
          </h3>

          <div
            role="group"
            aria-labelledby={categorySelectionLabelId}
            className="max-h-64 overflow-y-auto space-y-2"
          >
            {allCategories.filter(cat => cat.id !== 'all' && cat.id !== 'pending').map(category => (
              <React.Fragment key={category.id}>
              <Button
                key={category.id}
                variant="ghost"
                aria-pressed={selectedCategory === category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`h-auto w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                  selectedCategory === category.id
                    ? 'border-primary bg-muted dark:bg-primary/10'
                    : 'border-border dark:hover:border-border-strong'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-medium text-foreground dark:text-foreground">
                    {category.name}
                  </span>
                </div>
                {selectedCategory === category.id && (
                  <Check className="w-5 h-5 text-primary" />
                )}
              </Button>
              {onAssignTarget && (subcategories ?? []).filter(group => group.parentId === category.id).sort((a, b) => (subcategoryOrder ?? []).indexOf(a.id) - (subcategoryOrder ?? []).indexOf(b.id)).map(group => <Button key={group.id} variant="ghost" aria-pressed={selectedCategory === group.id} onClick={() => setSelectedCategory(group.id)} className={`ml-4 h-auto w-[calc(100%-1rem)] justify-between gap-2 whitespace-normal border px-4 py-2 text-left ${selectedCategory === group.id ? 'border-primary bg-muted' : 'border-border'}`}><span className="min-w-0 break-words">{category.name} / {group.name}</span>{selectedCategory === group.id && <Check className="h-4 w-4 shrink-0" />}</Button>)}
              </React.Fragment>
            ))}
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-destructive dark:bg-destructive/10">
            <p className="text-sm text-destructive">
              {error}
            </p>
          </div>
        )}

        <div className="bg-muted dark:bg-warning/10 border border-border dark:border-warning/20 rounded-lg p-3">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
            {t('bulkCategorizeModal.note-this-operation-will-overwrite-the-existing')}
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 rounded-lg hover:bg-accent dark:hover:bg-accent disabled:opacity-50"
          >
            {t('bulkCategorizeModal.cancel')}
          </Button>
          <Button
            onClick={handleCategorize}
            disabled={!selectedCategory || isProcessing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? t('bulkCategorizeModal.processing') : t('bulkCategorizeModal.confirm-categorize')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

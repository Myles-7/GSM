import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import type { Repository } from '../types';
import { logger } from '../services/logger';
import { useT } from '../i18n/useT';
import { Modal } from './Modal';
import { Button } from './ui/button';

const LazyReadmeModal = lazy(() => import('./ReadmeModal').then(module => ({ default: module.ReadmeModal })));
export type BatchReadmeRepository = Pick<Repository, 'full_name' | 'html_url' | 'owner' | 'default_branch'>;

class ReadmeBoundary extends Component<{
  children: ReactNode; title: string; error: string; closeLabel: string; onClose: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.errorFromError('ui.batchStar', 'Failed to load README preview', error, { componentStack: info.componentStack });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <Modal isOpen onClose={this.props.onClose} title={this.props.title}>
      <p role="alert">{this.props.error}</p>
      <Button variant="outline" onClick={this.props.onClose}>{this.props.closeLabel}</Button>
    </Modal>;
  }
}

/** Reuses the complete README experience, including its whole-page translation control. */
export function BatchStarImportReadme({ repository, onClose }: { repository: BatchReadmeRepository; onClose: () => void }) {
  const t = useT('repositories');
  const title = t('batchStar.view-readme', { name: repository.full_name, defaultValue: 'View README for {{name}}' });
  return <ReadmeBoundary title={title} onClose={onClose} closeLabel={t('batchStar.close')}
    error={t('batchStar.readme-load-error', { defaultValue: 'Could not load the README. Close this view to return to the batch import.' })}>
    <Suspense fallback={<Modal isOpen title={title} onClose={onClose}>
      <p role="status">{t('batchStar.loading-readme', { defaultValue: 'Loading README...' })}</p>
    </Modal>}>
      {/* The existing modal only reads these fields; this read-only preview never reaches Store. */}
      <LazyReadmeModal isOpen repository={repository as Repository} onClose={onClose} />
    </Suspense>
  </ReadmeBoundary>;
}

import type { TranslateFn } from '../i18n/useT';
import type { PluginPageSession } from '../plugins/pluginPageSession';
import { repositoryContext } from '../plugins/pluginPageContext';
import { usePluginPageReadme } from '../plugins/usePluginPageReadme';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { PluginPageViewer } from './PluginPageViewer';

type Props = PluginPageSession & {
  repository: NonNullable<PluginPageSession['repository']>;
  onClose: () => void;
  t: TranslateFn;
  language?: string;
};

export function PluginPageModal({ repository, onClose, t, language, ...page }: Props) {
  const storedLanguage = useAppStore((state) => state.language);
  const { readme } = usePluginPageReadme(repository);
  return (
    <Modal isOpen onClose={onClose} title={`${page.pluginName} · ${page.pageTitle}`}
      maxWidth="w-[calc(100vw-2rem)] max-w-6xl" scrollable>
      <PluginPageViewer {...page} variant="modal" onClose={onClose} t={t}
        initContext={{ repository: repositoryContext(repository), readme, language: language ?? storedLanguage }} />
    </Modal>
  );
}

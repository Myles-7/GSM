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
  const theme = useAppStore((state) => state.theme);
  const { readme } = usePluginPageReadme(repository);
  return (
    <Modal isOpen onClose={onClose} title={`${page.pluginName} · ${page.pageTitle}`}
      maxWidth="h-[calc(100vh_-_2rem)] max-h-[calc(100vh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-none" scrollable
      contentClassName="flex flex-col">
      <PluginPageViewer {...page} variant="modal" onClose={onClose} t={t}
        initContext={{ repository: repositoryContext(repository), readme, language: language ?? storedLanguage, theme }} />
    </Modal>
  );
}

import { FileText, GitFork, Info, KeyRound, List, Star, Workflow } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const rows = {
  'fine-grained': [
    { icon: Star, feature: 'star', label: 'Managing Stars', permission: 'fine-star', value: '`Starring` read & write, `Metadata` read' },
    { icon: FileText, feature: 'gists', label: 'Gists', permission: 'fine-gists', value: '`Gists` write' },
    { icon: GitFork, feature: 'fork-sync', label: 'Fork sync', permission: 'fine-fork-sync', value: '`Contents` write' },
    { icon: Workflow, feature: 'workflows', label: 'Workflow dispatch', permission: 'fine-workflows', value: '`Actions` write' },
  ],
  classic: [
    { icon: Star, feature: 'star', label: 'Managing Stars', permission: 'classic-star', value: '`public_repo` (`repo` for private repositories)' },
    { icon: FileText, feature: 'gists', label: 'Gists', permission: 'classic-gists', value: '`gist`' },
    { icon: List, feature: 'star-lists', label: 'Star Lists', permission: 'classic-star-lists', value: '`user`' },
    { icon: GitFork, feature: 'fork-workflows', label: 'Fork sync / workflows', permission: 'classic-fork-workflows', value: '`repo`' },
  ],
};

function permissions(text: string) {
  return text.split(/`([^`]+)`/g).map((part, index) => index % 2
    ? <strong key={index} translate="no" className="font-semibold text-foreground">{part}</strong>
    : part);
}

/** Shared login/settings guide; identity validation never implies all permissions are present. */
export function GitHubTokenPermissions({ heading = true }: { heading?: boolean }) {
  const t = useT('login');
  return <section className="text-xs leading-5 text-muted-foreground">
    {heading && <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
      <KeyRound className="h-4 w-4" aria-hidden />
      {t('loginScreen.token-permissions-title', { defaultValue: 'GitHub token permissions' })}
    </h3>}
    <Tabs defaultValue="fine-grained">
      <TabsList className="mb-3 grid h-auto grid-cols-2">
        <TabsTrigger value="fine-grained" className="whitespace-normal text-xs">{t('loginScreen.token-permissions-tab-finegrained', { defaultValue: 'Fine-grained' })}</TabsTrigger>
        <TabsTrigger value="classic" className="text-xs">{t('loginScreen.token-permissions-tab-classic', { defaultValue: 'Classic' })}</TabsTrigger>
      </TabsList>
      {Object.entries(rows).map(([mode, entries]) => <TabsContent key={mode} value={mode}>
        <ul className="space-y-2.5">
          {entries.map(({ icon: Icon, feature, label, permission, value }) => <li key={permission} className="flex items-start gap-2">
            <Icon className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-words">
              <span className="block font-medium text-foreground">{t(`loginScreen.token-permissions-feature-${feature}`, { defaultValue: label })}</span>
              {permissions(t(`loginScreen.token-permissions-${permission}`, { defaultValue: value }))}
            </span>
          </li>)}
        </ul>
      </TabsContent>)}
    </Tabs>
    <p className="mt-3 flex gap-2 border-t border-border pt-3">
      <Info className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{t('loginScreen.token-permissions-check', { defaultValue: 'Signing in checks your identity, not every permission. Missing permissions may only appear when you use a feature.' })}</span>
    </p>
    <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block font-medium text-primary hover:underline">
      {t('loginScreen.create-token-on-github')}
    </a>
  </section>;
}

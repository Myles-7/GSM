import type { useAIOrganization } from '../hooks/useAIOrganization';
import { DualOrganizationWizard } from './DualOrganizationWizard';

export function AIOrganizationPanel({ open, onOpenChange, controller }: {
  open: boolean; onOpenChange: (open: boolean) => void; controller: ReturnType<typeof useAIOrganization>;
}) {
  return <DualOrganizationWizard open={open} onOpenChange={value => {
    if (!value) sessionStorage.removeItem('gsm:pending-agent-organization');
    onOpenChange(value);
  }} controller={controller} />;
}

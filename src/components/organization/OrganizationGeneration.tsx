import type { OrganizationController } from '../DualOrganizationWizard';
import { OrganizationProgress } from './OrganizationProgress';
import { OrganizationReview } from './OrganizationReview';
import { OrganizationExecutionDetails } from './OrganizationExecutionDetails';

export function OrganizationGeneration({ controller }: { controller: OrganizationController }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <OrganizationProgress controller={controller} summaryOnly />
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row"><div className="flex min-h-0 min-w-0 flex-1 flex-col"><OrganizationReview controller={controller} /></div><OrganizationExecutionDetails controller={controller} /></div>
  </div>;
}

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgyDeviceState } from '../../types/agy';
import type { OrganizationController } from '../DualOrganizationWizard';
const mocks = vi.hoisted(() => ({ pool: undefined as AgyDeviceState['pool'], recover: vi.fn(), test: vi.fn() }));
vi.mock('../../services/agyClient', () => ({ agySchedulerStatus: { subscribe: () => () => {}, snapshot: () => mocks.pool } }));
vi.mock('../../i18n/useT', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }));
vi.mock('../../features/settings/hooks/useAgySettings', () => ({ useAgySettings: () => ({
  state: { enabled: true, executable: { fingerprint: 'fixture' }, prefs: { model: 'fixture' } },
  draft: { model: 'fixture', timeoutSeconds: 180 }, probeMatches: true, available: true, busy: false,
  recover: mocks.recover, testOrganizationBeforeEnable: mocks.test,
}) }));
import { OrganizationModelReadiness } from './OrganizationModelReadiness';
import { OrganizationProgress } from './OrganizationProgress';
beforeEach(() => {
  mocks.pool = { running: 0, queued: 0, limit: 5, effective: 0, cooldownUntil: 0, features: {}, quarantined: true };
  mocks.recover.mockReset(); mocks.test.mockReset();
});
it('shows safe recovery instead of a false model-ready label and disables model tests', async () => {
  render(<OrganizationModelReadiness />);
  expect(screen.getByText('organizationRecovery.quarantined')).toBeInTheDocument();
  expect(screen.queryByText('organizationUx.modelReady')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'organizationUx.test' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'organizationRecovery.recover' }));
  expect(mocks.recover).toHaveBeenCalledOnce(); expect(mocks.test).not.toHaveBeenCalled();
});
it('does not display stale running work or five usable slots after quarantine', () => {
  const controller = { count: 3, busy: false, configId: 'agy', analysisDepth: 'quick', aiConfigs: [{ id: 'agy', provider: 'agy-cli' }],
    proposal: { organization: { dual: { phase: 'structure', understanding: [], errors: [], schemes: {
      purpose: { entries: [], ready: false }, technology: { entries: [], ready: true },
    }, progress: { running: 1, queued: 0, reading: 0, concurrency: 5, effectiveConcurrency: 5, requests: 17, summaryCompleted: 11, summaryFallback: 1, summaryTotal: 12 } } } },
  } as unknown as OrganizationController;
  render(<OrganizationProgress controller={controller} />);
  expect(screen.getByText('organizationSpeed.active:{"running":0,"queued":0,"reading":0}')).toBeInTheDocument();
  expect(screen.getByText('organizationSpeed.effective:{"count":0,"limit":5}')).toBeInTheDocument();
  expect(screen.getByText('organizationRecovery.summary:{"done":12,"total":12,"success":11,"fallback":1}')).toBeInTheDocument();
});

it('does not count insufficient targets as verified classification successes', () => {
  const entries=[{verification:'verified',categoryId:'main',disposition:'move'},
    {verification:'verified',categoryId:null,disposition:'insufficient'},
    {verification:'failed',categoryId:null,disposition:'insufficient'}];
  const controller={count:3,busy:false,configId:'agy',analysisDepth:'quick',aiConfigs:[{id:'agy',provider:'agy-cli'}],
    proposal:{organization:{dual:{phase:'review',understanding:[{status:'understood'},{status:'insufficient'},{status:'understood'}],errors:[],
      schemes:{purpose:{entries,ready:true},technology:{entries,ready:true}}}}}} as unknown as OrganizationController;
  render(<OrganizationProgress controller={controller}/>);
  expect(screen.getAllByText('organizationRuntime.assignmentCounts:{"verified":1,"failed":1,"pending":0,"uncertain":1,"total":3}')).toHaveLength(2);
});

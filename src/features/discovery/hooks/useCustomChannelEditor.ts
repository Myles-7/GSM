import { useCallback, useEffect, useRef, useState } from 'react';
import { useCustomChannelActions } from './useCustomChannelActions';
import { currentAccount } from '../custom/runner';
import { effectiveRules, overrideSchema, rulesFingerprint, type CandidatePreview, type CompiledSubscriptionPlan, type CustomDiscoveryChannel, type RuleOverrides, type TaskIssue, type TaskProgress } from '../custom/model';
import { selectCustomChannel, startCustomRun, updateCustomData, useCustomDiscovery } from '../custom/store';
import { taskIssue } from '../custom/taskStatus';

export function useCustomChannelEditor(channel: CustomDiscoveryChannel | undefined, onClose: () => void) {
  const actions = useCustomChannelActions();
  const account = useCustomDiscovery(s => s.account);
  const initialAccount = useRef(account);
  const [name, setName] = useState(channel?.name || '');
  const [instruction, setInstruction] = useState(channel?.instruction || '');
  const [parsedInstruction, setParsedInstruction] = useState(channel?.instruction ?? null);
  const [plan, setPlan] = useState<CompiledSubscriptionPlan | null>(channel?.plan ?? null);
  const [overrides, setOverrides] = useState<RuleOverrides>(channel?.ruleOverrides ?? {});
  const [ai, setAI] = useState(channel?.ai ?? true);
  const [autoAnalyze, setAutoAnalyze] = useState(channel?.autoAnalyze ?? true);
  const [limit, setLimit] = useState(channel?.limit ?? 10);
  const [hour, setHour] = useState(channel?.hour ?? 9);
  const [parsing, setParsing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [issue, setIssue] = useState<TaskIssue | null>(null);
  const [conflicts, setConflicts] = useState<string[]>(channel?.plan.conflicts ?? []);
  const [elapsed, setElapsed] = useState(0);
  const controllers = useRef<{ parse?: AbortController; preview?: AbortController }>({});
  const mounted = useRef(true);
  const sequence = useRef(0);
  const previewSequence = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const cancelWork = useCallback(() => {
    sequence.current++;
    previewSequence.current++;
    controllers.current.parse?.abort();
    controllers.current.preview?.abort();
    controllers.current = {};
    setParsing(false); setPreviewing(false); setProgress(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllers.current.parse?.abort();
      controllers.current.preview?.abort();
    };
  }, []);
  useEffect(() => {
    if (account !== initialAccount.current) { cancelWork(); closeRef.current(); }
  }, [account, cancelWork]);
  useEffect(() => {
    if (!parsing && !previewing) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [parsing, previewing]);

  const validSession = () => mounted.current && currentAccount() === initialAccount.current;
  const changeInstruction = (value: string) => {
    cancelWork(); setInstruction(value); setPreview(null); setIssue(null); setConflicts([]);
  };
  const changeOverrides = (value: RuleOverrides) => {
    const checked = overrideSchema.safeParse(value);
    if (!checked.success) { setIssue({ kind: 'invalid' }); return false; }
    // Overrides may change during parsing. They survive the new AI response.
    controllers.current.preview?.abort();
    previewSequence.current++;
    controllers.current.preview = undefined;
    setPreviewing(false); setProgress(null);
    setOverrides(checked.data); setPreview(null); setIssue(null);
    return true;
  };
  let rules: ReturnType<typeof effectiveRules> | null = null;
  let validationIssue: TaskIssue | null = null;
  if (plan) {
    try { rules = effectiveRules(plan, overrides); }
    catch (error) { validationIssue = taskIssue(error); }
  }
  const stale = parsedInstruction !== instruction;
  const fingerprint = rules ? rulesFingerprint(rules) : '';
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const canSave = Boolean(name.trim() && plan && rules && !stale && !parsing && !saving && issue?.kind !== 'invalid' && plan.conflicts.length === 0);
  const createDraft = (): CustomDiscoveryChannel => {
    if (!plan || !rules) throw new Error('INVALID_RULES');
    const changed = !channel || channel.instruction !== instruction || channel.ai !== ai
      || JSON.stringify(effectiveRules(channel.plan, channel.ruleOverrides)) !== JSON.stringify(rules);
    return {
      ...channel,
      id: channel?.id || `custom:${crypto.randomUUID()}`, name: name.trim(), instruction,
      revision: channel ? channel.revision + (changed ? 1 : 0) : 1,
      plan, ruleOverrides: overrides, ai, autoAnalyze, limit, hour,
      enabled: channel?.enabled ?? true, paused: channel?.paused ?? false,
      cursors: changed ? [] : channel?.cursors || [],
      blocked: channel?.blocked || [], read: channel?.read || [], recommended: channel?.recommended || {},
      lastCompletedDate: changed ? undefined : channel?.lastCompletedDate,
    };
  };
  const parse = async () => {
    cancelWork();
    const id = sequence.current;
    const controller = new AbortController();
    controllers.current.parse = controller;
    setParsing(true); setIssue(null); setPreview(null); setConflicts([]);
    try {
      const result = await actions.compile(instruction, controller.signal);
      if (!validSession() || controller.signal.aborted || id !== sequence.current) return;
      setPlan(result); setParsedInstruction(instruction); setConflicts(result.conflicts);
    } catch (error) {
      if (validSession() && id === sequence.current) setIssue(taskIssue(error));
    } finally {
      if (mounted.current && id === sequence.current) { setParsing(false); controllers.current.parse = undefined; }
    }
  };
  const previewCandidates = async () => {
    if (!canSave) return;
    controllers.current.preview?.abort();
    const controller = new AbortController();
    controllers.current.preview = controller;
    const id = ++previewSequence.current;
    const requestedFingerprint = fingerprint;
    setPreviewing(true); setPreview(null); setIssue(null);
    try {
      const result = await actions.preview(createDraft(), controller.signal, p => {
        if (!controller.signal.aborted && validSession()) setProgress(p);
      });
      if (controller.signal.aborted || !validSession() || id !== previewSequence.current || requestedFingerprint !== fingerprintRef.current) return;
      setPreview(result);
    } catch (error) {
      if (!controller.signal.aborted && validSession()) setIssue(taskIssue(error));
    } finally {
      if (mounted.current && controllers.current.preview === controller) {
        setPreviewing(false); setProgress(null); controllers.current.preview = undefined;
      }
    }
  };
  const removeCondition = (kind: 'required' | 'excluded' | 'preferred', index: number) => {
    if (rules) changeOverrides({ ...overrides, [kind]: rules.plan[kind].filter((_, i) => i !== index) });
  };
  const addCondition = (kind: 'required' | 'excluded' | 'preferred', text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!rules || rules.plan[kind].some(item => item.text.toLowerCase() === trimmed.toLowerCase())) return false;
    return changeOverrides({ ...overrides, [kind]: [...rules.plan[kind], { text: trimmed, source: trimmed }] });
  };
  const removeBranch = (index: number) => {
    const currentBranches = overrides.branches || plan?.branches || [];
    if (currentBranches.length <= 1) return;
    const next = currentBranches.filter((_, i) => i !== index);
    changeOverrides({ ...overrides, branches: next });
  };
  const addBranch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    const currentBranches = overrides.branches || plan?.branches || [];
    if (currentBranches.length >= 6) return;
    const terms = trimmed.split(/[,|]/).map(t => t.trim()).filter(Boolean);
    if (!terms.length) return;
    const next = [...currentBranches, { terms, readme: false, role: 'synonym' as const }];
    return changeOverrides({ ...overrides, branches: next });
  };
  const resetPlanConditions = () => {
    const next = { ...overrides };
    delete next.required; delete next.excluded; delete next.preferred;
    changeOverrides(next);
  };
  const canResetConditions = Boolean(
    overrides.required || overrides.excluded || overrides.preferred
  );

  const save = async (runNow = false) => {
    if (!canSave || !validSession()) return;
    cancelWork();
    const draft = createDraft();
    setSaving(true); setIssue(null);
    try {
      await updateCustomData(data => {
        if (!validSession()) throw new DOMException('Account changed', 'AbortError');
        const existing = data.channels.find(c => c.id === draft.id);
        if (channel && (!existing || existing.revision !== channel.revision)) throw new Error('INVALID_STALE_RULE');
        const next = { ...draft, recommended: existing?.recommended || {}, manualAccepted: existing?.manualAccepted,
          blocked: existing?.blocked || [], read: existing?.read || [] };
        const index = data.channels.findIndex(c => c.id === next.id);
        if (index < 0) data.channels.push(next);
        else data.channels[index] = next;
      });
      if (!validSession()) return;
      selectCustomChannel(draft.id); closeRef.current();
      if (runNow && !draft.paused) void startCustomRun([draft.id]);
    } catch (error) { if (validSession()) setIssue(taskIssue(error)); }
    finally { if (mounted.current) setSaving(false); }
  };
  return {
    name, setName, instruction, changeInstruction, plan, setPlan, overrides, changeOverrides, rules, stale,
    ai, setAI, autoAnalyze, setAutoAnalyze, limit, setLimit, hour, setHour, parsing, previewing, saving, preview, progress,
    issue: validationIssue || issue, conflicts, elapsed, canSave, parse, previewCandidates, save,
    removeCondition, addCondition, removeBranch, addBranch, resetPlanConditions, canResetConditions,
    cancel: () => { cancelWork(); setIssue({ kind: 'cancelled' }); },
  };
}

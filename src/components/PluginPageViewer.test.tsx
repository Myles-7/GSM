import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(), requestPageCapability: vi.fn(), getSearchEndpoint: vi.fn(), searchWeb: vi.fn(),
  confirm: vi.fn(), generateChatText: vi.fn(),
}));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../services/aiService', () => ({ AIService: class { generateChatText = mocks.generateChatText; } }));
vi.unmock('../store/useAppStore');

import { makeT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { aiTaskJournal } from '../services/aiTaskJournal';
import { PluginPageViewer } from './PluginPageViewer';
import { pluginClient } from '../plugins/pluginClient';

const t = makeT('zh', 'app');
const origin = 'plugin-page://com.example.page';
const props = { pluginId: 'com.example.page', pluginName: 'Example', pageId: 'dashboard',
  pageTitle: 'Dashboard', onClose: vi.fn(), t };

async function load(context?: Record<string, unknown>) {
  const view = render(<PluginPageViewer {...props} initContext={context} />);
  const frame = await screen.findByTitle('Example: Dashboard') as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.load(frame);
  return { ...view, frame, post };
}

async function send(frame: HTMLIFrameElement, requestId: string, method = 'repositories.search',
  args: Record<string, unknown> = { query: 'react' }, overrides: Record<string, unknown> = {}, eventOrigin = origin) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'plugin-page:request', pluginId: props.pluginId, pageId: props.pageId,
        requestId, token: 'session-token', origin, method, args, ...overrides },
      origin: eventOrigin, source: frame.contentWindow,
    }));
  });
}

describe('PluginPageViewer V1.4', () => {
  beforeEach(() => {
    mocks.getPage.mockResolvedValue({ success: true, url: `${origin}/dashboard/index.html`, sessionToken: 'session-token' });
    mocks.requestPageCapability.mockResolvedValue({ success: true, value: null });
    mocks.getSearchEndpoint.mockResolvedValue({ endpoint: 'https://search.example.com' });
    mocks.confirm.mockResolvedValue(true);
    mocks.generateChatText.mockResolvedValue('Generated answer');
    useAppStore.setState({
      user: { id: 91, login: 'fixture' } as never, githubToken: 'fixture',
      aiConfigs: [{ id: 'provider', name: 'Example AI', provider: 'openai', model: 'sample-model',
        baseUrl: 'https://ai.example/v1', apiKey: 'test-secret' } as never],
      activeAIConfig: 'provider', language: 'zh',
    });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { plugins: {
      getPage: mocks.getPage, requestPageCapability: mocks.requestPageCapability,
      getSearchEndpoint: mocks.getSearchEndpoint, searchWeb: mocks.searchWeb,
      disable: vi.fn().mockResolvedValue({ success: true }),
    } } });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks(); vi.restoreAllMocks();
  });

  it('confirms the exact AI prompt, tracks the page journal and returns only text', async () => {
    const { frame, post } = await load();
    await send(frame, 'ai-1', 'ai.generate', { system: 'System instructions', user: 'Example repository' });
    expect(mocks.confirm).toHaveBeenCalledWith('允许插件调用 AI？', expect.stringContaining('Example repository'), expect.any(Object));
    expect(mocks.requestPageCapability).toHaveBeenCalledTimes(2);
    const requests = mocks.requestPageCapability.mock.calls.map(([request]) => request);
    expect(requests[0]).toMatchObject({ sessionToken: 'session-token', requestId: 'ai-1' });
    expect(requests[1].requestId).not.toBe('ai-1');
    expect(mocks.generateChatText).toHaveBeenCalledWith({ system: 'System instructions', user: 'Example repository',
      maxTokens: undefined, signal: expect.any(AbortSignal) });
    const response = post.mock.calls.find(([message]) => message.requestId === 'ai-1')?.[0];
    expect(response).toMatchObject({ success: true, value: 'Generated answer' });
    expect(JSON.stringify(response)).not.toContain('test-secret');
    const task = aiTaskJournal.snapshot().slice(-1)[0]!;
    expect(task.kind).toBe('plugins');
    expect(task.items[0]).toMatchObject({ id: 'dashboard:ai-1', state: 'complete' });
  });

  it('does not call the provider when consent is rejected', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { frame, post } = await load();
    await send(frame, 'ai-2', 'ai.generate', { system: '', user: 'Example repository' });
    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'ai-2', success: false, error: expect.objectContaining({ code: 'PLUGIN_AI_CANCELLED' }),
    }), origin);
    expect(aiTaskJournal.snapshot().slice(-1)[0]!.items[0].state).toBe('failed');
  });
  it('requires fresh consent when the provider changes while the dialog is open', async () => {
    let approve!: (approved: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { approve = resolve; }));
    const { frame, post } = await load();
    await send(frame, 'provider-change', 'ai.generate', { system: '', user: 'Example' });
    await act(async () => {
      useAppStore.setState({ activeAIConfig: 'other-provider' });
      approve(true);
    });
    expect(mocks.generateChatText).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'provider-change', error: expect.objectContaining({ code: 'PLUGIN_PAGE_CLOSED' }),
    }), origin);
  });
  it('finishes the page journal immediately on close while consent is still unresolved', async () => {
    let approve!: (approved: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { approve = resolve; }));
    const { frame, unmount } = await load();
    await send(frame, 'pending-consent', 'ai.generate', { system: '', user: 'Example' });
    const taskId = aiTaskJournal.snapshot().slice(-1)[0].id;
    expect(aiTaskJournal.live(taskId)).toBe(true);
    await act(async () => { unmount(); });
    expect(aiTaskJournal.live(taskId)).toBe(false);
    expect(aiTaskJournal.snapshot().find((task) => task.id === taskId)!.items[0].state).toBe('failed');
    await act(async () => { approve(true); });
    expect(mocks.generateChatText).not.toHaveBeenCalled();
  });

  it('asks before web search and uses fresh session-bound execution request IDs', async () => {
    mocks.searchWeb.mockResolvedValue({ success: true, value: [] });
    const { frame, post } = await load();
    await send(frame, 'search-1', 'web.search', { query: 'Example', limit: 2 });
    expect(mocks.confirm).toHaveBeenCalledWith('允许插件联网搜索？', expect.stringContaining('https://search.example.com'), expect.any(Object));
    expect(mocks.searchWeb).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: props.pluginId, pageId: props.pageId, sessionToken: 'session-token', args: { query: 'Example', limit: 2 },
    }));
    expect(mocks.searchWeb.mock.calls[0][0].requestId).not.toBe('search-1');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'search-1', success: true }), origin);
  });

  it('uses a nonopaque sandbox origin and rejects forged/missing origins and completed replay', async () => {
    const { frame, post } = await load();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'plugin-page:init', token: 'session-token' }), origin);
    await send(frame, 'wrong', undefined, undefined, { token: 'wrong' });
    await send(frame, 'wrong', undefined, undefined, { origin: undefined });
    await send(frame, 'wrong', undefined, undefined, {}, 'null');
    await send(frame, '1');
    await send(frame, '1');
    expect(mocks.requestPageCapability).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      requestId: '1', success: false, error: expect.objectContaining({ code: 'PLUGIN_PAGE_RATE_LIMITED' }),
    }), origin);
  });

  it('counts UTF8 bytes, keeps binary allowance, and rejects circular args', async () => {
    const { frame, post } = await load();
    await send(frame, 'large', 'storage.set', { key: 'x', value: '汉'.repeat(400000) });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'large', error: expect.objectContaining({ code: 'PLUGIN_PAGE_REQUEST_TOO_LARGE' }),
    }), origin);
    await send(frame, 'binary', 'clipboard.writeImage', { dataBase64: 'AAAA'.repeat(400000) });
    expect(mocks.requestPageCapability).toHaveBeenCalledTimes(1);
    const args: Record<string, unknown> = {}; args.self = args;
    await send(frame, 'circular', 'storage.set', args);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'circular', error: expect.objectContaining({ code: 'PLUGIN_PAGE_REQUEST_INVALID' }),
    }), origin);
  });

  it('holds eight slots and enforces the sliding-minute rate after completion', async () => {
    const { frame, post } = await load();
    const finish: Array<(value: unknown) => void> = [];
    mocks.requestPageCapability.mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
    for (let i = 0; i < 9; i++) await send(frame, String(i));
    expect(finish).toHaveLength(8);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: '8', success: false }), origin);
    await act(async () => { finish.forEach((resolve) => resolve({ success: true, value: null })); });
    mocks.requestPageCapability.mockResolvedValue({ success: true, value: null });
    for (let i = 9; i < 122; i++) await send(frame, String(i));
    expect(mocks.requestPageCapability).toHaveBeenCalledTimes(120);
  });

  it('updates README after load without rotating token or leaking the prior context', async () => {
    const { rerender, frame, post } = await load({ readme: null, language: 'zh' });
    rerender(<PluginPageViewer {...props} initContext={{ readme: 'README', language: 'zh' }} />);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'plugin-page:init', token: 'session-token', context: { readme: 'README', language: 'zh' },
    }), origin);
    expect(mocks.getPage).toHaveBeenCalledTimes(1);
    fireEvent.load(frame);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(2));
    expect(mocks.requestPageCapability).toHaveBeenCalledWith(expect.objectContaining({ method: 'page.close' }));
  });

  it('aborts AI and revokes immediately on A-B-A account switch, ignoring late results', async () => {
    let finish!: (text: string) => void;
    mocks.generateChatText.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { frame, post } = await load();
    await send(frame, 'late', 'ai.generate', { system: '', user: 'Example repository' });
    const taskSignal = mocks.generateChatText.mock.calls[0][0].signal as AbortSignal;
    await act(async () => {
      useAppStore.setState({ githubToken: 'other' });
      useAppStore.setState({ githubToken: 'fixture' });
      finish('Late answer');
    });
    expect(taskSignal.aborted).toBe(true);
    expect(props.onClose).toHaveBeenCalled();
    expect(post.mock.calls.some(([message]) => message.requestId === 'late')).toBe(false);
    expect(mocks.requestPageCapability).toHaveBeenCalledWith(expect.objectContaining({ method: 'page.close' }));
  });

  it('supports stopping page AI through the task journal and revokes on local disable', async () => {
    let finish!: (text: string) => void;
    mocks.generateChatText.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { frame } = await load();
    await send(frame, 'stop', 'ai.generate', { system: '', user: 'Example' });
    const task = aiTaskJournal.snapshot().slice(-1)[0]!;
    expect(aiTaskJournal.supports(task.id, 'stop')).toBe(true);
    await act(async () => { aiTaskJournal.control(task.id, 'stop'); finish('Ignored'); });
    expect(aiTaskJournal.snapshot().slice(-1)[0]!.items[0].state).toBe('failed');
    await act(async () => { await pluginClient.disable(props.pluginId); });
    expect(props.onClose).toHaveBeenCalled();
    expect(screen.queryByTitle('Example: Dashboard')).toBeNull();
  });
});

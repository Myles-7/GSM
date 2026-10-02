import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { repositoryChatStorage } from './repositoryChatStorage';

describe('home chat projection', () => {
  it('keeps stable IDs and strips task-envelope fields before a desktop backup roundtrip', async () => {
    const ownerId = '987654'; const sessionId = crypto.randomUUID(); const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await repositoryChatStorage.applyHomeProjection(ownerId, [
      { collection: 'sessions', id: sessionId, data: { id: sessionId, ownerId, repoId: 1, repoFullName: 'owner/repo', sourceRefSha: 'abc', title: 'Question', kind: 'repository', createdAt: now, updatedAt: now } },
      { collection: 'messages', id, data: { id, sessionId, role: 'assistant', content: 'Answer', status: 'complete', evidenceIds: [], createdAt: now, taskId: 'task-envelope', result: { value: 1 }, projectId: null } },
    ]);
    const backup = await repositoryChatStorage.exportWorkbench(ownerId) as { messages: Array<Record<string, unknown>> };
    expect(backup.messages.find(row => row.id === id)).toMatchObject({ id, sessionId, content: 'Answer' });
    expect(backup.messages.find(row => row.id === id)).not.toHaveProperty('taskId');
    await repositoryChatStorage.applyHomeProjection(ownerId, []);
    expect(await repositoryChatStorage.getSession(sessionId)).not.toBeNull();
    await repositoryChatStorage.applyHomeProjection(ownerId, [{ collection: 'sessions', id: sessionId, data: null, deleted: true }]);
    expect(await repositoryChatStorage.getSession(sessionId)).toBeNull();
  });
});

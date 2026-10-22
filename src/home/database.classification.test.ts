import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { HomeDatabase } from './database';

describe('atomic classification outbox', () => {
  it('publishes a structure with all 1000 repository memberships in one immutable batch', async () => {
    const db = new HomeDatabase(crypto.randomUUID());
    await db.editMany([
      { collection: 'organization', id: 'default', data: { classificationSchemes: { technology: { initialized: true } } } },
      ...Array.from({ length: 1000 }, (_, index) => ({ collection: 'repositories' as const, id: String(index + 1), data: { name: `repo-${index}`, classifications: {} } })),
    ]);
    const batch = await db.nextBatch();
    expect(batch.operations).toHaveLength(1001);
    expect(batch.operations.filter(item => item.collection === 'organization')).toHaveLength(1);
    await db.edit('repositories', '1', { name: 'newer' });
    expect(await db.nextBatch()).toEqual(batch);
  });
  it('rolls back every local edit if any version precondition fails', async () => {
    const db = new HomeDatabase(crypto.randomUUID());
    await expect(db.editMany([
      { collection: 'organization', id: 'default', data: { name: 'taxonomy' } },
      { collection: 'repositories', id: '1', data: { name: 'member' }, expectedVersion: 9 },
    ])).rejects.toThrow('资料版本已改变');
    expect(await db.pending()).toEqual([]);
    expect(await db.allRecords()).toEqual([]);
  });
  it('holds dependent membership operations while the taxonomy has a conflict', async () => {
    const db = new HomeDatabase(crypto.randomUUID());
    await db.editMany([
      { collection: 'organization', id: 'default', data: { name: 'taxonomy' } },
      { collection: 'repositories', id: '1', data: { name: 'member' } },
      { collection: 'releases', id: 'release', data: { name: 'unrelated' } },
    ]);
    const organization = (await db.pending()).find(item => item.collection === 'organization')!;
    await db.reject(organization, null, 'VERSION_MISMATCH');
    expect((await db.nextBatch()).operations.map(item => item.collection)).toEqual(['releases']);
  });
});

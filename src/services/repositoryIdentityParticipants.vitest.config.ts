import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.identity-participant-test-cache',
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    include: [
      'src/services/repositoryIdentityParticipants.test.ts',
      'src/services/repositoryChatStorage.test.ts',
      'src/services/repositoryChatWorkbenchStorage.test.ts',
      'src/services/repositoryChatHomeProjection.test.ts',
      'src/services/vectorIndexGeneration.test.ts',
      'src/features/discovery/custom/model.test.ts',
      'src/features/discovery/custom/store.editions.test.ts',
      'src/features/discovery/custom/store.tasks.test.ts',
      'cloudflare-worker/src/identityStorage.test.ts',
    ],
  },
});

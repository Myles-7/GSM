export class SyncError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
    this.name = 'SyncError';
  }
}

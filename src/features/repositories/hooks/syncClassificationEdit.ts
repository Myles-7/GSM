import { useAppStore } from '../../../store/useAppStore';
import { syncAIClassification } from '../../../services/classificationSync';
import { forceSyncToBackend } from '../../../services/autoSync';

export async function syncClassificationEdit(): Promise<void> {
  if (useAppStore.getState().classificationSchemes?.generation) await syncAIClassification();
  else await forceSyncToBackend({ reportFailures: true });
}

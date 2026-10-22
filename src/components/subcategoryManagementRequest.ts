import { captureClassificationEdit, type ClassificationEditCapture } from '../features/repositories/components/classificationEditActions';
export interface SubcategoryManagementRequest {
  type: 'create' | 'rename' | 'move' | 'merge'; parentId: string; id?: string; captured: ClassificationEditCapture;
}
export function subcategoryManagementRequest(type: SubcategoryManagementRequest['type'], parentId: string, id?: string): SubcategoryManagementRequest {
  return { type, parentId, id, captured: captureClassificationEdit() };
}

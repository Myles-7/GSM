import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './ui/button';
import { useClassificationStore } from '../store/useClassificationStore';
import { useAppStore } from '../store/useAppStore';
import { classificationProjection } from '../store/helpers/classificationSchemes';
import { organizationCategories } from '../store/helpers/repositoryOrganization';
import { useDialog } from '../hooks/useDialog';
import { performClassificationEdit } from '../features/repositories/components/classificationEditActions';
import type { SubcategoryManagementRequest } from './subcategoryManagementRequest';
export function SubcategoryManagementDialog({ request, onClose }: { request: SubcategoryManagementRequest; onClose: () => void }) {
  const dialogs = useDialog();
  const zh = useClassificationStore(state => state.language).startsWith('zh');
  const view = classificationProjection(useAppStore.getState(), request.captured.schemeId);
  const source = view.subcategories.find(group => group.id === request.id);
  const categories = organizationCategories(view).filter(category => !category.isHidden);
  const [name, setName] = useState(source?.name ?? '');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const labels = zh ? { create: '添加二级分类', rename: '重命名二级分类', move: '移动二级分类', merge: '合并二级分类' } : { create: 'Add subgroup', rename: 'Rename subgroup', move: 'Move subgroup', merge: 'Merge subgroups' };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const operation = request.type === 'create' ? { type: 'create' as const, parentId: request.parentId, name, icon: '📁' }
        : request.type === 'rename' ? { type: 'rename' as const, id: request.id!, name }
        : request.type === 'move' ? { type: 'move' as const, id: request.id!, parentId: target }
        : { type: 'merge' as const, id: request.id!, targetId: target };
      if (await performClassificationEdit(operation, dialogs, request.captured)) onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} title={labels[request.type]}><form onSubmit={submit} className="space-y-4">
    <p className="break-words text-sm text-muted-foreground">{categories.find(category => category.id === request.parentId)?.name}{source ? ` / ${source.name}` : ''}</p>
    {request.type === 'create' || request.type === 'rename' ? <label className="block text-sm">{zh ? '名称' : 'Name'}<input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
      : <label className="block text-sm">{zh ? '目标分类' : 'Destination'}<select value={target} onChange={event => setTarget(event.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2"><option value="">{zh ? '请选择' : 'Choose a destination'}</option>{request.type === 'move'
        ? categories.filter(category => category.id !== request.parentId).map(category => <option key={category.id} value={category.id}>{category.name}</option>)
        : view.subcategories.filter(group => group.id !== request.id && categories.some(category => category.id === group.parentId)).map(group => <option key={group.id} value={group.id}>{categories.find(category => category.id === group.parentId)?.name} / {group.name}</option>)}</select></label>}
    {request.type === 'merge' && <p className="text-xs text-muted-foreground">{zh ? '保留目标名称、顺序和标识；源分类仓库全部移入目标。' : 'The destination keeps its name, order and ID. All source repositories move into it.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>{zh ? '取消' : 'Cancel'}</Button><Button type="submit" disabled={busy || ((request.type === 'create' || request.type === 'rename') ? !name.trim() : !target)}>{busy ? (zh ? '处理中' : 'Processing') : (zh ? '保存' : 'Save')}</Button></div>
  </form></Modal>;
}

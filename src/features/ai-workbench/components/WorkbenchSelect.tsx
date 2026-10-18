import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { cn } from '../../../lib/utils';

export interface WorkbenchSelectItem<T extends string> {
  value: T;
  label: string;
}

interface WorkbenchSelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  items: readonly WorkbenchSelectItem<T>[];
  /** Radix rejects empty-string values, so '' must never be a valid option. */
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

/**
 * Compact select used across the AI workbench (sidebar mode, overview filters,
 * inspiration-card scope editor). Replaces raw <select> elements so hover /
 * focus / theme transitions stay consistent with the rest of the app.
 */
export function WorkbenchSelect<T extends string>({
  value,
  onValueChange,
  items,
  ariaLabel,
  placeholder,
  className,
  triggerClassName,
  disabled,
}: WorkbenchSelectProps<T>) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as T)} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          'h-8 min-w-0 max-w-full rounded-md border border-border/60 bg-muted/40 px-2 text-xs text-foreground transition-colors hover:bg-muted/70',
          triggerClassName,
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="text-xs">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

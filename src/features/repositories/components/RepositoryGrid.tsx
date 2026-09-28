import { useEffect, useRef, useState, type ReactNode } from 'react';

export function RepositoryGrid({ children, viewMode }: { children: ReactNode; viewMode: 'grid' | 'list' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const columns = viewMode === 'list' ? 1 : Math.max(1, Math.floor((width + 16) / 336));
  return (
    <div ref={ref} className="grid min-w-0 gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

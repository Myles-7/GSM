import { Star } from 'lucide-react';

const colors: Record<string, string> = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
  'C++': '#f34b7d', C: '#555555', 'C#': '#239120', Go: '#00ADD8', Rust: '#dea584',
  PHP: '#4F5D95', Ruby: '#701516', Swift: '#fa7343', Kotlin: '#A97BFF', Dart: '#00B4AB',
  Shell: '#89e051', HTML: '#e34c26', CSS: '#1572B6', Vue: '#4FC08D', React: '#61DAFB',
};
export function RepositoryLanguageStars({ language, stars, outlinedLanguage = false }: { language?: string | null; stars?: number; outlinedLanguage?: boolean }) {
  const formatted = stars === undefined ? '' : stars >= 1000000 ? `${(stars / 1000000).toFixed(1)}M` : stars >= 1000 ? `${(stars / 1000).toFixed(1)}K` : String(stars);
  return <>
    {language && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${outlinedLanguage ? 'outline outline-1 outline-muted-foreground/50' : ''}`} style={{ backgroundColor: colors[language] || '#6b7280' }} />
      <span className="truncate max-w-20">{language}</span>
    </span>}
    {stars !== undefined && <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Star className="h-3.5 w-3.5" /><span>{formatted}</span></span>}
  </>;
}

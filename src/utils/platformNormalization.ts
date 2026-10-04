import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';

export const CANONICAL_PLATFORMS = [
  'windows',
  'macos',
  'linux',
  'web',
  'android',
  'ios',
  'docker',
  'cli',
] as const;

export type CanonicalPlatform = typeof CANONICAL_PLATFORMS[number];

export const PLATFORM_NAME_MAP: Record<string, string> = {
  mac: 'macOS',
  macos: 'macOS',
  windows: 'Windows',
  win: 'Windows',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
  web: 'Web',
  cli: 'CLI',
  docker: 'Docker',
};

/**
 * 将任意原始平台字符串（包括版本号、中文或运行环境描述）归一化为核心标准平台大类。
 * 若无法归入标准大类（如纯语言运行时 Node.js/Python 或硬件 CUDA），返回 null。
 */
export function normalizePlatform(raw?: string | null): CanonicalPlatform | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // 1. Windows: 包含 Windows、Win10/11、Win32/64 等
  if (/windows|win10|win11|win32|win64|win\b/i.test(s)) return 'windows';

  // 2. macOS: 包含 macOS、Mac OS、Apple Silicon、M系列、Darwin、OSX 等
  if (/\bmac\b|macos|mac\s*os|apple\s*silicon|m系列|darwin|osx/i.test(s)) return 'macos';

  // 3. Linux: 包含 Linux、Ubuntu、Debian、Arch、Fedora、CentOS、WSL、POSIX、glibc 等
  if (/linux|ubuntu|debian|arch|fedora|centos|wsl|posix|glibc|nixos/i.test(s)) return 'linux';

  // 4. Web: 包含 Web、Browser、浏览器、Chrome、Firefox、Safari、HTML、Cloudflare 等
  if (/web|browser|浏览器|chrome|firefox|safari|html|cloudflare/i.test(s)) return 'web';

  // 5. Android / 移动鸿蒙
  if (/android|harmonyos|鸿蒙/i.test(s)) return 'android';

  // 6. iOS
  if (/ios|ipad|iphone/i.test(s)) return 'ios';

  // 7. Docker / 容器
  if (/docker|container|k8s|kubernetes/i.test(s)) return 'docker';

  // 8. CLI / 命令行工具
  if (/cli|terminal|命令行|bash|zsh|tui\b/i.test(s)) return 'cli';

  return null;
}

/**
 * 提取一组平台字符串中的有效标准平台列表（自动去重且按标准优先级排序）。
 */
export function getCanonicalPlatforms(rawPlatforms?: string[] | null): CanonicalPlatform[] {
  if (!rawPlatforms || !Array.isArray(rawPlatforms) || rawPlatforms.length === 0) {
    return [];
  }
  const set = new Set<CanonicalPlatform>();
  for (const item of rawPlatforms) {
    const normalized = normalizePlatform(item);
    if (normalized) {
      set.add(normalized);
    }
  }
  return CANONICAL_PLATFORMS.filter(p => set.has(p));
}

export function getPlatformDisplayName(platform: string): string {
  const norm = normalizePlatform(platform);
  if (norm && PLATFORM_NAME_MAP[norm]) {
    return PLATFORM_NAME_MAP[norm];
  }
  return PLATFORM_NAME_MAP[platform.toLowerCase()] ?? platform;
}

/** Preserve the existing combined filter while details keep three separate dimensions. */
export function platformsFromDetails(details: Pick<RepositoryDetailsAnalysis, 'platforms' | 'software_forms' | 'deployment_modes'>): string[] {
  return getCanonicalPlatforms([
    ...(details.platforms ?? []),
    ...(details.software_forms ?? []).filter(form => form === 'cli' || form === 'web'),
    ...(details.deployment_modes?.includes('container') ? ['docker'] : []),
  ]).map(platform => details.platforms?.find(raw => normalizePlatform(raw) === platform) ?? platform);
}

import type { ElementType } from 'react';
import { Globe, Monitor, Terminal } from 'lucide-react';
import { SiAndroid, SiApple, SiDocker, SiIos, SiLinux } from '@icons-pack/react-simple-icons';
import { SiWindows } from './SiWindows';
import {
  CANONICAL_PLATFORMS,
  type CanonicalPlatform,
  normalizePlatform,
  getCanonicalPlatforms,
  getPlatformDisplayName,
  PLATFORM_NAME_MAP,
} from '../utils/platformNormalization';

export {
  CANONICAL_PLATFORMS,
  type CanonicalPlatform,
  normalizePlatform,
  getCanonicalPlatforms,
  getPlatformDisplayName,
  PLATFORM_NAME_MAP,
};

/** 平台标识 → 图标组件。CLI/Web 无品牌字形，沿用 lucide 线性图标。 */
export const PLATFORM_ICON_MAP: Record<string, ElementType> = {
  mac: SiApple,
  macos: SiApple,
  ios: SiIos,
  windows: SiWindows,
  win: SiWindows,
  linux: SiLinux,
  android: SiAndroid,
  web: Globe,
  cli: Terminal,
  docker: SiDocker,
};

export const DEFAULT_PLATFORM_ICON: ElementType = Monitor;

export function getPlatformIcon(platform: string): ElementType {
  const norm = normalizePlatform(platform);
  if (norm && PLATFORM_ICON_MAP[norm]) {
    return PLATFORM_ICON_MAP[norm];
  }
  return PLATFORM_ICON_MAP[platform.toLowerCase()] ?? DEFAULT_PLATFORM_ICON;
}

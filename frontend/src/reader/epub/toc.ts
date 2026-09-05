import type { NavItem } from 'epubjs/types/navigation';
import type { TocItem } from '../../types';

export function navItemsToToc(items: NavItem[]): TocItem[] {
  return items.map((item) => ({
    label: item.label?.trim() || 'Untitled',
    href: item.href,
    items: item.subitems?.length ? navItemsToToc(item.subitems) : undefined,
  }));
}

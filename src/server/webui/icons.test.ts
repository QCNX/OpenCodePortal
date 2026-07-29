import { describe, expect, it } from 'vitest';
import { renderPortalIcon, type PortalIconName } from './icons';

describe('portal icons', () => {
  const icons: PortalIconName[] = [
    'info',
    'refresh',
    'sun',
    'moon',
    'system',
    'language',
    'deploy',
    'edit',
    'delete',
  ];

  it.each(icons)('renders the %s icon as an accessible decorative SVG', (name) => {
    const svg = renderPortalIcon(name);

    expect(svg).toContain('<svg');
    expect(svg).toContain(`data-portal-icon="${name}"`);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1.6"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('<script');
  });
});

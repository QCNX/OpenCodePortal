import { describe, expect, it } from 'vitest';
import { loadSetupGuideContent, parseSetupGuide } from './loader';

describe('setup guide loader', () => {
  it('loads all supported locales from the docs directory', () => {
    const content = loadSetupGuideContent(`${process.cwd()}/docs`);

    expect(content).not.toBeNull();
    expect(content?.en[0]?.title).toContain('Install OpenCode Server');
    expect(content?.['zh-CN'][0]?.title).toContain('安装 OpenCode Server');
    expect(content?.['zh-TW'][0]?.title).toContain('安裝 OpenCode Server');
  });

  it('parses headings and fenced code without changing the structure', () => {
    const steps = parseSetupGuide('## Step\n\n### Sub-step\n\n```bash\necho ok\n```');

    expect(steps).toHaveLength(1);
    expect(steps[0].subSteps).toHaveLength(1);
    expect(steps[0].subSteps[0].content).toContain('<pre><code>echo ok</code></pre>');
  });
});

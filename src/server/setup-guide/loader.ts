import * as fs from 'fs';
import * as path from 'path';
import type { PortalLocale } from '../i18n';

// -- Setup guide -----------------------------------------------------------------

export interface SetupSubStep {
  title: string;
  content: string; // rendered HTML
}

export interface SetupStep {
  title: string;
  subSteps: SetupSubStep[];
  content: string; // rendered HTML (used when no sub-steps)
}

export type SetupGuideContent = Record<PortalLocale, SetupStep[]>;

/** Simple markdown-to-HTML renderer for setup guide content. */
export function renderSetupMd(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let inBlockquote = false;
  let inUl = false;
  let buf = '';       // regular paragraph buffer
  let bqBuf = '';     // blockquote paragraph buffer
  let codeBuf: string[] = [];  // code block buffer (avoids leading newline in <pre>)

  function fmtInline(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  function escCode(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function flushPara() {
    const t = buf.trim();
    if (t) out.push(`<p>${fmtInline(t)}</p>`);
    buf = '';
  }

  function flushBqPara() {
    const t = bqBuf.trim();
    if (t) out.push(`<p>${fmtInline(t)}</p>`);
    bqBuf = '';
  }

  function flushUl() {
    if (inUl) { out.push('</ul>'); inUl = false; }
  }

  function endBlockquote() {
    if (inCode) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); inCode = false; codeBuf = []; }
    flushBqPara();
    out.push('</blockquote>');
    inBlockquote = false;
  }

  for (const line of lines) {
    // code fence (outside blockquote only)
    if (!inBlockquote && line.startsWith('```')) {
      if (inCode) {
        out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
        inCode = false;
        codeBuf = [];
      } else {
        flushPara(); flushUl();
        codeBuf = [];
        inCode = true;
      }
      continue;
    }
    if (!inBlockquote && inCode) {
      codeBuf.push(escCode(line));
      continue;
    }

    // blockquote line
    if (line.startsWith('> ')) {
      const content = line.slice(2);
      if (!inBlockquote) { flushPara(); flushUl(); out.push('<blockquote>'); inBlockquote = true; }

      // code fence inside blockquote
      if (content.startsWith('```')) {
        flushBqPara();
        if (inCode) {
          out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
          inCode = false;
          codeBuf = [];
        } else {
          codeBuf = [];
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(escCode(content));
        continue;
      }
      // blockquote paragraph text
      if (content.trim() === '') {
        flushBqPara();
      } else {
        bqBuf += (bqBuf ? ' ' : '') + content;
      }
      continue;
    }

    // exit blockquote
    if (inBlockquote) { endBlockquote(); }

    // list item
    const liMatch = line.match(/^[-*]\s+(.+)/);
    if (liMatch) {
      flushPara();
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${fmtInline(liMatch[1])}</li>`);
      continue;
    }
    flushUl();

    // empty line → paragraph break
    if (line.trim() === '') { flushPara(); continue; }

    // regular paragraph text
    buf += (buf ? ' ' : '') + line;
  }

  if (inBlockquote) endBlockquote();
  flushUl();
  flushPara();
  return out.join('\n');
}

/** Parse a setup guide markdown file into structured steps. */
export function parseSetupGuide(raw: string): SetupStep[] {
  // Split by H2 (## )
  const h2Blocks = raw.split(/\n(?=## )/);
  const steps: SetupStep[] = [];

  for (const block of h2Blocks) {
    const lines = block.split('\n');
    const titleLine = lines[0];
    if (!titleLine.startsWith('## ')) continue;
    const title = titleLine.slice(3).trim();
    const body = lines.slice(1).join('\n').trim();

    // Check for H3 sub-steps (### )
    const h3Parts = body.split(/\n(?=### )/);
    if (h3Parts.length > 1 || (h3Parts.length === 1 && h3Parts[0].startsWith('### '))) {
      // Has sub-steps
      const subSteps: SetupSubStep[] = [];
      for (const part of h3Parts) {
        const subLines = part.split('\n');
        if (!subLines[0].startsWith('### ')) continue;
        const subTitle = subLines[0].slice(4).trim();
        const subBody = subLines.slice(1).join('\n').trim();
        subSteps.push({ title: subTitle, content: renderSetupMd(subBody) });
      }
      steps.push({ title, subSteps, content: '' });
    } else {
      // No sub-steps
      steps.push({ title, subSteps: [], content: renderSetupMd(body) });
    }
  }

  return steps;
}

/** Load setup guide content from disk. Returns null if files are missing. */
export function loadSetupGuideContent(docsDir: string): SetupGuideContent | null {
  const zhCNPath = path.join(docsDir, 'setup-guide', 'zh-CN.md');
  const zhTWPath = path.join(docsDir, 'setup-guide', 'zh-TW.md');
  const enPath = path.join(docsDir, 'setup-guide', 'en.md');
  try {
    const zhCN = parseSetupGuide(fs.readFileSync(zhCNPath, 'utf-8'));
    const zhTW = parseSetupGuide(fs.readFileSync(zhTWPath, 'utf-8'));
    const en = parseSetupGuide(fs.readFileSync(enPath, 'utf-8'));
    return { 'zh-CN': zhCN, 'zh-TW': zhTW, en };
  } catch {
    return null;
  }
}

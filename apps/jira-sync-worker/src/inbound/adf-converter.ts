/**
 * adf-converter.ts — Atlassian Document Format → sanitised plain-text.
 *
 * Pure function: no I/O, no framework dependencies.
 *
 * Strategy:
 *   - Only allow-listed ADF node types are rendered; unsupported types are
 *     silently dropped (their text children are still walked recursively).
 *   - Attachments are referenced by URL when available; not downloaded.
 *   - Output is truncated at MAX_BODY_LENGTH with an ellipsis marker.
 *
 * ADF spec reference:
 *   https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */

export const MAX_BODY_LENGTH = 32_768; // 32 KB — generous for a comment body
const TRUNCATION_MARKER = '\n\n[… truncated]';

// ---------------------------------------------------------------------------
// Allow-listed block node renderers
// ---------------------------------------------------------------------------

type AdfNode = {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function renderNode(node: AdfNode, depth: number): string {
  if (depth > 20) return ''; // guard against pathological recursion

  switch (node.type) {
    case 'doc':
      return renderChildren(node.content ?? [], depth);

    case 'paragraph':
      return renderChildren(node.content ?? [], depth) + '\n';

    case 'text': {
      let t = node.text ?? '';
      // Render code mark inline
      if (node.marks?.some((m) => m.type === 'code')) {
        t = `\`${t}\``;
      }
      // Render link mark
      const linkMark = node.marks?.find((m) => m.type === 'link');
      if (linkMark?.attrs?.['href']) {
        const href = String(linkMark.attrs['href']);
        // Only render https:// links — no javascript:, data:, etc.
        if (/^https?:\/\//i.test(href)) {
          return `[${t}](${href})`;
        }
      }
      return t;
    }

    case 'hardBreak':
      return '\n';

    case 'heading': {
      const level = Number(node.attrs?.['level'] ?? 1);
      const hashes = '#'.repeat(Math.min(Math.max(level, 1), 6));
      return `${hashes} ${renderChildren(node.content ?? [], depth)}\n`;
    }

    case 'bulletList':
      return renderChildren(node.content ?? [], depth) + '\n';

    case 'orderedList':
      return renderOrderedList(node.content ?? [], depth);

    case 'listItem':
      return `- ${renderChildren(node.content ?? [], depth).trim()}\n`;

    case 'codeBlock': {
      const lang = String(node.attrs?.['language'] ?? '');
      const code = renderChildren(node.content ?? [], depth).trim();
      return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case 'blockquote':
      return renderChildren(node.content ?? [], depth)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n') + '\n';

    case 'rule':
      return '\n---\n';

    case 'mention': {
      const displayName = String(node.attrs?.['text'] ?? node.attrs?.['id'] ?? '@mention');
      return `@${displayName.replace(/^@/, '')}`;
    }

    case 'emoji': {
      const shortName = String(node.attrs?.['shortName'] ?? node.attrs?.['text'] ?? '');
      return shortName || ':emoji:';
    }

    case 'mediaGroup':
    case 'mediaSingle': {
      // Render contained media nodes
      return renderChildren(node.content ?? [], depth) + '\n';
    }

    case 'media': {
      const url = node.attrs?.['url'] as string | undefined;
      const alt = String(node.attrs?.['alt'] ?? node.attrs?.['id'] ?? 'attachment');
      if (url && /^https?:\/\//i.test(url)) {
        return `[${alt}](${url})\n`;
      }
      return `[attachment: ${alt}]\n`;
    }

    case 'inlineCard': {
      const url = node.attrs?.['url'] as string | undefined;
      if (url && /^https?:\/\//i.test(url)) {
        return `<${url}>`;
      }
      return '';
    }

    case 'table':
      // Tables: render as plain text rows separated by newlines
      return renderChildren(node.content ?? [], depth) + '\n';

    case 'tableRow':
      return renderChildren(node.content ?? [], depth).trimEnd() + '\n';

    case 'tableHeader':
    case 'tableCell':
      return renderChildren(node.content ?? [], depth).trim() + ' | ';

    default:
      // Unknown node: walk children to avoid losing text content
      return renderChildren(node.content ?? [], depth);
  }
}

function renderChildren(children: AdfNode[], depth: number): string {
  return children.map((c) => renderNode(c, depth + 1)).join('');
}

function renderOrderedList(items: AdfNode[], depth: number): string {
  return items
    .map((item, idx) => {
      const inner = renderChildren(item.content ?? [], depth + 1).trim();
      return `${idx + 1}. ${inner}\n`;
    })
    .join('') + '\n';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an Atlassian Document Format value to sanitised plain-text.
 *
 * Accepts:
 *   - ADF JSON object ({ type: 'doc', ... })
 *   - Plain string (returned as-is, still truncated)
 *   - null / undefined → empty string
 *
 * Returns a UTF-8 string truncated to MAX_BODY_LENGTH.
 */
export function convertAdfToText(adf: unknown): string {
  if (adf == null) return '';
  if (typeof adf === 'string') {
    return adf.length > MAX_BODY_LENGTH
      ? adf.slice(0, MAX_BODY_LENGTH) + TRUNCATION_MARKER
      : adf;
  }

  let result: string;
  try {
    result = renderNode(adf as AdfNode, 0).trimEnd();
  } catch {
    // Malformed ADF — return empty rather than crashing
    result = '';
  }

  if (result.length > MAX_BODY_LENGTH) {
    return result.slice(0, MAX_BODY_LENGTH) + TRUNCATION_MARKER;
  }
  return result;
}

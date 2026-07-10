/** Parsed search input: free text plus structured modifiers. */
export interface ParsedSearchQuery {
  text: string;
  from: string | null;
  in: string | null;
  before: Date | null;
  after: Date | null;
  hasLink: boolean;
  hasFile: boolean;
}

const MODIFIER_RE = /(^|\s)(from|in|before|after|has):("[^"]+"|\S+)/gi;

/**
 * Pulls Slack-style modifiers out of a query string:
 *   from:alice in:general before:2026-01-01 after:2025-06-01 has:link has:file
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    text: '',
    from: null,
    in: null,
    before: null,
    after: null,
    hasLink: false,
    hasFile: false,
  };

  const rest = raw.replace(MODIFIER_RE, (_match, _lead, key: string, value: string) => {
    const cleaned = value.replace(/^"|"$/g, '');
    switch (key.toLowerCase()) {
      case 'from':
        result.from = cleaned.replace(/^@/, '');
        break;
      case 'in':
        result.in = cleaned.replace(/^#/, '');
        break;
      case 'before': {
        const d = new Date(cleaned);
        if (!Number.isNaN(d.getTime())) result.before = d;
        break;
      }
      case 'after': {
        const d = new Date(cleaned);
        if (!Number.isNaN(d.getTime())) result.after = d;
        break;
      }
      case 'has':
        if (cleaned.toLowerCase() === 'link') result.hasLink = true;
        if (cleaned.toLowerCase() === 'file') result.hasFile = true;
        break;
    }
    return ' ';
  });

  result.text = rest.replace(/\s+/g, ' ').trim();
  return result;
}

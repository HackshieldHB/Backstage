/** Pure helpers shared by the workflow trigger engine and the run executor. */

/** Replace {{name}} tokens with values; unknown tokens are left as typed. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

/** A minimal TipTap doc, one paragraph per line. */
export function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) =>
        l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
      ),
  };
}

/** YYYY-MM-DD, in a time zone when given (else UTC). */
export function isoDate(at: Date, timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

'use client';

/**
 * Brand-coloured monogram tiles. These are clean, asset-free PLACEHOLDERS that can
 * be swapped for real SVG logos later — the logo is a separate concept from the
 * UI icons used elsewhere. Never an emoji.
 */
const BRAND: Record<string, { bg: string; fg: string; mark: string }> = {
  miro: { bg: '#FFD02F', fg: '#050038', mark: 'M' },
  launchdarkly: { bg: '#405BFF', fg: '#FFFFFF', mark: 'L' },
  atlassian: { bg: '#0052CC', fg: '#FFFFFF', mark: 'A' },
  datadog: { bg: '#632CA6', fg: '#FFFFFF', mark: 'D' },
  salesforce: { bg: '#00A1E0', fg: '#FFFFFF', mark: 'S' },
};

const DIMS = { sm: 28, md: 40, lg: 52 } as const;
const FONT = { sm: 13, md: 17, lg: 22 } as const;

export function ApplicationLogo({
  appId,
  size = 'md',
}: {
  appId: string;
  size?: keyof typeof DIMS;
}) {
  const b = BRAND[appId] ?? { bg: '#64748b', fg: '#FFFFFF', mark: (appId[0] ?? '?').toUpperCase() };
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold shadow-sm"
      style={{ width: DIMS[size], height: DIMS[size], background: b.bg, color: b.fg, fontSize: FONT[size] }}
    >
      {b.mark}
    </span>
  );
}

import clsx from 'clsx';

/**
 * The Backstages mark: a "B" on a stage lit by the spotlight gradient (sky
 * stage light into deep blue, the same in every theme), finished like glass: a bright top
 * lip, a hairline rim, and a sheen that sweeps across on hover. `glow` adds a
 * soft halo in the accent colour.
 */
export function BrandMark({ size = 28, glow = false, className }: { size?: number; glow?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'brand-mark brand-spotlight inline-flex shrink-0 items-center justify-center rounded-[28%]',
        glow && 'brand-mark-glow',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="brand-mark-letter select-none font-bold leading-none tracking-tight text-white" style={{ fontSize: size * 0.5 }}>
        B
      </span>
    </span>
  );
}

/** Mark + wordmark, for the sign-in / onboarding pages. */
export function BrandLockup() {
  return (
    <span className="group inline-flex items-center gap-2.5">
      <BrandMark size={30} glow />
      <span className="text-[19px] font-semibold tracking-tight text-ink">Backstages</span>
    </span>
  );
}

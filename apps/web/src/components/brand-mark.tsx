import clsx from 'clsx';

/**
 * The Backstages mark: a "B" on a stage lit by the spotlight gradient (violet
 * stage light fading to a warm footlight).
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('brand-spotlight inline-flex shrink-0 items-center justify-center rounded-[28%] shadow-sm', className)}
      style={{ width: size, height: size }}
    >
      <span className="select-none font-bold leading-none tracking-tight text-white" style={{ fontSize: size * 0.5 }}>
        B
      </span>
    </span>
  );
}

/** Mark + wordmark, for the sign-in / onboarding pages. */
export function BrandLockup() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={30} />
      <span className="text-[19px] font-semibold tracking-tight text-ink">Backstages</span>
    </span>
  );
}

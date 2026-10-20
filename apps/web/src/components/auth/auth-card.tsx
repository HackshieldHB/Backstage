import { BrandLockup } from '../brand-mark';

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex justify-center">
          <BrandLockup />
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
          <h1 className="mb-5 text-[17px] font-semibold tracking-tight text-ink">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none"
      />
    </label>
  );
}

export function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} className="btn-primary mt-1 w-full py-2 text-sm">
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{message}</p>;
}

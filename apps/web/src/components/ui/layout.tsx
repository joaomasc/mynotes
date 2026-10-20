import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Page title row: title, optional subtitle/breadcrumb and actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  above,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  above?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {above && <div className="mb-2">{above}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* At least ~16rem for the title: when the actions don't fit beside it, they go below (instead of squeezing it). */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <h1 className="text-[1.5rem] leading-tight font-semibold tracking-tight text-balance sm:text-[1.75rem]">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Page({ children, width = 'default', className }: { children: ReactNode; width?: 'default' | 'wide' | 'full' | 'narrow'; className?: string }) {
  const widths = { narrow: 'max-w-3xl', default: 'max-w-5xl', wide: 'max-w-7xl', full: 'max-w-none' };
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', widths[width], className)}>{children}</div>;
}

export function Card({ children, className, as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' }) {
  return <As className={cn('rounded-xl border border-border bg-surface', className)}>{children}</As>;
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

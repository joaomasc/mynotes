import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Input } from './form';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Bottom sheet on small screens (default). */
  sheet?: boolean;
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', sheet = true }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] animate-fade-in" />
        <RDialog.Content
          className={cn(
            'fixed z-50 flex max-h-[92dvh] w-full animate-pop-in flex-col border border-border bg-surface shadow-pop focus:outline-none',
            sheet
              ? 'inset-x-0 bottom-0 rounded-t-2xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl'
              : 'top-1/2 left-1/2 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl',
            widths[size],
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <RDialog.Title className="text-base font-semibold text-text">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close className="-mt-1 -mr-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label="Fechar">
              <X className="size-4" />
            </RDialog.Close>
          </div>
          {children && <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>}
          {footer && (
            <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ---------------------------------------------------------- confirm -- */

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Require typing this word to enable the confirm button. */
  typeToConfirm?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setTyped('');
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const blocked = !!options?.typeToConfirm && typed.trim() !== options.typeToConfirm;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!options}
        onOpenChange={(open) => !open && close(false)}
        title={options?.title ?? ''}
        description={options?.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {options?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button variant={options?.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)} autoFocus>
              {options?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        {options?.typeToConfirm && (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Digite <strong className="font-mono text-text">{options.typeToConfirm}</strong> para confirmar.
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Confirmação" />
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm outside ConfirmProvider');
  return fn;
}

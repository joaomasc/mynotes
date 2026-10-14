import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

export type MenuEntry = MenuItem | 'separator';

/** Dropdown menu that works with mouse, touch and keyboard. */
export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end' | 'center';
  label?: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild aria-label={label}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 min-w-[200px] rounded-xl border border-border bg-surface p-1 shadow-pop"
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <DropdownMenu.Separator key={`sep-${i}`} className="my-1 h-px bg-border" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none select-none',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2',
                  item.danger ? 'text-danger' : 'text-text',
                )}
              >
                <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4" aria-hidden>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-xs text-subtle">{item.shortcut}</span>}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { TOPIC_TITLE_MAX, uuidv7 } from '@mynotes/shared';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { invalidateTopicData } from './topic-dialogs';

/**
 * Creates subtopics in place: type a title, Enter, type the next one.
 * Esc (or leaving the field empty) closes it.
 */
export function InlineTopicCreate({
  parentId,
  label = 'Novo subassunto',
  className,
}: {
  parentId: string | null;
  label?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: (t: string) => endpoints.topics.create({ id: uuidv7(), title: t, parentId }),
    onSuccess: () => {
      setTitle('');
      invalidateTopicData(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline', className)}
      >
        <Plus className="size-3.5" aria-hidden /> {label}
      </button>
    );
  }
  return (
    <form
      className={cn('flex items-center gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (t && !create.isPending) create.mutate(t);
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setTitle(''))}
        onBlur={() => !title.trim() && setOpen(false)}
        maxLength={TOPIC_TITLE_MAX}
        placeholder={`${label}: título e Enter (Esc para sair)`}
        aria-label={label}
        disabled={create.isPending}
        className="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-surface px-3 text-base outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
      />
    </form>
  );
}

import { Link } from 'react-router';
import type { NoteSummary } from '@mynotes/shared';
import { relativeTime } from '@/lib/format';
import { TopicChip } from '../shared/topic-breadcrumb';

export function NoteListItem({ note, showTopic = true }: { note: NoteSummary; showTopic?: boolean }) {
  return (
    <Link to={`/notes/${note.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={note.title ? 'truncate font-medium' : 'truncate font-medium text-subtle italic'}>
          {note.title || 'Sem título'}
        </span>
        <span className="shrink-0 text-xs text-subtle">{relativeTime(note.updatedAt)}</span>
      </div>
      {note.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{note.excerpt}</p>}
      {showTopic && note.topicId && (
        <div className="mt-1.5">
          <TopicChip topicId={note.topicId} link={false} />
        </div>
      )}
    </Link>
  );
}

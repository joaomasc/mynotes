import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { topicPath, useTopics } from '../topics/use-topics';

/** "Economia › Macroeconomia › Inflação" with links; empty when no topic. */
export function TopicBreadcrumb({ topicId, includeSelf = true }: { topicId: string | null | undefined; includeSelf?: boolean }) {
  const { tree } = useTopics();
  const path = topicPath(tree, topicId);
  const items = includeSelf ? path : path.slice(0, -1);
  if (items.length === 0) return null;
  return (
    <nav aria-label="Caminho" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted">
      {items.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <ChevronRight className="size-3.5 text-subtle" aria-hidden />}
          <Link to={`/topics/${t.id}`} className="max-w-[16rem] truncate hover:text-accent">
            {t.title}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}

/** Topic label. Use `link={false}` inside an element that is already a link. */
export function TopicChip({ topicId, link = true }: { topicId: string | null | undefined; link?: boolean }) {
  const { tree } = useTopics();
  const topic = topicId ? tree.byId.get(topicId) : undefined;
  if (!topic) return null;
  const content = (
    <>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: topic.color ?? 'var(--border-strong)' }} aria-hidden />
      <span className="truncate">{topic.title}</span>
    </>
  );
  const cls = 'inline-flex max-w-full items-center gap-1.5 truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted';
  if (!link) return <span className={cls}>{content}</span>;
  return (
    <Link to={`/topics/${topic.id}`} className={`${cls} hover:text-accent`}>
      {content}
    </Link>
  );
}

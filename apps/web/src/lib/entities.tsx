import type { ComponentType } from 'react';
import {
  BookOpen,
  CalendarDays,
  FileText,
  FolderTree,
  Lightbulb,
  ListTodo,
  Network,
  StickyNote,
  type LucideProps,
} from 'lucide-react';
import { ENTITY_LABELS, type EntityType } from '@mynotes/shared';

export const ENTITY_ICONS: Record<EntityType, ComponentType<LucideProps>> = {
  topic: FolderTree,
  note: StickyNote,
  document: FileText,
  reading: BookOpen,
  concept: Lightbulb,
  plan: ListTodo,
  mindmap: Network,
  session: CalendarDays,
};

/** Tailwind text color class per entity type (also used by the graph legend). */
export const ENTITY_TEXT: Record<EntityType, string> = {
  topic: 'text-topic',
  note: 'text-note',
  document: 'text-document',
  reading: 'text-reading',
  concept: 'text-concept',
  plan: 'text-accent',
  mindmap: 'text-accent',
  session: 'text-accent',
};

export const ENTITY_CSS_VAR: Record<string, string> = {
  topic: 'var(--c-topic)',
  note: 'var(--c-note)',
  document: 'var(--c-document)',
  reading: 'var(--c-reading)',
  concept: 'var(--c-concept)',
};

export function entityPath(type: EntityType | string, id: string): string {
  switch (type) {
    case 'topic':
      return `/topics/${id}`;
    case 'note':
      return `/notes/${id}`;
    case 'document':
      return `/library/${id}`;
    case 'reading':
      return `/readings/${id}`;
    case 'concept':
      return `/concepts/${id}`;
    case 'plan':
      return `/plans/${id}`;
    case 'mindmap':
      return `/maps/${id}`;
    default:
      return '/study';
  }
}

export function EntityIcon({ type, className }: { type: EntityType | string; className?: string }) {
  const Icon = ENTITY_ICONS[type as EntityType] ?? FileText;
  return <Icon className={className ?? `size-4 ${ENTITY_TEXT[type as EntityType] ?? ''}`} aria-hidden />;
}

export function entityLabel(type: EntityType | string): string {
  return ENTITY_LABELS[type as EntityType] ?? type;
}

export const TOPIC_COLORS = ['#0f6e6a', '#3a5ba9', '#a3532a', '#7a4fa0', '#8a7a12', '#b4372f', '#2f7a3e', '#5c5a54'];

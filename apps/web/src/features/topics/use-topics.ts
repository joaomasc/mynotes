import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TopicWithCounts } from '@mynotes/shared';
import { endpoints } from '@/lib/api/endpoints';
import { qk } from '@/lib/query';

export interface TopicNode extends TopicWithCounts {
  children: TopicNode[];
  depth: number;
}

export interface TopicTree {
  roots: TopicNode[];
  byId: Map<string, TopicNode>;
  /** Depth-first order with depth, for selects and keyboard navigation. */
  flat: TopicNode[];
}

export function buildTree(topics: TopicWithCounts[]): TopicTree {
  const byId = new Map<string, TopicNode>();
  for (const t of topics) byId.set(t.id, { ...t, children: [], depth: 0 });
  const roots: TopicNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: TopicNode[]) =>
    list.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id.localeCompare(b.id)));
  const flat: TopicNode[] = [];
  const walk = (list: TopicNode[], depth: number) => {
    for (const n of sort(list)) {
      n.depth = depth;
      flat.push(n);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return { roots, byId, flat };
}

export function useTopics() {
  const query = useQuery({ queryKey: qk.topics, queryFn: endpoints.topics.list });
  const tree = useMemo(() => buildTree(query.data ?? []), [query.data]);
  return { ...query, tree };
}

/** Ancestors from the root to the topic (inclusive). */
export function topicPath(tree: TopicTree, id: string | null | undefined): TopicNode[] {
  const path: TopicNode[] = [];
  let current = id ? tree.byId.get(id) : undefined;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? tree.byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Ids of a topic and all its descendants (to prevent invalid moves). */
export function descendantIds(node: TopicNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: TopicNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

/**
 * What lights up when an item of a mind map is clicked: its path up to the
 * root, the whole branch below it, and the chain of other connections
 * (relations, references, free links) followed from it, link after link
 * (b → c, c → a, c → d: clicking b lights all three).
 */
export interface Chain {
  nodes: Set<string>;
  edges: Set<string>;
}

export function chainOf(
  start: string,
  parentOf: (id: string) => string | null | undefined,
  edges: { id: string; source: string; target: string }[],
  isHierarchy: (e: { id: string; source: string; target: string }) => boolean,
): Chain {
  const nodes = new Set([start]);
  const lit = new Set<string>();
  const tree = new Map<string, string>(); // "parent|child" → edge id
  const children = new Map<string, string[]>();
  const links = new Map<string, { id: string; other: string }[]>();
  for (const e of edges) {
    if (isHierarchy(e)) {
      tree.set(`${e.source}|${e.target}`, e.id);
      children.set(e.source, [...(children.get(e.source) ?? []), e.target]);
    } else {
      links.set(e.source, [...(links.get(e.source) ?? []), { id: e.id, other: e.target }]);
      links.set(e.target, [...(links.get(e.target) ?? []), { id: e.id, other: e.source }]);
    }
  }
  const treeEdge = (parent: string, child: string) => {
    const id = tree.get(`${parent}|${child}`);
    if (id) lit.add(id);
  };

  // Up to the root.
  const seenUp = new Set([start]);
  for (let cur = start, p = parentOf(cur); p && !seenUp.has(p); cur = p, p = parentOf(cur)) {
    seenUp.add(p);
    nodes.add(p);
    treeEdge(p, cur);
  }
  // The whole branch below.
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of children.get(cur) ?? []) {
      treeEdge(cur, c);
      if (nodes.has(c)) continue;
      nodes.add(c);
      stack.push(c);
    }
  }
  // Other connections, followed in a chain.
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const l of links.get(cur) ?? []) {
      lit.add(l.id);
      nodes.add(l.other);
      if (seen.has(l.other)) continue;
      seen.add(l.other);
      queue.push(l.other);
    }
  }
  return { nodes, edges: lit };
}

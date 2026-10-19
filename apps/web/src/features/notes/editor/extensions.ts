import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { INTERNAL_LINK_PREFIX, isAllowedHref } from '@mynotes/shared';
import { PropertiesNode } from './properties-node';
import { ReferenceNode } from './reference-node';
import { Triggers } from './triggers';

/** Editor schema. Must only produce nodes the API accepts (see shared/text.ts). */
export function noteExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['mynotes'],
        isAllowedUri: (url) => isAllowedHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    // "/" references (stored by id) and "#" tags.
    ReferenceNode,
    Triggers,
    // Key/value properties at the top of a note.
    PropertiesNode,
  ];
}

export const isInternalHref = (href: string | null | undefined) => !!href && href.startsWith(INTERNAL_LINK_PREFIX);

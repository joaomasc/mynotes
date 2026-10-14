import { FileText, Image, BookOpen, File } from 'lucide-react';

export function DocIcon({ mime, className = 'size-5' }: { mime: string; className?: string }) {
  if (mime === 'application/pdf') return <FileText className={`${className} text-document`} aria-hidden />;
  if (mime.startsWith('image/')) return <Image className={`${className} text-note`} aria-hidden />;
  if (mime === 'application/epub+zip') return <BookOpen className={`${className} text-reading`} aria-hidden />;
  return <File className={`${className} text-muted`} aria-hidden />;
}

export function docTypeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return 'Imagem';
  if (mime === 'application/epub+zip') return 'EPUB';
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime === 'text/markdown') return 'Markdown';
  if (mime === 'text/plain') return 'Texto';
  return 'Arquivo';
}

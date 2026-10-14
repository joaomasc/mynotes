import type { Page } from '@playwright/test';

export const USER = { username: 'e2e', password: 'senha-e2e-segura-123' };
export const API = 'http://127.0.0.1:8788/api/v1';

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(USER.username);
  await page.getByLabel('Senha').fill(USER.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });
}

export async function newNote(page: Page, title: string, body: string): Promise<string> {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Nova nota' }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/);
  const id = page.url().split('/notes/')[1]!;
  await page.getByLabel('Título da nota').fill(title);
  await page.keyboard.press('Enter');
  await page.keyboard.type(body);
  await waitForNoteSave(page, id, body);
  return id;
}

/** Waits until the server confirmed a save containing `text`. */
export async function waitForNoteSave(page: Page, id: string, text: string): Promise<void> {
  await page.waitForResponse(
    (r) => r.url().endsWith(`/notes/${id}`) && r.request().method() === 'PATCH' && r.ok() && (r.request().postData() ?? '').includes(text),
    { timeout: 30_000 },
  );
}

/** Minimal valid multi-page PDF with real text. */
export function samplePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add('PAGES');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const content = ['BT', '/F1 18 Tf', '72 720 Td', ...lines.flatMap((l, i) => (i ? ['0 -26 Td', `(${l}) Tj`] : [`(${l}) Tj`])), 'ET'].join('\n');
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${objs.length} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

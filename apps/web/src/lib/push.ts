import { endpoints } from './api/endpoints';
import { fromBase64Url } from './encoding';

/**
 * Web Push in the browser: asks permission, subscribes this browser with the
 * server's public key and registers the subscription. Needs the installed or
 * published app (the service worker only runs in the production build).
 */

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('O app ainda não está pronto para notificações. Abra a versão publicada (ou instalada) e tente de novo.')), 6000),
  );
  return Promise.race([ready, timeout]);
}

export async function enablePush(publicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error('Este navegador não aceita notificações. No iPhone, instale o app na tela inicial primeiro.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permita as notificações para este site (no ícone ao lado do endereço) e tente de novo.');
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('O navegador não devolveu uma inscrição válida.');
  await endpoints.speech.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await registration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await endpoints.speech.unsubscribePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

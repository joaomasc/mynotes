import { toast } from 'sonner';

/**
 * Registers the service worker (production only). New versions are applied
 * only when the user accepts, so an open editor is never reloaded under them.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast('Nova versão disponível', {
          description: 'Atualize quando terminar o que está fazendo.',
          duration: Infinity,
          action: { label: 'Atualizar', onClick: () => void update(true) },
        });
      },
      onOfflineReady() {
        toast.success('MyNotes pronto para uso offline');
      },
    });
  });
}

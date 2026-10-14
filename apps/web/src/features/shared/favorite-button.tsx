import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import type { FavoriteEntityType } from '@mynotes/shared';
import { IconButton } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { qk } from '@/lib/query';

export function useFavorites() {
  return useQuery({ queryKey: qk.favorites, queryFn: endpoints.favorites.list });
}

export function FavoriteButton({ type, id }: { type: FavoriteEntityType; id: string }) {
  const qc = useQueryClient();
  const { data } = useFavorites();
  const active = !!data?.some((f) => f.entityType === type && f.entityId === id);
  const mutation = useMutation({
    mutationFn: async () => {
      if (active) await endpoints.favorites.remove(type, id);
      else await endpoints.favorites.add(type, id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.favorites });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <IconButton
      label={active ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      aria-pressed={active}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <Star className={cn('size-4', active && 'fill-warning text-warning')} />
    </IconButton>
  );
}

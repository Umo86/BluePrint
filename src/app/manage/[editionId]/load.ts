import 'server-only';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { getEditionForStaff } from '@/server/services/editions';
import { AppError } from '@/server/errors';
import type { EditionPermission } from '@/server/db/schema';

/**
 * Loads the edition for a show dashboard page and checks the page's permission.
 * People without it get "not found", exactly like people with no access at all.
 */
export async function loadEdition(editionId: string, need: EditionPermission | 'show_admin' | 'settings' | 'space_only' = 'view') {
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) notFound();
  const actor = await requireActor();
  let loaded: Awaited<ReturnType<typeof getEditionForStaff>>;
  try {
    loaded = await getEditionForStaff(actor, editionId);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const { access } = loaded;
  const isAdmin = access.role === 'super_admin' || access.role === 'show_admin';
  if (need === 'show_admin') {
    if (!isAdmin) notFound();
  } else if (need === 'space_only') {
    if (!access.permissions.has('review_space_only') && !access.permissions.has('manage_exhibitors')) notFound();
  } else if (need === 'settings') {
    if (!isAdmin && !access.permissions.has('edit_content') && !access.permissions.has('manage_exhibitors')) notFound();
  } else if (!access.permissions.has(need)) {
    notFound();
  }
  return { actor, ...loaded, isAdmin };
}

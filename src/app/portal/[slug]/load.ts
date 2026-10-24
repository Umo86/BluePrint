import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/auth/current';
import { resolvePortal } from '@/server/services/portal';
import { AppError } from '@/server/errors';

export const standCookie = (editionId: string) => `bp_stand_${editionId.replace(/-/g, '')}`;

/** The portal context for this request: who is looking, which stand, and whether changes are allowed. */
export const loadPortal = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const actor = await requireActor();
  const store = await cookies();
  try {
    // The stand cookie is only a preference; resolvePortal checks the person can act for it.
    const first = await resolvePortal(actor, slug);
    const chosen = store.get(standCookie(first.edition.id))?.value;
    const ctx = chosen && chosen !== first.stand.id ? await resolvePortal(actor, slug, chosen) : first;
    return { actor, ...ctx };
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
});

import { Alert, Stack } from '@mantine/core';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink, TextLink } from '@/components/links';
import { basketForStand } from '@/server/services/shop';
import { loadPortal } from '../../load';
import { BasketClient } from './basket-client';
import { CloseCancelledCheckout } from './close-cancelled-checkout';

export default async function BasketPage({ params, searchParams }: PageProps<'/portal/[slug]/shop/basket'>) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadPortal(slug);
  const card = await basketForStand(ctx.actor, ctx.stand.id, 'card');
  const invoice = card.methods.invoice ? await basketForStand(ctx.actor, ctx.stand.id, 'invoice') : null;
  const base = `/portal/${ctx.edition.slug}`;
  return (
    <Stack>
      <TextLink href={`${base}/shop`} fz="sm">
        ← Keep shopping
      </TextLink>
      <PageHeader title="Your basket" description={`Stand ${ctx.stand.number}. Everyone in your company working on this stand shares this basket.`} />
      {sp.checkout === 'cancelled' ? <Alert color="yellow">Payment cancelled. Nothing was charged and your basket is as you left it.</Alert> : null}
      {sp.checkout === 'cancelled' && typeof sp.order === 'string' && /^[0-9a-f-]{36}$/i.test(sp.order) ? <CloseCancelledCheckout slug={ctx.edition.slug} orderId={sp.order} /> : null}
      {ctx.closedReason ? <Alert color="gray">{ctx.closedReason}</Alert> : null}
      {card.items.length ? (
        <BasketClient
          slug={ctx.edition.slug}
          standId={ctx.stand.id}
          items={card.items}
          card={card.methods.card ? card.totals : null}
          invoice={invoice ? invoice.totals : null}
          canPay={card.canPay}
          editable={ctx.editable}
          terms={card.terms}
          feeMode={card.feeMode}
          practice={card.practice}
        />
      ) : (
        <EmptyState
          title="Your basket is empty"
          description="Add furniture, electrics and other services from the shop."
          action={
            <ButtonLink href={`${base}/shop`} mt="xs">
              Go to the shop
            </ButtonLink>
          }
        />
      )}
    </Stack>
  );
}

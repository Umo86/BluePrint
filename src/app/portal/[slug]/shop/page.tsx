import { Alert, Stack } from '@mantine/core';
import { IconShoppingCart } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/links';
import { shopForStand } from '@/server/services/shop';
import { loadPortal } from '../load';
import { ShopBrowser } from './shop-browser';

export default async function ShopPage({ params }: PageProps<'/portal/[slug]/shop'>) {
  const { slug } = await params;
  const ctx = await loadPortal(slug);
  const shop = await shopForStand(ctx.actor, ctx.stand.id);
  const base = `/portal/${ctx.edition.slug}`;
  const tz = ctx.edition.timezone;
  return (
    <Stack>
      <PageHeader
        title="Order services"
        description={`Furniture, electrics, cleaning and more for stand ${ctx.stand.number}. Prices are shown before VAT; VAT is added at checkout.`}
        actions={
          <ButtonLink href={`${base}/shop/basket`} leftSection={<IconShoppingCart size={16} />} variant={shop.basketCount ? 'filled' : 'default'}>
            Basket{shop.basketCount ? ` (${shop.basketCount})` : ''}
          </ButtonLink>
        }
      />
      {ctx.closedReason ? <Alert color="gray">{ctx.closedReason}</Alert> : null}
      {shop.categories.length ? (
        <ShopBrowser slug={ctx.edition.slug} standId={ctx.stand.id} editable={ctx.editable} tz={tz} categories={shop.categories} />
      ) : (
        <EmptyState title="Nothing to order yet" description="The show team has not added any services for your stand type yet. Check back soon." />
      )}
    </Stack>
  );
}

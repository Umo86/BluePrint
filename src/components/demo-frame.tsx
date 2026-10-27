import { Alert } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';
import { storageMode } from '@/server/env';
import { isDemoEdition, isDemoSupplier } from '@/server/demo/flags';
import { UploadsOn } from './uploads-context';

/**
 * Around the pages of a demo show (or a demo supplier): says that everything here is invented, and
 * switches uploads on while file storage is not connected (demo files are kept in the database).
 */
export async function DemoFrame({ editionId, supplierId, children }: { editionId?: string; supplierId?: string; children: React.ReactNode }) {
  const demo = editionId ? await isDemoEdition(editionId) : supplierId ? await isDemoSupplier(supplierId) : false;
  if (!demo) return children;
  const content = (
    <>
      <Alert color="grape" variant="light" icon={<IconFlask size={18} />} mb="md" role="note" title={editionId ? 'Demo show' : 'Demo supplier'}>
        Everything here is invented for trying BluePrint out, and it all goes when the super admin removes the demo data. Card payments and payouts are practice ones: no money moves.
      </Alert>
      {children}
    </>
  );
  return storageMode() === 'off' ? <UploadsOn>{content}</UploadsOn> : content;
}

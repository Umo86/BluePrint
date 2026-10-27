'use client';

import { createContext, useContext } from 'react';

/** Whether file uploads work on this site: they are switched off on a live site without file storage. */
export const UploadsOnContext = createContext(true);

export function useUploadsOn() {
  return useContext(UploadsOnContext);
}

/** True inside a demo show while file storage is not connected: uploads are kept in the database, so they are smaller. */
export const PracticeUploadsContext = createContext(false);

export function usePracticeUploads() {
  return useContext(PracticeUploadsContext);
}

/** Switches uploads on for one part of the site: the demo shows keep their files in the database until file storage is connected. */
export function UploadsOn({ children }: { children: React.ReactNode }) {
  return (
    <UploadsOnContext value={true}>
      <PracticeUploadsContext value={true}>{children}</PracticeUploadsContext>
    </UploadsOnContext>
  );
}

'use client';

import { createContext, useContext } from 'react';

/** Whether file uploads work on this site: they are switched off on a live site without file storage. */
export const UploadsOnContext = createContext(true);

export function useUploadsOn() {
  return useContext(UploadsOnContext);
}

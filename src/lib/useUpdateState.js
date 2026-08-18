import { useSyncExternalStore } from 'react';
import { getUpdateState, subscribeToUpdates } from './appUpdates.js';

/** Subscribes a component to the service worker update state. */
export function useUpdateState() {
  return useSyncExternalStore(subscribeToUpdates, getUpdateState, getUpdateState);
}

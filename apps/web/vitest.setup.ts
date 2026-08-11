import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount anything rendered between tests so portals/localStorage don't leak.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

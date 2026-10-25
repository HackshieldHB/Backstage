'use client';

import { createContext, useContext } from 'react';

/**
 * Lets whoever hosts a view put a tab strip into the PaneShell that view
 * renders, so hub views (My day, Reports, Automations, Atlassian, Inbox) get
 * their tabs right under the header without each pane knowing about hubs.
 */
const PaneTabsContext = createContext<React.ReactNode>(null);

export function PaneTabsProvider({
  tabs,
  children,
}: {
  tabs: React.ReactNode;
  children: React.ReactNode;
}) {
  return <PaneTabsContext.Provider value={tabs}>{children}</PaneTabsContext.Provider>;
}

export function usePaneTabs() {
  return useContext(PaneTabsContext);
}

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiroExperience } from './experiences/miro';
import { LaunchDarklyExperience } from './experiences/launchdarkly';
import { AtlassianExperience } from './experiences/atlassian';
import { DatadogExperience } from './experiences/datadog';
import { SalesforceExperience } from './experiences/salesforce';
import { ApplicationCard } from './application-card';
import { MOCK_APPLICATIONS, MOCK_ATLASSIAN, MOCK_DATADOG, MOCK_LAUNCHDARKLY, MOCK_MIRO, MOCK_SALESFORCE } from './data';

describe('domain experiences render domain-specific content', () => {
  it('Miro emphasises collaboration (workspaces, boards, people)', () => {
    render(<MiroExperience data={MOCK_MIRO} variant="detail" activeTab="overview" />);
    expect(screen.getByText('Workspaces')).toBeTruthy();
    expect(screen.getByText('Product Discovery')).toBeTruthy();
    expect(screen.getByText('Active users')).toBeTruthy();
  });

  it('LaunchDarkly emphasises flags & environments', () => {
    render(<LaunchDarklyExperience data={MOCK_LAUNCHDARKLY} variant="detail" activeTab="overview" />);
    expect(screen.getByText('checkout-v2')).toBeTruthy();
    expect(screen.getByText('Environments')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('Atlassian emphasises its product suite', () => {
    render(<AtlassianExperience data={MOCK_ATLASSIAN} variant="detail" activeTab="overview" />);
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('Jira')).toBeTruthy();
    expect(screen.getByText('Confluence')).toBeTruthy();
  });

  it('Datadog emphasises observability (service health, incidents)', () => {
    render(<DatadogExperience data={MOCK_DATADOG} variant="detail" activeTab="overview" />);
    expect(screen.getByText('Service health')).toBeTruthy();
    expect(screen.getByText('Payment Service')).toBeTruthy();
    expect(screen.getByText('Recent incidents')).toBeTruthy();
  });

  it('Salesforce emphasises CRM/platform (API usage, integrations)', () => {
    render(<SalesforceExperience data={MOCK_SALESFORCE} variant="detail" activeTab="overview" />);
    expect(screen.getByText('Integration health')).toBeTruthy();
    expect(screen.getByText('SAP Integration')).toBeTruthy();
    expect(screen.getByText('Daily API usage')).toBeTruthy();
  });
});

describe('ApplicationCard', () => {
  const app = MOCK_APPLICATIONS.find((a) => a.id === 'atlassian')!;

  it('shows identity + app-specific metrics and previews on click', () => {
    const onView = vi.fn();
    render(<ApplicationCard app={app} onView={onView} />);
    expect(screen.getByText('Atlassian')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy(); // Projects metric value
    fireEvent.click(screen.getByTestId('app-card-atlassian'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('offers a direct external Open link that bypasses the preview', () => {
    const onView = vi.fn();
    render(<ApplicationCard app={app} onView={onView} />);
    const open = screen.getByTestId('app-open-atlassian') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe(app.url);
    expect(open.getAttribute('target')).toBe('_blank');
    fireEvent.click(open);
    expect(onView).not.toHaveBeenCalled(); // Open must not trigger the preview
  });
});

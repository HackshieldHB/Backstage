import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

/**
 * Screenshot tour of the main surfaces, for before/after visual review of UI
 * changes. Not an assertion suite: run with E2E_VISUAL=1 (and VISUAL_DIR to
 * choose where the PNGs go).
 */
test.skip(!process.env.E2E_VISUAL, 'set E2E_VISUAL=1 to take the screenshot tour');
test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});
test.setTimeout(180_000);

const run = Date.now().toString(36);
const dir = process.env.VISUAL_DIR ?? 'test-results/visual';
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(dir, `${name}.png`) });
const seenTour = () => window.localStorage.setItem('bs.tour.sidebar.v1', '1');

async function send(page: Page, text: string) {
  const composer = page.getByTestId('composer').first();
  await composer.click();
  await composer.pressSequentially(text);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('message-list').getByText(text.split('\n')[0]).first()).toBeVisible();
}

test('visual tour', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();

  await page.goto('/login');
  await shot(page, '00-login');
  await ctx.addInitScript(seenTour);
  await page.goto('/signup');
  await shot(page, '01-signup');
  await page.getByTestId('signup-name').fill('Ava Stone');
  await page.getByTestId('signup-email').fill(`visual-ava-${run}@example.com`);
  await page.getByTestId('signup-password').fill('password123!');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/welcome/);
  await shot(page, '02-welcome');
  await page.getByTestId('workspace-name').fill('Northwind Studio');
  await page.getByTestId('workspace-create').click();
  await expect(page.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });

  // A second person, so the channel has a conversation.
  const ctxB = await browser.newContext();
  await ctxB.addInitScript(seenTour);
  const pageB = await ctxB.newPage();
  await page.getByTestId('invite-button').click();
  await page.getByTestId('create-invite-link').click();
  const inviteUrl = (await page.getByTestId('invite-url').innerText()).trim();
  await shot(page, '10-invite-dialog');
  await page.keyboard.press('Escape');
  await pageB.goto('/signup');
  await pageB.getByTestId('signup-name').fill('Ben Okafor');
  await pageB.getByTestId('signup-email').fill(`visual-ben-${run}@example.com`);
  await pageB.getByTestId('signup-password').fill('password123!');
  await pageB.getByRole('button', { name: /create account/i }).click();
  await pageB.waitForURL(/\/welcome/);
  await pageB.goto(`/invite/${inviteUrl.split('/invite/')[1]}`);
  await expect(pageB.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });

  await send(page, 'Morning! Shipping the onboarding revamp today 🚀');
  await send(pageB, 'Nice — I pushed the API changes last night, CI is green.');
  await send(page, 'Can you review the release notes before 3pm?');
  await send(pageB, 'On it. Also: the huddle at 2 is moved to 2:30.');
  await page.waitForTimeout(500);
  await shot(page, '20-chat');

  // Hover toolbar on a message, then its thread.
  const msg = page.getByTestId('message-item').filter({ hasText: 'release notes' });
  await msg.hover();
  await shot(page, '21-message-hover');
  await msg.getByTestId('reply-in-thread').click();
  await page.waitForTimeout(400);
  await send(pageB, 'Ping');
  await shot(page, '22-thread');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await shot(page, '30-command-palette');
  await page.keyboard.press('Escape');

  await page.getByTestId('search-trigger').click();
  await page.waitForTimeout(300);
  await shot(page, '31-search');
  await page.keyboard.press('Escape');

  await page.getByTestId('workspace-menu').click();
  await page.waitForTimeout(200);
  await shot(page, '32-workspace-menu');
  await page.keyboard.press('Escape');

  for (const [btn, name] of [
    ['inbox-button', '40-inbox'],
    ['my-day-button', '41-my-day'],
    ['calendar-button', '42-calendar'],
    ['tasks-button', '43-tasks'],
  ] as const) {
    const b = page.getByTestId(btn).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      await page.waitForTimeout(600);
      await shot(page, name);
    }
  }
  await page.getByTestId('channel-general').first().click();

  const integrations = page.getByTestId('integrations-button').first();
  if (await integrations.isVisible().catch(() => false)) {
    await integrations.click();
    await page.waitForTimeout(400);
    await shot(page, '50-integrations');
    await page.keyboard.press('Escape');
  }

  // Huddle with fake camera.
  await page.getByTestId('start-huddle').click();
  await expect(page.getByTestId('meeting-room')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, '60-meeting');
  await page.getByTestId('ctrl-leave').click();

  // Dark theme.
  const theme = page.getByTestId('theme-toggle').first();
  if (await theme.isVisible().catch(() => false)) {
    await theme.click();
    await page.waitForTimeout(200);
    await shot(page, '70-theme-picker');
    const obsidian = page.getByTestId('accent-obsidian');
    if (await obsidian.isVisible().catch(() => false)) await obsidian.click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shot(page, '71-chat-dark');
    const daylight = page.getByTestId('accent-daylight');
    await theme.click();
    if (await daylight.isVisible().catch(() => false)) await daylight.click();
    await page.keyboard.press('Escape');
  }

  // Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot(page, '80-mobile');

  await ctxB.close();
  await ctx.close();
});

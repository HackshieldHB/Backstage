import { test, expect, type Page } from '@playwright/test';

const run = Date.now().toString(36);

async function signup(page: Page, name: string) {
  const email = `e2e-${name}-${run}@example.com`;
  await page.goto('/signup');
  await page.getByTestId('signup-name').fill(`${name} E2E`);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill('password123!');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/app/);
  return email;
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByTestId('composer').first();
  await composer.click();
  await composer.pressSequentially(text);
  await page.keyboard.press('Enter');
}

test('login → send message → see it render, plus two-browser realtime delivery', async ({
  browser,
}) => {
  // --- User A signs up and creates a workspace ---
  const contextA = await browser.newContext({ permissions: [] });
  const pageA = await contextA.newPage();
  await signup(pageA, 'alice');

  await pageA.getByTestId('workspace-name').fill('E2E Workspace');
  await pageA.getByTestId('workspace-create').click();

  // Lands in #general.
  await expect(pageA.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });

  // --- A sends a message and sees it render ---
  await sendMessage(pageA, `hello world ${run}`);
  await expect(
    pageA.getByTestId('message-list').getByText(`hello world ${run}`),
  ).toBeVisible();

  // --- A creates a shareable invite link ---
  await pageA.getByTestId('invite-button').click();
  await pageA.getByTestId('create-invite-link').click();
  const inviteUrl = (await pageA.getByTestId('invite-url').innerText()).trim();
  expect(inviteUrl).toContain('/invite/');
  await pageA.keyboard.press('Escape');

  // --- User B signs up in a second browser and accepts the invite ---
  const contextB = await browser.newContext({ permissions: [] });
  const pageB = await contextB.newPage();
  await signup(pageB, 'bob');
  const token = inviteUrl.split('/invite/')[1];
  await pageB.goto(`/invite/${token}`);
  await pageB.waitForURL(/\/app\?ws=/, { timeout: 15000 });

  // B sees the channel history (A's message).
  await expect(pageB.getByTestId('channel-title')).toContainText('general', { timeout: 15000 });
  await expect(pageB.getByTestId('message-list').getByText(`hello world ${run}`)).toBeVisible();

  // --- Two-browser realtime: A sends, B receives WITHOUT reload ---
  await sendMessage(pageA, `realtime ping ${run}`);
  await expect(
    pageB.getByTestId('message-list').getByText(`realtime ping ${run}`),
  ).toBeVisible({ timeout: 10000 });

  // --- And the reverse direction ---
  await sendMessage(pageB, `realtime pong ${run}`);
  await expect(
    pageA.getByTestId('message-list').getByText(`realtime pong ${run}`),
  ).toBeVisible({ timeout: 10000 });

  // --- Edited flag renders ---
  const lastMessage = pageA.getByTestId('message-item').filter({ hasText: `realtime ping ${run}` });
  await lastMessage.hover();
  await pageA.getByTestId('edit-message').click();
  const editEditor = pageA.getByTestId('edit-editor');
  await editEditor.click();
  await pageA.keyboard.press('ControlOrMeta+a');
  await pageA.keyboard.press('Delete');
  await editEditor.pressSequentially(`edited ping ${run}`);
  await pageA.getByTestId('edit-save').click();
  await expect(pageB.getByTestId('message-list').getByText(`edited ping ${run}`)).toBeVisible({
    timeout: 10000,
  });
  await expect(pageB.getByTestId('message-list').getByText('(edited)')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

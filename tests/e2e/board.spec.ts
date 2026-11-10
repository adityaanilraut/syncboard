import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const other = process.env.BOARD_B ?? 'http://127.0.0.1:3001';
const room = () => '/room/' + randomUUID();
const marks = (page: Page) => page.getByTestId('shapes').locator(':scope > *');

async function live(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Live');
}

async function draw(page: Page, tool = 'Pen', x = 180) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const canvas = page.getByRole('img', { name: 'Whiteboard canvas' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing board');
  await page.mouse.move(box.x + x, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + 180, { steps: 5 });
  await page.mouse.up();
}

test('creates a shareable room from the welcome screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading')).toHaveText('A whiteboard you can share');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page).toHaveURL(/\/room\/[a-f0-9-]{36}$/);
  await expect(page.getByRole('status')).toHaveText('Live');
});

for (const [tool, element] of [['Pen', 'polyline'], ['Rectangle', 'rect'], ['Ellipse', 'ellipse']]) {
  test('renders and persists a ' + tool.toLowerCase() + ' stroke', async ({ page, context }) => {
    const path = room();
    const observer = await context.newPage();
    await Promise.all([live(page, path), live(observer, other + path)]);
    await draw(page, tool);
    await expect(marks(observer)).toHaveCount(1);
    await expect(marks(page).first()).toHaveJSProperty('tagName', element);
    await expect.poll(async () => {
      await page.reload();
      await expect(page.getByRole('status')).toHaveText('Live');
      return marks(page).count();
    }).toBe(1);
  });
}

test('fans out live edits between two backend instances', async ({ page, context }) => {
  const path = room();
  const second = await context.newPage();
  await Promise.all([live(page, path), live(second, other + path)]);
  await draw(page);
  await expect(marks(second)).toHaveCount(1);
  await draw(second, 'Ellipse', 300);
  await expect(marks(page)).toHaveCount(2);
});

test('keeps simultaneous edits from two clients', async ({ page, context }) => {
  const path = room();
  const second = await context.newPage();
  await Promise.all([live(page, path), live(second, other + path)]);
  await Promise.all([draw(page, 'Rectangle'), draw(second, 'Ellipse', 300)]);
  await expect(marks(page)).toHaveCount(2);
  await expect(marks(second)).toHaveCount(2);
  expect(await page.getByTestId('shapes').innerHTML()).toBe(await second.getByTestId('shapes').innerHTML());
});

test('isolates updates across room links', async ({ page, context }) => {
  const second = await context.newPage();
  await Promise.all([live(page, room()), live(second, other + room())]);
  await draw(page);
  await expect(marks(page)).toHaveCount(1);
  await draw(second, 'Ellipse');
  await expect(marks(second)).toHaveCount(1);
  await expect(marks(page)).toHaveCount(1);
});

test('queues a local edit while disconnected and merges remote changes on reconnect', async ({ browser, page }) => {
  const path = room();
  const remoteContext = await browser.newContext();
  const second = await remoteContext.newPage();
  try {
    let blocked = false;
    let disconnect = () => {};
    await page.routeWebSocket('**/ws/**', ws => {
      if (blocked) {
        ws.close();
        return;
      }
      const upstream = ws.connectToServer();
      disconnect = () => { upstream.close(); ws.close(); };
    });
    await Promise.all([live(page, path), live(second, other + path)]);
    blocked = true;
    disconnect();
    await expect(page.getByRole('status')).not.toHaveText('Live');
    await draw(page, 'Rectangle');
    await draw(second, 'Ellipse');
    blocked = false;
    await expect(page.getByRole('status')).toHaveText('Live');
    await expect(marks(page)).toHaveCount(2);
    await expect(marks(second)).toHaveCount(2);
  } finally {
    await remoteContext.close();
  }
});

test('shows cursors across instances', async ({ page, context }) => {
  const path = room();
  const second = await context.newPage();
  await Promise.all([live(page, path), live(second, other + path)]);
  const box = await page.getByRole('img').boundingBox();
  await page.mouse.move(box!.x + 200, box!.y + 100);
  await expect(second.locator('.board > g[transform]')).toHaveCount(1);
});

test('persists selected ink color on the other backend', async ({ page, context }) => {
  const path = room();
  const second = await context.newPage();
  await Promise.all([live(page, path), live(second, other + path)]);
  await page.getByRole('button', { name: 'Ink #cf5539' }).click();
  await draw(page);
  await expect(marks(second).first()).toHaveAttribute('stroke', '#cf5539');
});

test('rejects invalid room links', async ({ request }) => {
  expect((await request.get('/room/not-a-room')).status()).toBe(404);
});

test('copies the current room link to the clipboard', async ({ context, page }) => {
  const path = room();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await live(page, path);
  await page.getByRole('button', { name: 'Copy room link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test('removes the peer cursor when that client leaves', async ({ page, context }) => {
  const path = room();
  const second = await context.newPage();
  await Promise.all([live(page, path), live(second, other + path)]);
  const box = await second.getByRole('img').boundingBox();
  await second.mouse.move(box!.x + 200, box!.y + 100);
  await expect(page.locator('.board > g[transform]')).toHaveCount(1);
  await second.close();
  await expect(page.locator('.board > g[transform]')).toHaveCount(0);
});

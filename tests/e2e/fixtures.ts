import { test as base } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export { expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    try {
      await use(page);
    } finally {
      const directory = process.env.BROWSER_COVERAGE;
      if (directory && !page.isClosed()) {
        const coverage = await page.evaluate(() =>
          (globalThis as typeof globalThis & { __coverage__?: unknown }).__coverage__);
        if (coverage) {
          await writeFile(resolve(directory, 'browser-' + randomUUID() + '.json'), JSON.stringify(coverage));
        }
      }
    }
  },
});

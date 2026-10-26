const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

test('a failed episode lookup fills the queue on a lifecycle retry without a room event', async ({ page }) => {
  await helpers.login(page, helpers.HOST_USER);
  const episodeId = await page.evaluate(async () => {
    const api = window.ApiClient;
    const result = await api.getItems(api.getCurrentUserId(), {
      includeItemTypes: 'Episode', recursive: true, sortBy: 'SortName', sortOrder: 'Ascending'
    });
    const episode = result.Items.find(item => item.SeriesName?.startsWith('OWP') && item.IndexNumber === 1);
    if (!episode) throw new Error('The dev library needs an OWP test series');
    return episode.Id;
  });
  await helpers.startPlayback(page, episodeId);
  await helpers.waitForSettled(page);
  await page.evaluate(() => {
    window.__queueLookups = [];
    window.__originalGetJSON = window.ApiClient.getJSON;
    window.ApiClient.getJSON = function(url, ...args) {
      if (String(url).includes('/Shows/') && String(url).includes('/Episodes')) {
        window.__queueLookups.push(Date.now());
        if (window.__queueLookups.length === 1) return Promise.reject(new Error('simulated temporary outage'));
      }
      return window.__originalGetJSON.call(this, url, ...args);
    };
  });
  try {
    await helpers.createRoom(page);
    await expect.poll(() => page.evaluate(() => window.__queueLookups.length)).toBe(1);
    expect(await page.evaluate(() => window.OpenWatchParty.state.queueItems)).toHaveLength(0);
    await expect.poll(() => page.evaluate(() => window.OpenWatchParty.state.queueItems.length), { timeout: 12_000 }).toBeGreaterThan(1);
    const times = await page.evaluate(() => window.__queueLookups);
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(5000);
    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => window.__queueLookups.length)).toBe(2);
  } finally {
    await page.evaluate(() => { window.ApiClient.getJSON = window.__originalGetJSON; });
    await helpers.leaveIfInRoom(page);
  }
});

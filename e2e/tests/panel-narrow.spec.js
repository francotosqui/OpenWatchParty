const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

// A phone-sized window with the largest text: the lobby header keeps every
// button inside the window (the status shows only its dot).
test('the lobby header keeps its buttons in a narrow window with the largest text', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: 'es-AR' });
  const page = await context.newPage();
  try {
    await helpers.login(page, helpers.HOST_USER);
    await page.goto('/#/home');
    await helpers.waitForClient(page);
    await page.evaluate(() => {
      const owp = window.OpenWatchParty;
      Object.assign(owp.state, { appearanceTextSize: 18, appearancePreset: 'contrast', appearanceOpacity: 100 });
      owp.ui.applyAppearance();
    });
    await helpers.openPanelFromHeader(page);
    const header = page.locator('#owp-panel .owp-header');
    await expect(header).toHaveClass(/owp-header-compact/);
    const edges = await page.locator('#owp-panel .owp-header button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }));
    expect(edges.length).toBeGreaterThanOrEqual(2);
    for (const edge of edges) {
      expect(edge.left).toBeGreaterThanOrEqual(0);
      expect(edge.right).toBeLessThanOrEqual(375);
    }
    await expect(page.locator('#owp-ws-indicator')).toHaveAttribute('title', 'En línea');

    // With room again, the status shows its words.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(header).not.toHaveClass(/owp-header-compact/);
  } finally {
    await context.close();
  }
});

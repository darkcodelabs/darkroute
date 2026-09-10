import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('the homepage has readable content and a guide link before the app runs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ALPR');
  await expect(page.getByRole('link', { name: /ALPR camera guide/ })).toHaveAttribute('href', '/alpr/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://darkroute.ai/');
});

test('the guide works without JavaScript or external requests on a phone', async ({ page }) => {
  const requests: string[] = [];
  const failures: string[] = [];
  page.on('request', (request) => { requests.push(request.url()); });
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  const response = await page.goto('/alpr/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ALPR');
  await expect(page.locator('main')).toContainText('OpenStreetMap');
  await expect(page.locator('main')).toContainText('Flock');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://darkroute.ai/alpr/');
  expect(await page.locator('main').innerText()).toMatch(/incomplete|missing|outdated/i);
  expect(await page.locator('script').count()).toBe(0);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(failures).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: /privacy/i }).first().click();
  await expect(page.locator('#privacy')).toBeVisible();
});

test('robots and sitemap are real crawl resources, with reachable canonical pages', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  const text = await robots.text();
  expect(text).toContain('Sitemap: https://darkroute.ai/sitemap.xml');
  expect(text).not.toMatch(/<html|<!doctype/i);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toMatch(/xml/);
  const xml = await sitemap.text();
  expect(xml).not.toMatch(/<html|<!doctype/i);
  expect(xml).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locations).toEqual(['https://darkroute.ai/', 'https://darkroute.ai/alpr/']);
  for (const location of locations) {
    const page = await request.get(new URL(location ?? '').pathname);
    expect(page.status()).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
    expect(await page.text()).toContain(`rel="canonical" href="${location ?? ''}"`);
  }
});

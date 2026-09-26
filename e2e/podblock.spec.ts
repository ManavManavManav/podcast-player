import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The main journeys, against the fake providers: the fixture episode has
 * sponsor reads at 0:20–0:50 and 5:20–5:50. The tests share one database
 * and run in order.
 */
test.describe.configure({ mode: "serial" });

const OWNER = { name: "Owner", email: "owner@example.com", password: "correct horse battery" };
const FRIEND = { name: "Friend", email: "friend@example.com", password: "friend's password" };

async function signUp(browser: Browser, who: typeof OWNER): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/signup");
  await page.getByLabel("Name").fill(who.name);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  return page;
}

async function signIn(page: Page, who: typeof OWNER) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Podcasts,\s*minus the ads/ })).toBeVisible();
}

const playhead = (page: Page) => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime);

test("the owner signs up first and approves a friend", async ({ browser }) => {
  const owner = await signUp(browser, OWNER);
  await expect(owner.getByRole("heading", { name: /Podcasts,\s*minus the ads/ })).toBeVisible();

  const friend = await signUp(browser, FRIEND);
  await expect(friend.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();

  await owner.goto("/admin");
  await owner.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText("Active")).toBeVisible();

  await friend.getByRole("link", { name: "Check again" }).click();
  await expect(friend.getByRole("heading", { name: /Podcasts,\s*minus the ads/ })).toBeVisible();
});

test("ads are found ahead of the listener, skipped, and can be undone", async ({ page }) => {
  await signIn(page, FRIEND);
  await page.getByRole("searchbox", { name: "Search podcasts" }).first().fill("fixture");
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: /The Fixture Show/ }).click();
  await page.getByRole("button", { name: /^Play Episode one/ }).click();
  await expect.poll(() => playhead(page)).toBeGreaterThan(0);

  // Both windows get analyzed; the ad list shows what was found.
  await page.keyboard.press("t");
  await page.getByRole("tab", { name: /Ad breaks/ }).click();
  const panel = page.getByRole("region", { name: "Transcript and ads" });
  await expect(panel.getByText("0:20 – 0:50")).toBeVisible();
  await expect(panel.getByText("5:20 – 5:50")).toBeVisible();

  // Play into the first ad: it's skipped.
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => (audio.currentTime = 18));
  await expect(page.getByText(/Skipped a 30 sec ad/)).toBeVisible({ timeout: 10_000 });
  expect(await playhead(page)).toBeGreaterThanOrEqual(49.5);

  // Undo goes back to the ad, which then plays.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => playhead(page)).toBeLessThan(25);
  await page.waitForTimeout(2_000);
  const t = await playhead(page);
  expect(t).toBeGreaterThan(20.5);
  expect(t).toBeLessThan(30);
});

test("a signed-out visitor is sent to sign in, and back afterwards", async ({ page }) => {
  await page.goto("/podcast/1001");
  await expect(page).toHaveURL(/\/login\?next=%2Fpodcast%2F1001/);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "The Fixture Show" })).toBeVisible();
});

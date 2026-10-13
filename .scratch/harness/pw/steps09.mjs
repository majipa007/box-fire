// Spray the rifle: the gun kicks, the muzzle flashes, tracers climb.
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL('./gun09-idle.png', import.meta.url).pathname });
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.screenshot({ path: new URL('./gun09-spray.png', import.meta.url).pathname });
  await page.mouse.up();
};

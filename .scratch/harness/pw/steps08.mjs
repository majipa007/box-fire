// Fire the rifle: ammo drains, tracers draw, R reloads.
const ammo = (page) => page.textContent('#ammo');
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(300);
  console.log('start:', await ammo(page), await page.textContent('#hp'));
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.screenshot({ path: new URL('./firing08.png', import.meta.url).pathname });
  await page.waitForTimeout(450);
  await page.mouse.up();
  await page.waitForTimeout(100);
  console.log('after 0.6 s of fire:', await ammo(page));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  console.log('after R:', await ammo(page));
  await page.waitForTimeout(2600);
  console.log('after reload:', await ammo(page));
};

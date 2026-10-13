// Switch to the pistol, click twice, hold, switch back.
const ammo = (page) => page.textContent('#ammo');
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(300);
  console.log('start:', await ammo(page));
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(600);
  console.log('pistol drawn:', await ammo(page));
  await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up(); // held: one shot
  await page.waitForTimeout(200);
  console.log('after holding 0.5 s:', await ammo(page));
  await page.mouse.click(640, 360); await page.waitForTimeout(250);
  console.log('after one more click:', await ammo(page));
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  console.log('back to primary:', await ammo(page));
};

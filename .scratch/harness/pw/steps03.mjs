// Lock the pointer, run forward for a second, then jump and track peak height.
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(300);
  console.log('locked:', await page.evaluate(() => !!document.pointerLockElement));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  console.log('after run:', await page.textContent('#stats'));
  await page.keyboard.press('Space');
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(50);
    peak = Math.max(peak, Number((await page.textContent('#stats')).split('·')[3].split(',')[1]));
  }
  console.log('jump peak y seen:', peak);
};

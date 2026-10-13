// Hold W, then blur the window without a keyup: the player must stop.
const pos = async (page) => (await page.textContent('#stats')).split('·')[3].trim();
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  console.log('running:', await pos(page), '|', await page.textContent('#stats'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(700);
  const a = await pos(page);
  await page.waitForTimeout(600);
  const b = await pos(page);
  console.log('after blur:', a, '->', b, a === b ? 'STOPPED' : 'STILL MOVING');
};

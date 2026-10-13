// B opens the picker, 2 picks the shotgun, B closes it; 1/2 switch slots again.
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  console.log('picker open:', await page.isVisible('#picker'));
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(100);
  console.log('after 2: open', await page.isVisible('#picker'), '| chosen:', await page.getAttribute('#pick-shotgun', 'class'),
    '| saved:', await page.evaluate(() => JSON.parse(localStorage.getItem('boxfire.settings')).primary));
  console.log('ammo (still the rifle this life):', await page.textContent('#ammo'));
  await page.keyboard.press('KeyB');
  console.log('B again: open', await page.isVisible('#picker'));
  await page.keyboard.press('KeyB'); // close it
  console.log('closed:', !(await page.isVisible('#picker')));
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(600);
  console.log('2 with the picker closed draws the pistol:', await page.textContent('#ammo'));
};

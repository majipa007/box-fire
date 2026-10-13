// Rebind forward to ArrowUp, check it moves; swap; Esc cancels; Ctrl warns; persists.
const pos = async (page) => (await page.textContent('#stats')).split('·')[3].trim();
export default async (page) => {
  await page.click('#keys-panel summary');
  const forward = page.locator('#keys button').first();
  await forward.click();
  console.log('listening:', await forward.textContent());
  await page.keyboard.press('ArrowUp');
  console.log('forward is now:', await forward.textContent());
  // Swap: give "Move back" the key W? Bind back (2nd) to ArrowUp -> forward gets back's S.
  await page.locator('#keys button').nth(1).click();
  await page.keyboard.press('ArrowUp');
  console.log('after swap: forward', await forward.textContent(), '| back', await page.locator('#keys button').nth(1).textContent());
  // Esc cancels.
  await page.locator('#keys button').nth(2).click();
  await page.keyboard.press('Escape');
  console.log('after Esc: left is', await page.locator('#keys button').nth(2).textContent());
  // Ctrl warns.
  await page.locator('#keys button').nth(6).click();
  await page.keyboard.press('ControlLeft');
  console.log('crouch:', await page.locator('#keys button').nth(6).textContent(), '| warning:', await page.textContent('#keys-warning'));
  console.log('saved keys:', await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('boxfire.settings')).keys)));
  // Now play with S (forward after the swap) and see the player move.
  await page.click('#play');
  await page.waitForTimeout(300);
  const before = await pos(page);
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(600);
  console.log('S moves forward now:', before, '->', await pos(page));
};

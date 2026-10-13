// Timer and leader, Tab scoreboard, host End match from the menu.
export default async (page) => {
  await page.click('#play');
  await page.waitForTimeout(1200);
  console.log('match info:', JSON.stringify(await page.textContent('#matchinfo')));
  await page.keyboard.down('Tab');
  await page.waitForTimeout(200);
  console.log('Tab held -> scoreboard visible:', await page.isVisible('#scoreboard'), '| rows:', await page.locator('#sb-rows tr').count());
  await page.keyboard.up('Tab');
  await page.waitForTimeout(200);
  console.log('Tab released -> visible:', await page.isVisible('#scoreboard'));
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(300);
  console.log('menu open, End match shown to host:', await page.isVisible('#end-match'));
  await page.click('#end-match');
  await page.waitForTimeout(1500);
  console.log('after End match:', await page.isVisible('#scoreboard'), JSON.stringify(await page.textContent('#sb-title')), JSON.stringify(await page.textContent('#sb-sub')));
  await page.screenshot({ path: new URL('./scoreboard15.png', import.meta.url).pathname });
};

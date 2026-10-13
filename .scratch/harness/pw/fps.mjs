// Sample the debug stats line a few times after play starts.
export default async (page) => {
  await page.click('#play');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    console.log('stats:', (await page.textContent('#stats')).split('·').slice(0, 3).join('·'));
  }
};

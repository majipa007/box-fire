// Settings: shadows on/off, render scale, crosshair, low-end preset, persistence.
const canvasWidth = (page) => page.evaluate(() => document.getElementById('view').width);
export default async (page) => {
  await page.waitForTimeout(500);
  const full = await canvasWidth(page);
  await page.check('#set-shadows');
  await page.waitForTimeout(700);
  console.log('shadows on:', await page.textContent('#stats'));
  await page.fill('#set-xsize', '10');
  await page.dispatchEvent('#set-xsize', 'input');
  console.log('crosshair width:', await page.evaluate(() => getComputedStyle(document.getElementById('crosshair')).width));
  await page.click('#low-end');
  await page.waitForTimeout(700);
  console.log('low-end: canvas', full, '->', await canvasWidth(page), '| shadows box:', await page.isChecked('#set-shadows'), '|', await page.textContent('#stats'));
  console.log('saved:', await page.evaluate(() => localStorage.getItem('boxfire.settings')));
  await page.evaluate(() => { document.getElementById('menu').hidden = true; });
  await page.check('#set-shadows').catch(() => {});
};

// Audio starts on the click; running, shooting and pistol shots synthesise
// without errors. Counts AudioContext states created by the page.
export default async (page) => {
  await page.evaluate(() => {
    window.__ctxs = [];
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  });
  await page.click('#play');
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(500);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  console.log('audio contexts:', await page.evaluate(() => window.__ctxs.map((c) => c.state).join(',')));
};

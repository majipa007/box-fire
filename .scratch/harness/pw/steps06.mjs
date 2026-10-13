// Start with bots in the arena, let them move, report what's drawn.
export default async (page) => {
  await page.waitForTimeout(2500);
  console.log('stats:', await page.textContent('#stats'));
};

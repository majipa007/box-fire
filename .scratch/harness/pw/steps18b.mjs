export default async (page) => {
  await page.check('#set-shadows');
  await page.waitForTimeout(800);
};

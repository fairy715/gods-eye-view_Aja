// Load the map in the Mac's Chrome and report what a person would see:
// the page title, whether the globe drew, and any page errors.
//
//   node packaging/macos/smoke-browser.mjs <url> <screenshot.png>
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const [url, screenshot] = process.argv.slice(2);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) {
  console.log('Chrome is not installed here; skipping the browser check.');
  process.exit(0);
}
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${url}#v=2&lat=-27.4698&lon=153.0251&alt=1500`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const canvases = await page.$$eval('canvas', (nodes) => nodes.length);
  console.log(`title: ${await page.title()}`);
  console.log(`canvases: ${canvases}`);
  console.log(`page errors: ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`);
  await page.screenshot({ path: screenshot });
  if (!canvases || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

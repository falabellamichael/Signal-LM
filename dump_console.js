const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('file://' + path.resolve(__dirname, 'index.html'), { waitUntil: 'networkidle0' });
  
  console.log('Testing settings...');
  await page.click('a[href="#settings"]');
  await new Promise(r => setTimeout(r, 500));
  
  await page.type('#settings-base-url', 'http://test.com');
  await page.click('#test-conn-btn');
  await new Promise(r => setTimeout(r, 1000));
  
  await browser.close();
})();

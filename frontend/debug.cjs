const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:4173');
  await new Promise(r => setTimeout(r, 2000));
  
  // Click host button
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.btn-secondary');
    for (let b of btns) {
      if (b.innerText.includes('Host')) b.click();
    }
  });

  await new Promise(r => setTimeout(r, 2000));
  const content = await page.content();
  console.log('CONTENT:', content);
  
  await browser.close();
})();

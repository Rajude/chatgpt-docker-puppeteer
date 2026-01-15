const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,          // VISÍVEL
    userDataDir: './profile', // PERFIL LOCAL
    defaultViewport: null
  });

  const page = await browser.newPage();

  await page.goto('https://chat.openai.com', {
    waitUntil: 'networkidle2'
  });

  console.log('Faça login manualmente no ChatGPT.');
  console.log('Quando estiver logado, FECHE o navegador.');

})();

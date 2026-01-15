/* src/driver/modules/stabilizer.js (Audit Level 11 - Deep DOM Stability) */
const { log } = require('../../core/logger'); // AJUSTE DE CAMINHO

/**
 * Mede o atraso do Event Loop (Lagômetro).
 */
async function measureEventLoopLag(page) {
  try {
    return await page.evaluate(async () => {
      const start = performance.now();
      await new Promise(r => setTimeout(r, 0));
      const end = performance.now();
      return end - start;
    });
  } catch (e) { return 1000; }
}

/**
 * Diagnóstico rápido do estado atual.
 */
async function getPageLoadStatus(page) {
  try {
    return await page.evaluate(() => {
      // 1. Spinners
      const loaders = document.querySelectorAll('[role="progressbar"], .spinner, .loading, svg.animate-spin');
      const isVisible = (el) => {
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      };
      if (Array.from(loaders).some(isVisible)) return 'BUSY_SPINNER';

      // 2. Rede Recente
      const entries = performance.getEntriesByType('resource');
      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        if (performance.now() - last.responseEnd < 500) return 'BUSY_NETWORK';
      }
      return 'IDLE';
    });
  } catch (e) { return 'UNKNOWN'; }
}

/**
 * Aguarda estabilização total (Rede + Visual + DOM + CPU).
 */
async function waitForStability(page, timeoutMs = 30000) {
  const start = Date.now();
  
  try {
    // FASE 1: Rede (Puppeteer)
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // FASE 2: Visual (Spinners)
    await page.waitForFunction(() => {
      const loaders = document.querySelectorAll('[role="progressbar"], .spinner, svg.animate-spin');
      const visible = Array.from(loaders).filter(el => {
         const s = window.getComputedStyle(el);
         return s.display !== 'none' && s.visibility !== 'hidden';
      });
      return visible.length === 0;
    }, { timeout: timeoutMs, polling: 500 });

    // FASE 3: Estabilidade de Mutação (NOVO - Deep DOM)
    // Espera o HTML parar de mudar por 500ms
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        let lastMutation = Date.now();
        const observer = new MutationObserver(() => lastMutation = Date.now());
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        const check = setInterval(() => {
          if (Date.now() - lastMutation > 500) { // 500ms de silêncio no DOM
            clearInterval(check);
            observer.disconnect();
            resolve();
          }
        }, 100);
      });
    });

    // FASE 4: CPU (Event Loop)
    let lag = 999;
    const deadline = Date.now() + 10000;
    while (lag > 100 && Date.now() < deadline) {
      lag = await measureEventLoopLag(page);
      if (lag > 100) await new Promise(r => setTimeout(r, 500));
    }

    return true;

  } catch (e) {
    log('WARN', `Estabilização parcial (${Date.now() - start}ms).`);
    return false;
  }
}

module.exports = { waitForStability, measureEventLoopLag, getPageLoadStatus };
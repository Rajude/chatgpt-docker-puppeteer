/* ==========================================================================
   src/driver/modules/triage.js
   Audit Level: 32 — Universal Diagnostic Engine (NASA Standard)
   Responsabilidade: Diagnóstico diferencial de stalls e erros de interface.
   Sincronizado com: i18n.js e stabilizer.js (Audit 32).
========================================================================== */

const stabilizer = require('./stabilizer');
const i18n = require('../../core/i18n');

/**
 * Realiza uma autópsia na página para identificar a causa da interrupção.
 * @param {object} page - Instância do Puppeteer.
 * @param {string} langCode - Idioma detectado da página.
 * @returns {Promise<string>} Causa identificada.
 */
async function diagnoseStall(page, langCode = 'en') {
  // Recupera termos de erro do dicionário poliglota (Assíncrono)
  const errorTerms = await i18n.getTerms('error_indicators', langCode);
  const closeTerms = await i18n.getTerms('close_actions', langCode);

  // 1. DIAGNÓSTICO VISUAL E SEMÂNTICO (Executado no Browser)
  const pageState = await page.evaluate((errors, closers) => {
    const bodyText = document.body.innerText.toLowerCase();
    const html = document.body.innerHTML.toLowerCase();
    
    // A. BLOQUEIOS DE SEGURANÇA (Prioridade Máxima)
    if (document.querySelector('#challenge-running') || bodyText.includes('cloudflare')) {
        return 'CAPTCHA';
    }
    
    // B. BARREIRA DE LOGIN
    const passwordInput = document.querySelector('input[type="password"]');
    if (passwordInput && passwordInput.offsetParent !== null) {
        return 'LOGIN_REQUIRED';
    }
    
    // C. RATE LIMIT (Limite de Uso)
    // Padrões universais para "limit", "quota", "too many requests"
    const limitPatterns = ['limit', 'limite', 'quota', 'too many', 'muitas requisições', 'try again later'];
    if (limitPatterns.some(p => bodyText.includes(p))) {
        return 'LIMIT_REACHED';
    }

    // D. ERROS TEXTUAIS (Via i18n)
    if (errors.some(term => bodyText.includes(term.toLowerCase()))) {
        return 'GENERIC_ERROR_TEXT';
    }

    // E. ERROS VISUAIS (Análise de Cromatismo)
    // Busca por elementos de aviso (vermelho/laranja) que contenham texto
    const errorElements = Array.from(document.querySelectorAll('*')).filter(el => {
      if (el.children.length > 0 || el.innerText.length < 5) return false;
      const style = window.getComputedStyle(el);
      const color = style.color; 
      const bg = style.backgroundColor;
      
      // Heurística de cores de erro (NASA Standard RGB Check)
      const isErrorColor = (c) => {
          const m = c.match(/\d+/g);
          if (!m || m.length < 3) return false;
          const [r, g, b] = m.map(Number);
          // Detecta dominância de Vermelho (R > 150 e G,B baixos) ou Laranja (R alto, G médio)
          return (r > 150 && g < 100 && b < 100) || (r > 200 && g > 100 && g < 200 && b < 100);
      };
      
      return isErrorColor(color) || isErrorColor(bg);
    });

    if (errorElements.length > 0) return 'GENERIC_ERROR_VISUAL';

    // F. FIM ABRUPTO (Botão de "Tentar Novamente" apareceu sem o comando do robô)
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    const retryBtn = buttons.find(b => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
        return closers.some(c => txt.includes(c)) && b.offsetParent !== null;
    });
    
    const stopBtn = document.querySelector('[aria-label*="Stop"], [title*="Stop"]');
    if (retryBtn && !stopBtn) return 'FINISHED_ABRUPTLY';

    return null;
  }, errorTerms, closeTerms);

  if (pageState) return pageState;

  // 2. DIAGNÓSTICO DE INFRAESTRUTURA (Rede/Loading)
  const loadStatus = await stabilizer.getPageLoadStatus(page);
  if (loadStatus === 'BUSY_NETWORK') return 'THINKING'; // Rede ativa = IA trabalhando
  if (loadStatus === 'BUSY_SPINNER') return 'LOADING';  // Interface ocupada (spinner)

  // 3. DIAGNÓSTICO DE HARDWARE VIRTUAL (CPU/Event Loop)
  const lag = await stabilizer.measureEventLoopLag(page);
  if (lag > 1000) return 'BROWSER_FROZEN'; // Aba travada por inchaço de DOM ou falta de RAM

  return 'UNKNOWN';
}

module.exports = { diagnoseStall };
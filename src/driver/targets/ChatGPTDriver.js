/* ==========================================================================
   src/driver/targets/ChatGPTDriver.js
   Audit Level: 36 — ChatGPT Specialist (Diamond Standard)
   Responsabilidade: Percepção de resposta, gestão de modelo e diagnóstico OpenAI.
   Sincronizado com: BaseDriver.js (Audit 36) e triage.js (Audit 33).
========================================================================== */

const BaseDriver = require('../core/BaseDriver');
const triage = require('../modules/triage');
const adaptive = require('../../logic/adaptive');
const { log } = require('../../core/logger');

class ChatGPTDriver extends BaseDriver {
  constructor(page, config) {
    super(page, config);
    this.name = "ChatGPT";
    this.currentDomain = "chatgpt.com";
    this.continueCommand = "continue"; // Comando universal de extensão
  }

  /**
   * [VALIDAÇÃO] Confirma se a aba está no território da OpenAI.
   */
  async validatePage() {
    const url = this.page.url();
    return url.includes(this.currentDomain);
  }

  /**
   * [SNAPSHOT] Captura a contagem atual de mensagens do assistente.
   * Usado para saber onde a nova resposta começa.
   */
  async captureState() {
    try {
        // Seletor estável para balões de resposta do assistente
        return await this.page.$$eval('div[data-message-author-role="assistant"]', ns => ns.length);
    } catch (e) {
        return 0;
    }
  }

  /**
   * [PREPARAÇÃO] Configura o modelo e limpa o contexto se necessário.
   */
  async prepareContext(taskSpec) {
    this.setState('PREPARING');
    const modelId = taskSpec?.model || this.config.DEFAULT_MODEL_ID || 'gpt-5';
    const targetUrl = `https://chatgpt.com/?model=${modelId}`;
    
    const currentUrl = this.page.url();
    const isConversation = currentUrl.includes('/c/');
    const wrongModel = !currentUrl.includes(`model=${modelId}`);
    const forceReset = taskSpec?.config?.reset_context;

    // Se precisamos de um chat limpo ou modelo diferente
    if (forceReset || wrongModel || (isConversation && !taskSpec.config?.require_history)) {
        log('INFO', `[${this.name}] Navegando para New Chat (${modelId})...`);
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000)); // Estabilização pós-load
    }
    
    this.setState('IDLE');
  }

  /**
   * [PERCEPÇÃO] Aguarda a resposta completa com Triage de Nível 33.
   */
  async waitForCompletion(startSnapshot) {
    let lastText = '';
    let stableCycles = 0;
    const startMsgCount = startSnapshot || 0;
    
    this.setState('WAITING');

    // Injeção do Watchdog de Mutação (Se não existir na aba)
    await this.page.evaluate(() => {
      if (!window.__wd_obs) {
        window.__wd_last_change = Date.now();
        window.__wd_obs = new MutationObserver(() => window.__wd_last_change = Date.now());
        window.__wd_obs.observe(document.body, { child_list: true, subtree: true, characterData: true });
      }
    });

    while (true) {
      // 1. Detecção de Idioma e Diagnóstico de Erro (Triage)
      const lang = await this._detectLanguage();
      const status = await triage.diagnoseStall(this.page, lang);
      
      // 2. Tratamento de Bloqueios Críticos
      if (status === 'LIMIT_REACHED') throw new Error('LIMIT_REACHED');
      if (status === 'CAPTCHA') throw new Error('CAPTCHA_DETECTED');
      if (status === 'LOGIN_REQUIRED') throw new Error('LOGIN_REQUIRED');

      // 3. Extração Seletiva de Texto (Apenas a resposta nova)
      const msgs = await this.page.$$eval('div[data-message-author-role="assistant"]', ns => ns.map(n => n.innerText)).catch(() => []);
      const currentText = msgs.slice(startMsgCount).join('\n\n').trim();

      // 4. Verificação de Estabilidade (Crescimento do Texto)
      if (currentText && currentText === lastText && currentText.length > 0) {
        stableCycles++;
      } else {
        stableCycles = 0;
        lastText = currentText;
      }

      // Se o texto parou de mudar por X ciclos (definido no config)
      if (stableCycles >= this.config.STABLE_CYCLES) {
          this.setState('IDLE');
          return currentText;
      }

      // 5. Gestão de Stall Adaptativo
      const lastChange = await this.page.evaluate(() => window.__wd_last_change).catch(() => Date.now());
      const gap = Date.now() - lastChange;
      
      // O timeout escala com o tamanho da conversa (previne erro em chats longos)
      const dynamicTimeout = adaptive.getAdjustedTimeout(msgs.length);

      if (gap > dynamicTimeout) {
        // Se o modelo está "Pensando" (Thinking UI) ou a rede está ativa, resetamos o timer
        if (status.includes('THINKING') || status === 'LOADING') {
           await this.page.evaluate(() => window.__wd_last_change = Date.now());
           continue;
        }
        
        this.setState('STALLED');
        throw new Error(`STALL_DETECTED: ${status}`);
      }

      // Aguarda o intervalo de estabilidade antes da próxima checagem
      await new Promise(r => setTimeout(r, this.config.STABILITY_INTERVAL));
    }
  }
}

module.exports = ChatGPTDriver;
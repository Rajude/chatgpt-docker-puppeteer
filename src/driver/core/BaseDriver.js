/* ==========================================================================
   src/driver/core/BaseDriver.js
   Audit Level: 120 — Ultimate Diamond (Modular Context & JIT Geometry)
   Responsabilidade: Execução física universal. Delegação de percepção ao SADI.
                     Gestão de pilha de handles e foco de hardware garantido.
   Sincronizado com: analyzer.js (V11), human.js (V15), adaptive.js (V41).
========================================================================== */

const TargetDriver = require('./TargetDriver');
const stabilizer = require('../modules/stabilizer');
const analyzer = require('../modules/analyzer');
const human = require('../modules/human');
const i18n = require('../../core/i18n');
const io = require('../../infra/io');
const adaptive = require('../../logic/adaptive');
const { log } = require('../../core/logger');

class BaseDriver extends TargetDriver {
  constructor(page, config) {
    super(page, config);
    this.cachedInputProtocol = null;
    this.name = "BaseUniversalDriver";
    this.modifier = null; 
    this.lastKeepAlive = Date.now();
    this.currentDomain = this._updateDomain();
    this.activeHandles = []; 
  }

  /* ==========================================================================
     UTILITÁRIOS DE INFRAESTRUTURA (PRIVATE)
  ========================================================================== */

  _assertPageAlive() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('TARGET_CLOSED: A aba do navegador foi encerrada.');
    }
  }

  _registerHandle(handle) {
      if (handle) this.activeHandles.push(handle);
      return handle;
  }

  async _clearHandles() {
      for (const h of this.activeHandles) {
          try { await h.dispose(); } catch (e) {}
      }
      this.activeHandles = [];
  }

  async _getModifier() {
    if (this.modifier) return this.modifier;
    this._assertPageAlive();
    const platform = await this.page.evaluate(() => {
        return (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
    });
    this.modifier = platform.includes('mac') ? 'Meta' : 'Control';
    return this.modifier;
  }

  async _releaseModifiers() {
    try {
        const mod = await this._getModifier();
        await this.page.keyboard.up(mod);
        await this.page.keyboard.up('Shift');
    } catch (e) {}
  }

  _updateDomain() {
    try {
      const url = this.page.url();
      if (!url || url === 'about:blank' || !url.startsWith('http')) return "initialization";
      const domain = new URL(url).hostname.replace('www.', '');
      this.currentDomain = domain;
      return domain;
    } catch (e) { return "unknown_context"; }
  }

  /**
   * Resolve o contexto de execução delegando a busca ao Analyzer (Modularidade V120).
   */
  async _getExecutionContext(protocol) {
    if (!protocol || protocol.context === 'root') return { ctx: this.page, frameHandle: null };
    
    try {
        if (protocol.context === 'iframe' && protocol.frameSelector) {
            // Delegação ao SADI: O Driver não enxerga o DOM diretamente
            const frameHandle = await analyzer.findFrameHandle(this.page, protocol.frameSelector);
            
            if (frameHandle) {
                const frame = await frameHandle.asElement()?.contentFrame();
                if (frame) return { ctx: frame, frameHandle: this._registerHandle(frameHandle.asElement()) };
                await frameHandle.dispose();
            }
        }
    } catch (e) { log('WARN', `[DRIVER] Falha ao acoplar contexto: ${e.message}`); }
    return { ctx: this.page, frameHandle: null };
  }

  /**
   * Omni-Scroll V5: Estabilidade adaptativa e Safe-Zone.
   */
  async _omniScroll(ctx, frameHandle, selector) {
    const scrollFn = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      window.scrollBy(0, -(window.innerHeight * 0.15));
    };

    await ctx.evaluate(scrollFn, selector);
    if (frameHandle) {
        await frameHandle.scrollIntoView({ behavior: 'auto', block: 'center' });
        await this.page.evaluate(() => window.scrollBy(0, -(window.innerHeight * 0.15)));
    }
    
    // Espera estabilidade de scroll (Jitter check)
    await new Promise(r => setTimeout(r, 600));
  }

  async _waitIfBusy(taskId) {
    const adaptiveData = await adaptive.getAdjustedTimeout(this.currentDomain, 0, 'INITIAL');
    const timeout = adaptiveData.timeout;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      this._assertPageAlive();
      
      // Haptic Keep-Alive com Jitter (Protocolo 3)
      const jitter = Math.random() * 10000;
      if (Date.now() - this.lastKeepAlive > (25000 + jitter)) { 
          await human.wakeUpMove(this.page); 
          this.lastKeepAlive = Date.now(); 
      }

      const isBusy = await this.page.evaluate(() => {
          const stopBtn = document.querySelector('[aria-label*="Stop"], [class*="stop"], [class*="typing"]');
          const isAriaBusy = document.querySelector('[aria-busy="true"]');
          return !!(stopBtn || isAriaBusy);
      });

      if (!isBusy) {
          const status = await stabilizer.getPageLoadStatus(this.page);
          if (status === 'IDLE') return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  async _checkInteractivity(context, selector) {
      return await context.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return !el.disabled && !el.readOnly && style.pointerEvents !== 'none' && style.display !== 'none';
      }, selector);
  }

  async _clearInput(context, selector) {
    if (!(await this._checkInteractivity(context, selector))) return;
    const mod = await this._getModifier();
    try {
        await context.focus(selector);
        await this.page.keyboard.down(mod);
        await this.page.keyboard.press('a');
        await this.page.keyboard.up(mod);
        await this.page.keyboard.press('Backspace');

        await context.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return;
            if (el.isContentEditable) el.innerHTML = ''; else el.value = '';
            ['input', 'change'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
        }, selector);
    } finally { await this._releaseModifiers(); }
  }

  /* ==========================================================================
     API PÚBLICA
  ========================================================================== */

  async sendPrompt(text, taskId) {
    await this._waitIfBusy(taskId);
    await this._clearHandles(); // Limpeza preventiva

    let attempts = 0;
    while (attempts < 3) {
      try {
        this._assertPageAlive();
        await this.page.bringToFront(); // Garante foco da aba (Sincronia de Hardware)

        const proto = await this._resolveInput();
        const { ctx, frameHandle } = await this._getExecutionContext(proto);

        if (!(await this._checkInteractivity(ctx, proto.selector))) throw new Error('ELEMENT_NOT_INTERACTABLE');

        await this._omniScroll(ctx, frameHandle, proto.selector);
        
        // Wake-up Click Neutro (Canto do elemento)
        if (frameHandle) {
            const box = await frameHandle.boundingBox();
            if (box) await this.page.mouse.click(box.x + 1, box.y + 1);
        }

        await this._clearInput(ctx, proto.selector);

        const lag = await stabilizer.measureEventLoopLag(this.page);
        this.setState(TargetDriver.STATES.TYPING);

        // MODO ZEN V3 (Sequência Corrigida)
        if (lag > 250 || text.length > 2000) {
          log('WARN', `Modo Zen V3 (Lag: ${lag.toFixed(0)}ms).`, taskId);
          await ctx.evaluate((sel, content) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.focus();
            
            // Injeção Atômica
            const success = document.execCommand('insertText', false, content);
            if (!success) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set ||
                               Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText")?.set;
                setter?.call(el, content);
            }

            // Eventos de sincronia de framework
            el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: content }));
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, proto.selector, text);
        } else {
          let ox = 0, oy = 0;
          if (frameHandle) { const box = await frameHandle.boundingBox(); if (box) { ox = box.x; oy = box.y; } }
          await human.humanClick(this.page, proto.selector, ox, oy);
          await human.humanType(this.page, text);
          
          const eco = await ctx.evaluate((s) => (document.querySelector(s)?.value || document.querySelector(s)?.innerText || "").replace(/\s/g, '').length, proto.selector);
          if (eco < text.replace(/\s/g, '').length * 0.8) throw new Error('INPUT_ECHO_FAILED');
        }

        // Submissão Final
        await ctx.focus(proto.selector);
        await this.page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 1200));

        // Fallback de envio via SADI
        const isSent = await ctx.evaluate((s) => (document.querySelector(s)?.value || document.querySelector(s)?.innerText || "").trim().length === 0, proto.selector);
        if (!isSent) {
            const sendProto = await analyzer.findSendButtonSelector(this.page, proto);
            if (sendProto) {
                const { ctx: sCtx, frameHandle: sH } = await this._getExecutionContext(sendProto);
                let sx = 0, sy = 0;
                if (sH) { const b = await sH.boundingBox(); sx = b.x; sy = b.y; }
                await human.humanClick(this.page, sendProto.selector, sx, sy);
            }
        }

        this.setState(TargetDriver.STATES.IDLE);
        return;

      } catch (e) {
        log('WARN', `Falha iteração: ${e.message}.`);
        this.cachedInputProtocol = null;
        attempts++;
        await new Promise(r => setTimeout(r, 2000));
      } finally {
        await this._clearHandles();
        await this._releaseModifiers();
      }
    }
    throw new Error('EXECUTION_FAIL: Interface bloqueada.');
  }

  async destroy() {
      await this._clearHandles();
      await this._releaseModifiers();
      this.cachedInputProtocol = null;
      this.removeAllListeners();
  }
}

module.exports = BaseDriver;
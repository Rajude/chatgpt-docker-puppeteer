/* ==========================================================================
   src/driver/modules/analyzer.js
   Audit Level: 150 — SADI Fortress V15 (Resilient Lineage & Motion-Aware Sonar)
   Responsabilidade: Percepção universal com identificação de frames por linhagem 
                     resiliente (Path-Hashing V2) e Sonar com detecção de movimento.
   Sincronizado com: BaseDriver.js (V120), i18n.js (V32).
========================================================================== */

const i18n = require('../../core/i18n');

const SVG_SIGNATURES = [
  'M2.01 21L23 12 2.01 3', 
  'M22 2L11 13',           
  'M15.854 11.854',        
  'M21 2L3 10l8 3 3 8z'    
].map(sig => sig.replace(/[\s,]/g, '').slice(0, 20));

/**
 * SADI_LOGIC: Motor de percepção de ultra-fidelidade.
 */
const sadiLogic = (terms, svgSigs) => {
  const SADI = {
    // 1. Deep Query Engine V9 (Single-Pass TreeWalker)
    query: (selector, root = document, onlyFrames = false) => {
      const results = [];
      if (!root) return results;

      // Check root
      if (root.matches && root.matches(selector)) results.push(root);

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        
        if (node.matches(selector)) results.push(node);

        // Penetra em Shadow DOM
        if (node.shadowRoot) {
            results.push(...SADI.query(selector, node.shadowRoot, onlyFrames));
        }
        
        // Penetra em IFrames
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) {
                results.push(...SADI.query(selector, node.contentDocument, onlyFrames));
            }
          } catch (e) {}
        }
      }
      return [...new Set(results)];
    },

    // 2. Resilient Path-Hashing V2: Identidade por DNA, não por índice.
    getFrameIdentity: (el) => {
        if (!el) return 'root';
        const id = el.id ? `#${el.id}` : '';
        const name = el.name ? `[name="${el.name}"]` : '';
        const src = el.src ? `[src*="${new URL(el.src).pathname}"]` : '';
        // Se não tiver nada estável, usa o índice entre irmãos IFrames
        const index = Array.from(el.parentNode.querySelectorAll('iframe')).indexOf(el);
        return `${el.tagName}${id}${name}${src || ':idx(' + index + ')'}`;
    },

    getFramePath: (win = window) => {
        const path = [];
        let current = win;
        try {
            while (current !== window.top) {
                path.unshift(SADI.getFrameIdentity(current.frameElement));
                current = current.parent;
            }
        } catch (e) { path.push('cross-origin-barrier'); }
        return path.join(' > ');
    },

    // 3. Sonar V9: Motion-Aware & DPI Aware
    isOccluded: async (el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return true;
      
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return true;

      // Auto-scroll e espera por estabilidade de movimento
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ block: 'center' });
          await new Promise(r => setTimeout(r, 150)); // Espera inércia do scroll
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      
      // Check Global (Bridge) com normalização de Viewport
      if (window !== window.top) {
          try {
              const frameEl = window.frameElement;
              if (frameEl) {
                  const fRect = frameEl.getBoundingClientRect();
                  const topEl = window.parent.document.elementFromPoint(fRect.left + cx, fRect.top + cy);
                  if (topEl && !frameEl.contains(topEl)) return true;
              }
          } catch (e) {}
      }

      const topEl = document.elementFromPoint(cx, cy);
      return topEl && !el.contains(topEl) && !topEl.contains(el);
    },

    // 4. Protocolo de Objeto Estruturado V6
    generateProtocol: (el) => {
      const win = el.ownerDocument.defaultView;
      
      const getBaseSelector = (target) => {
        if (!target) return null;
        if (target.id && !/^\d+$/.test(target.id)) return `#${target.id}`;
        const attrs = ['data-testid', 'aria-label', 'title', 'name'];
        for (const a of attrs) {
          const v = target.getAttribute(a);
          if (v) return `[${a}="${v.replace(/"/g, '\\"')}"]`;
        }
        return target.tagName.toLowerCase();
      };

      return {
        selector: getBaseSelector(el),
        isShadow: el.getRootNode().nodeType === 11,
        context: (win !== window.top) ? 'iframe' : 'root',
        framePath: SADI.getFramePath(win),
        timestamp: Date.now()
      };
    }
  };
  return SADI;
};

/* ==========================================================================
   EXPORTS (API PÚBLICA)
========================================================================== */

/**
 * findFrameByPath: Localiza um frame seguindo a linhagem resiliente.
 */
async function findFrameByPath(page, framePath) {
    if (!framePath || framePath === 'root') return page;
    
    const parts = framePath.split(' > ');
    let currentFrame = page;

    for (const part of parts) {
        const frames = await currentFrame.frames();
        // Busca o frame que corresponde à identidade (tagName + attrs)
        const target = frames.find(f => {
            const url = f.url();
            return part.includes('IFRAME') && (part.includes(new URL(url).pathname) || part.includes(f.name()));
        });
        if (!target) return null;
        currentFrame = target;
    }
    return currentFrame;
}

async function findChatInputSelector(page, langCode = 'en') {
  const keywords = await i18n.getTerms('input_placeholders', langCode);
  return await page.evaluate(async (terms, svgSigs, logicFnStr) => {
    const SADI = (new Function(`return (${logicFnStr})`))()(terms, svgSigs);
    const candidates = SADI.query('textarea, div[contenteditable="true"], [role="textbox"]')
      .filter(el => !SADI.isOccluded(el));

    const scoreCandidate = (el) => {
      let score = 0;
      const rect = el.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.4) score += 100;
      const text = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      if (terms.some(k => text.includes(k))) score += 150;
      return score;
    };

    const best = candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
    return best ? { protocol: SADI.generateProtocol(best), confidence: scoreCandidate(best) } : null;
  }, keywords, SVG_SIGNATURES, sadiLogic.toString());
}

async function findSendButtonSelector(page, inputProtocol) {
    return await page.evaluate(async (proto, svgSigs, logicFnStr) => {
        const SADI = (new Function(`return (${logicFnStr})`))()([], svgSigs);
        const input = SADI.query(proto.selector)[0];
        if (!input) return null;

        const buttons = Array.from(input.getRootNode().querySelectorAll('button, [role="button"], svg'));
        const iRect = input.getBoundingClientRect();
        const scoreButton = (btn) => {
            let score = 0;
            const bRect = btn.getBoundingClientRect();
            if (bRect.left >= iRect.left && Math.abs(bRect.top - iRect.top) < 120) score += 80;
            const paths = Array.from(btn.querySelectorAll('path'));
            for (const p of paths) {
                const d = (p.getAttribute('d') || '').replace(/[\s,]/g, '');
                if (svgSigs.some(sig => d.startsWith(sig))) { score += 150; break; }
            }
            return score;
        };
        const best = buttons.sort((a, b) => scoreButton(b) - scoreButton(a))[0];
        return best ? SADI.generateProtocol(best) : null;
    }, inputProtocol, SVG_SIGNATURES, sadiLogic.toString());
}

async function findResponseArea(page) {
    return await page.evaluate(async (logicFnStr) => {
        const SADI = (new Function(`return (${logicFnStr})`))()([], []);
        const containers = SADI.query('div, article, section, pre').filter(c => c.innerText.length > 5);
        
        const snapshot = containers.map(c => ({ el: c, len: c.innerText.length }));
        await new Promise(r => setTimeout(r, 400));
        let best = null, maxDelta = 0;
        snapshot.forEach(snap => {
            const delta = snap.el.innerText.length - snap.len;
            if (delta > maxDelta) { maxDelta = delta; best = snap.el; }
        });
        const final = best || containers.sort((a,b) => b.innerText.length - a.innerText.length)[0];
        return final ? SADI.generateProtocol(final) : null;
    }, sadiLogic.toString());
}

async function validateCandidateInteractivity(page, protocol) {
    try {
        return await page.evaluate((proto, logicFnStr) => {
            const SADI = (new Function(`return (${logicFnStr})`))()([], []);
            const el = SADI.query(proto.selector)[0];
            if (!el) return false;
            el.focus();
            const active = (function getActive(r) {
                let a = r.activeElement;
                while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
                return a;
            })(document);
            return active === el || el.contains(active);
        }, protocol, sadiLogic.toString());
    } catch (e) { return false; }
}

module.exports = { 
    findChatInputSelector, 
    findSendButtonSelector, 
    findResponseArea, 
    validateCandidateInteractivity,
    findFrameByPath 
};
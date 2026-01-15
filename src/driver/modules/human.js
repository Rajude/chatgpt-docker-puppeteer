/* src/driver/modules/human.js (Audit Level 15 - Turing Complete) */
// Responsabilidade: Simular comportamento humano (Mouse e Teclado) com imperfeições realistas.

const { createCursor } = require('ghost-cursor');
const { log } = require('../../core/logger'); // AJUSTE DE CAMINHO

let cursorInstance = null;

// Mapa QWERTY Completo (Letras e Números) para simulação de erros de vizinhança
const KEY_NEIGHBORS = {
  'a': 'qsxz', 'b': 'vghn', 'c': 'xdfv', 'd': 'serfc', 'e': 'wsdr',
  'f': 'drtgv', 'g': 'ftyhb', 'h': 'gyujn', 'i': 'ujko', 'j': 'huikm',
  'k': 'jiol', 'l': 'kop', 'm': 'njk', 'n': 'bhjm', 'o': 'iklp',
  'p': 'ol', 'q': 'wa', 'r': 'edft', 's': 'awzx', 't': 'rfgy',
  'u': 'yhji', 'v': 'cfgb', 'w': 'qase', 'x': 'zsdc', 'y': 'tghu',
  'z': 'asx',
  '1': '2q', '2': '13qw', '3': '24we', '4': '35er', '5': '46rt',
  '6': '57ty', '7': '68yu', '8': '79ui', '9': '80io', '0': '9op'
};

function getCursor(page) {
  if (!cursorInstance || cursorInstance.page !== page) {
    cursorInstance = createCursor(page);
    cursorInstance.toggleRandomMove(true); 
  }
  return cursorInstance;
}

async function resetCursor(page) {
  try {
    const viewport = page.viewport();
    const x = (viewport?.width || 1024) / 2;
    const y = (viewport?.height || 768) / 2;
    await page.mouse.move(x, y);
  } catch (e) {}
}

async function wakeUpMove(page) {
  const cursor = getCursor(page);
  try { await cursor.move({ x: Math.random() * 500, y: Math.random() * 500 }); } catch (e) {}
}

async function humanClick(page, selector) {
  const cursor = getCursor(page);
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, selector);
    
    await new Promise(r => setTimeout(r, Math.random() * 300 + 200));
    await cursor.move(selector);
    await new Promise(r => setTimeout(r, Math.random() * 100 + 50));
    await cursor.click();
  } catch (e) {
    log('WARN', `Ghost click falhou, usando clique nativo.`);
    await page.click(selector).catch(() => {});
  }
}

async function humanType(page, text) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lowerChar = char.toLowerCase();
    
    // 1. Simulação de Erro de Caractere (Typos)
    // Só erra se não for o primeiro char e se a tecla tiver vizinhos conhecidos
    if (i > 0 && Math.random() < 0.02 && KEY_NEIGHBORS[lowerChar]) {
      const neighbors = KEY_NEIGHBORS[lowerChar];
      const typo = neighbors[Math.floor(Math.random() * neighbors.length)];
      
      await page.keyboard.type(typo);
      await new Promise(r => setTimeout(r, Math.random() * 200 + 100)); // Tempo de reação "Ops!"
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, Math.random() * 100 + 50)); // Tempo de correção
    }

    // 2. Simulação de Erro de Espaço (Duplo Espaço)
    if (char === ' ' && Math.random() < 0.05) {
        await page.keyboard.type('  '); // Digita dois
        await new Promise(r => setTimeout(r, 150));
        await page.keyboard.press('Backspace'); // Apaga um
    }

    // 3. Ritmo Biomecânico
    let delay = Math.random() * 60 + 30;
    if (/[.,\n?!]/.test(char)) delay += 150;
    if (/[A-Z]/.test(char)) delay += 50;
    
    await page.keyboard.type(char);
    await new Promise(r => setTimeout(r, delay));

    // 4. Pausa Cognitiva (Cansaço)
    if (i % 50 === 0 && Math.random() < 0.1) {
       await new Promise(r => setTimeout(r, 600));
    }
  }
}

module.exports = { humanClick, humanType, wakeUpMove, resetCursor };
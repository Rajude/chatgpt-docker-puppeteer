/* src/core/forensics.js */
// MÓDULO DE FORENSE DIGITAL (AUDIT LEVEL 6)
// Responsabilidade: Gerar snapshots de erro (HTML + Print) para diagnóstico.

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const ROOT = path.resolve(__dirname, '../../');
const DUMP_DIR = path.join(ROOT, 'logs', 'crash_reports');

// Garante diretório de dumps
if (!fs.existsSync(DUMP_DIR)) {
  try { fs.mkdirSync(DUMP_DIR, { recursive: true }); } catch (e) {}
}

/**
 * Cria um pacote de evidências do erro.
 * @param {object} page - Instância do Puppeteer
 * @param {Error} error - O erro capturado
 * @param {string} taskId - ID da tarefa
 */
async function createCrashDump(page, error, taskId = 'unknown') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpId = `crash_${timestamp}_${taskId}`;
  const folder = path.join(DUMP_DIR, dumpId);
  
  try {
    fs.mkdirSync(folder, { recursive: true });
    log('FATAL', `Gerando DUMP FORENSE em: ${folder}`, taskId);

    // 1. Metadados (JSON)
    const meta = {
      id: dumpId,
      taskId: taskId,
      error_msg: error.message,
      error_stack: error.stack,
      url: page && !page.isClosed() ? page.url() : 'no-page',
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));

    // 2. Evidências Visuais (Se o navegador estiver vivo)
    if (page && !page.isClosed()) {
      try {
        // Screenshot
        await page.screenshot({ 
          path: path.join(folder, 'screenshot.jpg'), 
          quality: 50, 
          type: 'jpeg' 
        });
        
        // Snapshot do DOM (Limpando scripts para economizar espaço)
        const html = await page.evaluate(() => {
          // Remove scripts e estilos para focar na estrutura
          document.querySelectorAll('script, style, svg, path').forEach(e => e.remove());
          return document.documentElement.outerHTML;
        });
        fs.writeFileSync(path.join(folder, 'dom_snapshot.html'), html);
      } catch (e) {
        log('ERROR', `Falha parcial no dump visual: ${e.message}`);
      }
    }

    // 3. Gatilho para Meta-Agente
    fs.writeFileSync(path.join(DUMP_DIR, 'LATEST_CRASH.trigger'), folder);

  } catch (e) {
    // Falha na forense não deve parar o processo de restart
    console.error(`[FORENSICS] Falha crítica ao salvar dump: ${e.message}`);
  }
}

module.exports = { createCrashDump };
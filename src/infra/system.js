/* src/infra/system.js (Audit Level 12 - Surgical Kill) */
// CONTROLE DE SISTEMA OPERACIONAL
// Responsabilidade: Gerenciar processos externos com precisão cirúrgica.

const { exec } = require('child_process');
const { log } = require('../core/logger');
const treeKill = require('tree-kill'); // Necessário instalar: npm install tree-kill

/**
 * Mata um processo específico e sua árvore de filhos.
 * @param {number} pid - ID do processo do Chrome (fornecido pelo Puppeteer)
 */
function killProcess(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      log('WARN', 'Tentativa de matar processo sem PID. Abortando kill cirúrgico.');
      return resolve();
    }

    log('FATAL', `Executando Kill Switch no PID ${pid}...`);
    
    treeKill(pid, 'SIGKILL', (err) => {
      if (err) {
        log('ERROR', `Falha ao matar PID ${pid}: ${err.message}`);
        // Fallback Nuclear (Último recurso): Mata tudo se o cirúrgico falhar
        killChromeGlobal(); 
      } else {
        log('INFO', `Processo ${pid} e filhos encerrados.`);
      }
      resolve();
    });
  });
}

/**
 * Mata TODOS os processos do Chrome (Fallback Nuclear).
 * Use com cautela.
 */
function killChromeGlobal() {
  return new Promise((resolve) => {
    log('WARN', 'Executando Kill Global no Chrome (Fallback)...');
    const cmd = process.platform === 'win32' 
      ? 'taskkill /F /IM chrome.exe /T' 
      : 'pkill -9 chrome';
      
    exec(cmd, (err) => {
      if (err) log('WARN', `Falha no Kill Global: ${err.message}`);
      else log('INFO', 'Todos os Chromes encerrados.');
      resolve();
    });
  });
}

module.exports = { killProcess, killChromeGlobal };
/* src/core/logger.js (Gold 6 - Full Rotation) */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'agente_current.log');
const METRICS_FILE = path.join(LOG_DIR, 'metrics.log');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ARCHIVES = 5; // Mantém 5 arquivos de histórico

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Apaga arquivos antigos para economizar disco.
 * @param {string} prefix - Prefixo do arquivo ('agente_' ou 'metrics_')
 */
function cleanOldFiles(prefix) {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith(prefix) && (f.endsWith('.log') || f.endsWith('.json')))
      .map(f => ({ name: f, time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_ARCHIVES) {
      files.slice(MAX_ARCHIVES).forEach(f => fs.unlinkSync(path.join(LOG_DIR, f.name)));
    }
  } catch (e) {}
}

/**
 * Rotaciona um arquivo específico se ele exceder o tamanho.
 */
function rotateFile(filePath, prefix) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    
    if (stats.size > MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(filePath);
      const archivePath = path.join(LOG_DIR, `${prefix}${timestamp}${ext}`);
      
      fs.renameSync(filePath, archivePath);
      cleanOldFiles(prefix); // Limpa velhos após rotacionar
    }
  } catch (e) {
    console.error(`[LOGGER] Erro ao rotacionar ${prefix}: ${e.message}`);
  }
}

function log(level, msg, taskId = '-') {
  rotateFile(LOG_FILE, 'agente_'); // Checa rotação antes de escrever
  
  const ts = new Date().toISOString();
  let content = msg;
  if (msg instanceof Error) content = `${msg.message}\n${msg.stack}`;
  else if (typeof msg === 'object') try { content = JSON.stringify(msg); } catch (_) { content = String(msg); }

  const line = `[${ts}] ${level.padEnd(5)} [${taskId}] ${content}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8'); } catch (e) {}
}

function metric(name, payload) {
  rotateFile(METRICS_FILE, 'metrics_'); // Checa rotação antes de escrever
  
  try {
    const entry = JSON.stringify(Object.assign({ ts: new Date().toISOString(), metric: name }, payload || {}));
    fs.appendFileSync(METRICS_FILE, entry + '\n', 'utf-8');
  } catch (e) {}
}

// Limpeza inicial ao bootar
cleanOldFiles('agente_');
cleanOldFiles('metrics_');

module.exports = { log, metric, LOG_DIR };
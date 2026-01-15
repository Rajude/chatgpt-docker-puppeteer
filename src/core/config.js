/* ==========================================================================
   src/core/config.js
   Audit Level: 22 — Configuration Manager (Throttled & Safe)
   Responsabilidade: Centralizar configurações com Hot-Reload seguro.
========================================================================== */

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const ROOT = path.resolve(__dirname, '../../');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const RULES_FILE = path.join(ROOT, 'dynamic_rules.json');

/* --------------------------------------------------------------------------
   VALORES PADRÃO (DEFAULTS)
-------------------------------------------------------------------------- */
const DEFAULTS = {
  // Infraestrutura
  DEBUG_PORT: 'http://localhost:9222',
  IDLE_SLEEP: 3000,
  
  // Limites
  TASK_TIMEOUT_MS: 30 * 60 * 1000,
  RUNNING_RECOVERY_MS: 40 * 60 * 1000,
  MAX_CONTINUATIONS: 25,
  MAX_OUT_BYTES: 10 * 1024 * 1024,
  
  // Timeouts Adaptativos
  PROGRESS_TIMEOUT_MS: 90000,
  HEARTBEAT_TIMEOUT_MS: 15000,
  ECHO_CONFIRM_TIMEOUT_MS: 5000,
  
  // Comportamento
  CHUNK_SIZE: 150,
  ECHO_RETRIES: 5,
  ADAPTIVE_DELAY_BASE: 40,
  ADAPTIVE_DELAY_MAX: 250,
  adaptive_mode: 'auto',
  DEFAULT_MODEL_ID: 'gpt-5',
  allow_dom_assist: true,
  multi_tab_policy: 'AUTO_CLOSE',
  
  // Tuning
  ADAPTIVE_ALPHA: 0.15,
  ADAPTIVE_COOLDOWN_MS: 5000
};

/* --------------------------------------------------------------------------
   HOT RELOAD DE REGRAS (SAFE & THROTTLED)
-------------------------------------------------------------------------- */
let rulesCache = null;
let lastRulesMod = 0;
let lastCheckTime = 0;
const CHECK_INTERVAL = 2000; // Checa disco no máximo a cada 2s

function loadDynamicRules() {
  const now = Date.now();
  
  // Throttle: Se checou recentemente, retorna cache
  if (rulesCache && (now - lastCheckTime < CHECK_INTERVAL)) {
    return rulesCache;
  }
  lastCheckTime = now;

  try {
    // Auto-Init
    if (!fs.existsSync(RULES_FILE)) {
      const defaultRules = {
        "_meta": { "created_by": "system_init", "version": 1 },
        "selectors": {
          "input_box": ["#prompt-textarea", "div[contenteditable='true'][role='textbox']", "textarea"],
          "send_button": ["[data-testid='send-button']"]
        }
      };
      fs.writeFileSync(RULES_FILE, JSON.stringify(defaultRules, null, 2));
    }

    const stats = fs.statSync(RULES_FILE);
    
    // Reload se modificado
    if (stats.mtimeMs > lastRulesMod || !rulesCache) {
      const raw = fs.readFileSync(RULES_FILE, 'utf-8');
      const parsed = JSON.parse(raw); // Pode lançar erro
      
      rulesCache = parsed;
      lastRulesMod = stats.mtimeMs;
      // log('INFO', 'DNA: Regras recarregadas.');
    }
    return rulesCache;

  } catch (e) {
    log('ERROR', `Erro crítico ao ler DNA: ${e.message}. Usando cache anterior.`);
    // Retorna cache antigo se existir, ou objeto vazio seguro
    return rulesCache || { selectors: {} };
  }
}

/* --------------------------------------------------------------------------
   CARREGAMENTO DE CONFIGURAÇÃO
-------------------------------------------------------------------------- */
function loadConfig() {
  let userConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    log('WARN', `Config file error: ${e.message}. Using defaults.`);
  }
  
  const finalConfig = Object.assign({}, DEFAULTS, userConfig);

  // Getter Dinâmico
  Object.defineProperty(finalConfig, 'rules', {
    get: () => loadDynamicRules()
  });
  
  return finalConfig;
}

const CONFIG = loadConfig();
module.exports = CONFIG;
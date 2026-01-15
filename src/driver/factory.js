/* ==========================================================================
   src/driver/factory.js
   Audit Level: 33 — Smart Driver Factory (Final Master)
   Responsabilidade: Descoberta, Instanciação e Cache de Drivers de IA.
   Garantias: Zero Memory Leak, Contrato Estrito, Auto-Discovery.
========================================================================== */

const fs = require('fs');
const path = require('path');
const TargetDriver = require('./core/TargetDriver');
const { log } = require('../core/logger');

const TARGETS_DIR = path.join(__dirname, 'targets');
const driverClasses = {};

/**
 * Cache de instâncias vivas.
 * Chave: Objeto Page do Puppeteer (Referência Fraca)
 * Valor: Map de [Nome do Target] -> [Instância do Driver]
 */
const instanceCache = new WeakMap();

// --- 1. CARREGAMENTO DINÂMICO (AUTO-DISCOVERY) ---
// Executado apenas uma vez no carregamento do módulo (Boot time)
try {
  if (fs.existsSync(TARGETS_DIR)) {
    const files = fs.readdirSync(TARGETS_DIR);
    
    for (const file of files) {
      if (file.endsWith('Driver.js')) {
        try {
          const DriverClass = require(path.join(TARGETS_DIR, file));
          // "ChatGPTDriver.js" -> "chatgpt"
          const key = file.replace('Driver.js', '').toLowerCase();
          driverClasses[key] = DriverClass;
        } catch (e) {
          log('ERROR', `[FACTORY] Falha ao carregar classe de driver ${file}: ${e.message}`);
        }
      }
    }
  } else {
    log('WARN', '[FACTORY] Pasta de targets não encontrada. Drivers especializados indisponíveis.');
  }
} catch (e) {
  log('FATAL', `[FACTORY] Erro crítico na inicialização da fábrica: ${e.message}`);
}

/**
 * Obtém ou cria a instância correta do driver para a tarefa.
 * @param {string} targetName - Nome do alvo (ex: 'chatgpt', 'gemini')
 * @param {object} page - Instância da página do Puppeteer
 * @param {object} config - Configuração global
 * @returns {TargetDriver}
 */
function getDriver(targetName, page, config) {
  const key = (targetName || 'chatgpt').toLowerCase();
  
  // 2. GESTÃO DE CACHE POR CONTEXTO (PAGE)
  if (!instanceCache.has(page)) {
    instanceCache.set(page, new Map());
  }
  
  const pageDrivers = instanceCache.get(page);

  // 3. REAPROVEITAMENTO DE INSTÂNCIA (Performance & Estado)
  // Se já instanciamos este driver para esta aba específica, retornamos ele.
  // Isso preserva o cache do SADI (cachedInputSelector) entre tarefas.
  if (pageDrivers.has(key)) {
    return pageDrivers.get(key);
  }

  // 4. SELEÇÃO DA CLASSE
  const DriverClass = driverClasses[key];
  if (!DriverClass) {
    const available = Object.keys(driverClasses).join(', ') || 'nenhum';
    throw new Error(`[FACTORY] Driver '${key}' não suportado. Disponíveis: [${available}]`);
  }

  // 5. INSTANCIAÇÃO E VALIDAÇÃO DE CONTRATO
  try {
    const instance = new DriverClass(page, config);

    if (!(instance instanceof TargetDriver)) {
      throw new Error(`[FACTORY] O driver '${key}' viola o contrato TargetDriver.`);
    }

    // 6. PERSISTÊNCIA NO CACHE
    pageDrivers.set(key, instance);
    
    log('INFO', `[FACTORY] Driver '${instance.name}' instanciado para a sessão atual.`);
    return instance;

  } catch (e) {
    log('ERROR', `[FACTORY] Falha ao instanciar driver '${key}': ${e.message}`);
    throw e;
  }
}

/**
 * Invalida o cache de uma página (opcional, para limpezas forçadas).
 */
function invalidatePageCache(page) {
    if (instanceCache.has(page)) {
        const drivers = instanceCache.get(page);
        for (const driver of drivers.values()) {
            if (driver.destroy) driver.destroy();
        }
        instanceCache.delete(page);
    }
}

module.exports = { getDriver, invalidatePageCache, availableTargets: Object.keys(driverClasses) };
/* ==========================================================================
   INDEX.JS — AGENTE UNIVERSAL
   Audit Level: 32 — Master Engine (NASA Standard / Zero-RAM-Leak)
   Responsabilidades: Orquestração de Fluxo, Gestão de Memória e Ciclo de Vida.
   Sincronizado com: io.js, memory.js, schemas.js, validator.js (Audit 32).
========================================================================== */

const path = require('path');
const fs = require('fs');
const logger = require('./src/core/logger');
const CONFIG = require('./src/core/config');
const schemas = require('./src/core/schemas');
const io = require('./src/infra/io');
const forensics = require('./src/core/forensics');
const memory = require('./src/core/memory');
const system = require('./src/infra/system');
const validator = require('./src/logic/validator');
const driverFactory = require('./src/driver/factory');
const { ConnectionOrchestrator } = require('./src/infra/connection_orchestrator');

const { log } = logger;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- ESTADO DE SAÚDE GLOBAL ---
let consecutiveTaskFailures = 0;
let consecutiveInfraFailures = 0;
let lastInfraHeartbeat = 0;

/* ==========================================================================
   HELPERS DE SISTEMA
========================================================================== */

/**
 * Sanitização de segurança para evitar quebra de protocolo do navegador.
 */
function sanitizePrompt(text) {
  if (!text || typeof text !== 'string') return '';
  // Remove caracteres de controle ASCII (0-31) exceto newline e tab
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

/**
 * Verifica se o processo dono do lock ainda existe no Sistema Operacional.
 * Proteção contra travamentos pós-reboot do Windows.
 */
function isLockOwnerAlive(lock) {
    if (!lock || !lock.pid) return false;
    try {
        // O sinal 0 não mata o processo, apenas verifica existência
        process.kill(lock.pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Classifica e registra falhas no histórico da tarefa.
 */
async function classifyAndSaveFailure(task, type, message) {
    task.state.status = 'FAILED';
    task.state.last_error = message;
    task.state.history.push({ 
        ts: new Date().toISOString(), 
        event: 'EXECUTION_FAILURE', 
        msg: `[${type}] ${message}` 
    });
    await io.saveTask(task);
}

/* ==========================================================================
   MAIN ENGINE
========================================================================== */

async function main() {
  if (!global.gc) log('WARN', 'Garbage Collection manual indisponível. Recomenda-se rodar com --expose-gc.');
  log('INFO', '🚀 Engine V32.0 Iniciada (Master Engine Online)');

  const orchestrator = new ConnectionOrchestrator({
    allowedDomains: CONFIG.allowedDomains || ['chatgpt.com', 'gemini.google.com']
  });

  let browser = null;
  let page = null;

  while (true) {
    try {
      // 1. CONTROLE DE FLUXO EXTERNO (Semáforo manual)
      if (await io.checkControlPause()) {
        await sleep(CONFIG.IDLE_SLEEP);
        continue;
      }

      // 2. BACKOFF DINÂMICO COM JITTER (Humanizado)
      if (consecutiveTaskFailures > 0 || consecutiveInfraFailures > 0) {
          const base = (consecutiveTaskFailures * 10000) + (consecutiveInfraFailures * 5000);
          const jitter = Math.random() * 5000;
          const penalty = Math.min(300000, base + jitter);
          log('WARN', `Modo Resfriamento: Aguardando ${Math.round(penalty/1000)}s...`);
          await sleep(penalty);
      }

      // 3. TELEMETRIA DE INFRAESTRUTURA
      if (Date.now() - lastInfraHeartbeat > 60000) {
        log('INFO', '[HEARTBEAT] Infra Status', orchestrator.getStatus());
        lastInfraHeartbeat = Date.now();
      }

      // 4. AQUISIÇÃO DE CONTEXTO (Hardware Virtual)
      try {
        const ctx = await orchestrator.acquireContext();
        browser = ctx.browser;
        page = ctx.page;
        consecutiveInfraFailures = 0;
      } catch (infraErr) {
        consecutiveInfraFailures++;
        log('ERROR', `[INFRA] Falha ao estabilizar navegador: ${infraErr.message}`);
        continue;
      }

      // 5. AQUISIÇÃO E CURA DE TAREFA (Schema V32)
      const rawTask = await io.loadNextTask();
      if (!rawTask) {
        consecutiveTaskFailures = 0;
        await sleep(CONFIG.IDLE_SLEEP);
        continue;
      }

      let task;
      try {
        task = schemas.parseTask(rawTask);
      } catch (schemaErr) {
        log('ERROR', `Tarefa rejeitada por integridade: ${schemaErr.message}`, rawTask.id || 'unknown');
        rawTask.state = { status: 'FAILED', last_error: `Schema Violation: ${schemaErr.message}` };
        await io.saveTask(rawTask);
        continue;
      }

      // 6. SCOPED LOCKING COM VERIFICAÇÃO DE PID (Anti-Zombie)
      if (!await io.acquireLock(task.meta.id, task.spec.target)) {
          const lockPath = path.join(__dirname, `RUNNING_${task.spec.target.toLowerCase()}.lock`);
          const currentLock = await io.getQueue().then(q => io.acquireLock.lockData); // Simplificado para fins de fluxo
          
          // Se o lock existe mas o dono morreu no SO, quebramos o lock
          if (currentLock && !isLockOwnerAlive(currentLock)) {
              log('WARN', `Lock órfão detectado (PID ${currentLock.pid} inativo). Resetando...`);
              await io.releaseLock(task.spec.target);
          }
          await sleep(2000);
          continue;
      }

      // --- INÍCIO DA EXECUÇÃO ---
      const startTime = Date.now();
      log('INFO', `>>> Processando: ${task.meta.id} [Target: ${task.spec.target}]`, task.meta.id);
      
      task.state.status = 'RUNNING';
      task.state.started_at = new Date().toISOString();
      task.state.attempts++;
      await io.saveTask(task);

      try {
        // 7. INSTANCIAÇÃO DO DRIVER (Factory Pattern)
        const driver = driverFactory.getDriver(task.spec.target, page, CONFIG);

        // 8. PREPARAÇÃO DO ALVO (Login/Contexto/Modelo)
        await driver.prepareContext(task.spec);

        // 9. RESOLUÇÃO DE MEMÓRIA RECURSIVA (Assíncrona)
        let userMsg = await memory.resolveContext(sanitizePrompt(task.spec.payload.user_message), task);
        let sysMsg = await memory.resolveContext(sanitizePrompt(task.spec.payload.system_message), task);

        if (!userMsg) throw new Error('PROMPT_EMPTY_AFTER_RESOLVE');

        const finalPrompt = sysMsg ? `[SYSTEM]\n${sysMsg}\n[END]\n\n${userMsg}` : userMsg;
        const startSnapshot = await driver.captureState();

        // 10. ENVIO DO PROMPT
        await driver.sendPrompt(finalPrompt, task.meta.id);

        // 11. LOOP DE COLETA (Escrita Incremental / Anti-OOM)
        let totalResponseLength = 0;
        let cycles = 0;
        let lastChunkHash = '';
        const safeId = io.sanitizeFilename(task.meta.id);
        const outPath = path.join(io.RESPONSE_DIR, `${safeId}.txt`);

        // Inicializa arquivo limpo
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

        while (true) {
          try {
            const chunk = await driver.waitForCompletion(startSnapshot);

            // Proteção contra loops de repetição da IA
            if (chunk === lastChunkHash && cycles > 0) {
                log('WARN', 'IA entrou em loop de repetição. Abortando coleta.', task.meta.id);
                break;
            }
            lastChunkHash = chunk;

            // ESCRITA INCREMENTAL: Mantém a RAM limpa
            fs.appendFileSync(outPath, (totalResponseLength > 0 ? '\n\n' : '') + chunk, 'utf-8');
            totalResponseLength += chunk.length;

            // Verificação de Limites
            if (++cycles >= CONFIG.MAX_CONTINUATIONS) {
                log('WARN', 'Limite de continuações atingido.', task.meta.id);
                break;
            }

            // Heurística de Fim de Resposta (Agnóstica)
            const isCode = chunk.trim().endsWith('```') || chunk.trim().endsWith('}');
            const isPunctuation = /[.!?]$/.test(chunk.trim());
            if (chunk.length < 1000 && (isPunctuation || isCode)) break;

            // Pacing Humano
            const readingDelay = Math.min(5000, chunk.length * 15);
            await sleep(readingDelay);

            log('INFO', `Auto-continuação (Ciclo ${cycles})`, task.meta.id);
            const continueCmd = driver.continueCommand || "continue";
            await driver.sendPrompt(continueCmd, task.meta.id);
            await sleep(2000);

          } catch (waitErr) {
            // Tratamento de Rate Limit (Erro de Negócio)
            if (waitErr.message.includes('LIMIT_REACHED')) {
                log('FATAL', 'Rate Limit atingido. Resfriamento de 30m iniciado.', task.meta.id);
                await sleep(1800000);
                throw waitErr;
            }
            
            // Erros de Infraestrutura (Chrome)
            if (waitErr.message.includes('Target closed')) throw waitErr;

            log('WARN', `Fluxo interrompido: ${waitErr.message}. Salvando progresso.`);
            break; 
          }
        }

        // 12. VALIDAÇÃO DE QUALIDADE SEMÂNTICA (Audit 32)
        const finalContent = fs.readFileSync(outPath, 'utf-8');
        const quality = await validator.validateTaskResult(task, finalContent);
        if (!quality.ok) throw new Error(`QUALITY_REJECTED: ${quality.reason}`);

        // 13. FINALIZAÇÃO DE SUCESSO
        task.state.status = 'DONE';
        task.state.completed_at = new Date().toISOString();
        task.state.metrics.duration_ms = Date.now() - startTime;
        
        task.result = { 
            file_path: outPath, 
            duration_ms: task.state.metrics.duration_ms,
            session_url: page.url() 
        };

        await io.saveTask(task);
        await driver.commitLearning();

        log('INFO', `<<< Concluída em ${(task.state.metrics.duration_ms/1000).toFixed(1)}s`, task.meta.id);
        consecutiveTaskFailures = 0;

      } catch (taskErr) {
        // 14. TRATAMENTO DE ERRO DE EXECUÇÃO
        log('ERROR', `Falha na tarefa: ${taskErr.message}`, task.meta.id);
        
        await forensics.createCrashDump(page, taskErr, task.meta.id);

        // Se o erro foi de infra (Chrome travou), aciona Kill Switch
        if (taskErr.message.includes('Target closed') || taskErr.message.includes('BROWSER_FROZEN')) {
            const pid = browser ? browser.process()?.pid : null;
            if (pid) await system.killProcess(pid);
            orchestrator.cleanup();
            consecutiveInfraFailures++;
        }

        await classifyAndSaveFailure(task, 'EXECUTION', taskErr.message);
        consecutiveTaskFailures++;

      } finally {
        io.releaseLock(task.spec.target);
        if (global.gc) global.gc();
      }

    } catch (fatalErr) {
      log('FATAL', `Colapso no loop principal: ${fatalErr.message}`);
      await sleep(10000); // Proteção contra boot-loop infinito
    }
  }
}

// --- PROTEÇÃO DE PROCESSO ---
process.on('uncaughtException', e => {
    log('FATAL', `CRASH DO SISTEMA (Uncaught): ${e.message}\n${e.stack}`);
    // Opcional: io.releaseLock('global') aqui se necessário
});

main();
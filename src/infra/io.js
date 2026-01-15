/* ==========================================================================
   src/infra/io.js
   Audit Level: 34 — Master Diamond Transactional Manager
   Responsabilidade: Persistência Atômica, Cache de Alta Performance e Locks por PID.
   Sincronização: Totalmente compatível com Schemas V34 e Dashboard Real-time.
========================================================================== */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log, metric } = require('../core/logger');
const CONFIG = require('../core/config');
const { parseTask, DnaSchema } = require('../core/schemas');

const ROOT = path.resolve(__dirname, '../../');
const QUEUE_DIR = path.join(ROOT, 'fila');
const RESPONSE_DIR = path.join(ROOT, 'respostas');
const CORRUPT_DIR = path.join(QUEUE_DIR, 'corrupted');
const RUN_LOCK_PREFIX = 'RUNNING_';
const CONTROL_FILE = path.join(ROOT, 'controle.json');
const RULES_FILE = path.join(ROOT, 'dynamic_rules.json');

// --- ESTADO INTERNO (SINGLETON REACTIVE CACHE) ---
let globalQueueCache = null;
let isCacheDirty = true;
let lastFullScan = 0;
const CACHE_HEARTBEAT_MS = 15000; // Frequência de re-indexação forçada

// Inicialização de Infraestrutura Física
[QUEUE_DIR, RESPONSE_DIR, CORRUPT_DIR].forEach(d => { 
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); 
});

// Watcher Reativo: Invalida o cache instantaneamente em mudanças no disco
fs.watch(QUEUE_DIR, (event, filename) => {
    if (filename && filename.endsWith('.json')) isCacheDirty = true;
});

/* ==========================================================================
   UTILITÁRIOS DE BAIXO NÍVEL (BLINDAGEM DE I/O)
========================================================================== */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Verifica se um processo ainda existe no Sistema Operacional.
 * Proteção contra locks órfãos após crashes do sistema.
 */
function isProcessAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0); // Sinal 0 apenas checa existência
        return true;
    } catch (e) {
        return false;
    }
}

function sanitizeFilename(name) {
    if (!name) return 'unknown';
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
}

/**
 * atomicWrite: Implementação de Shadow Paging.
 * Garante que o arquivo de destino nunca seja corrompido em falhas de energia.
 */
async function atomicWrite(filepath, content) {
    const uuid = crypto.randomBytes(4).toString('hex');
    const tmp = `${filepath}.tmp.${process.pid}.${uuid}`;
    const t0 = Date.now();
    
    try {
        fs.writeFileSync(tmp, content, 'utf-8');
        let attempts = 0;
        while (attempts < 10) {
            try {
                fs.renameSync(tmp, filepath);
                metric('io_write_ms', { duration: Date.now() - t0, file: path.basename(filepath) });
                return;
            } catch (e) {
                if (e.code === 'EPERM' || e.code === 'EBUSY') {
                    attempts++;
                    await sleep(100 * attempts); // Backoff progressivo para Windows
                } else throw e;
            }
        }
    } catch (e) {
        if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch (_) {}
        log('FATAL', `Falha crítica de escrita atômica: ${e.message}`);
        throw e;
    }
}

/**
 * safeReadJSON: Leitura resiliente com isolamento de falhas.
 */
async function safeReadJSON(filepath) {
    if (!fs.existsSync(filepath)) return null;
    let attempts = 0;
    while (attempts < 5) {
        try {
            const content = fs.readFileSync(filepath, 'utf-8');
            if (!content.trim()) throw new Error('EMPTY_FILE');
            return JSON.parse(content);
        } catch (e) {
            if (e.code === 'EBUSY' || e.code === 'EPERM') {
                await sleep(200); attempts++; continue;
            }
            // Se o arquivo está corrompido, move para quarentena para não travar o loop
            if (e instanceof SyntaxError || e.message === 'EMPTY_FILE') {
                const badFile = path.join(CORRUPT_DIR, `${path.basename(filepath)}.${Date.now()}.bad`);
                try { fs.renameSync(filepath, badFile); } catch(err){}
                log('ERROR', `Quarentena: JSON corrompido isolado em ${path.basename(badFile)}`);
                return null;
            }
            return null;
        }
    }
    return null;
}

/* ==========================================================================
   GESTÃO DE TAREFAS (BUSINESS LOGIC)
========================================================================== */

/**
 * getQueue: Retorna a fila completa usando o cache reativo.
 * Crucial para alimentar o Dashboard sem latência.
 */
async function getQueue(forceRefresh = false) {
    const now = Date.now();
    const needsHeartbeat = (now - lastFullScan > CACHE_HEARTBEAT_MS);
    
    if (!forceRefresh && !isCacheDirty && !needsHeartbeat && globalQueueCache) {
        return globalQueueCache;
    }

    try {
        const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
        const taskPromises = files.map(f => safeReadJSON(path.join(QUEUE_DIR, f)));
        const results = await Promise.all(taskPromises);
        
        globalQueueCache = results.filter(Boolean);
        isCacheDirty = false;
        lastFullScan = now;
        
        return globalQueueCache;
    } catch (e) {
        log('ERROR', `Falha na indexação da fila: ${e.message}`);
        return globalQueueCache || [];
    }
}

async function saveTask(task) {
    try {
        // Valida contra o Schema V34 antes de tocar no disco
        const validated = parseTask(task);
        const filepath = path.join(QUEUE_DIR, `${validated.meta.id}.json`);
        await atomicWrite(filepath, JSON.stringify(validated, null, 2));
        isCacheDirty = true;
    } catch (e) {
        log('ERROR', `Persistência negada: ${e.message}`);
        throw e;
    }
}

async function deleteTask(id) {
    const filepath = path.join(QUEUE_DIR, `${id}.json`);
    try {
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            isCacheDirty = true;
            log('INFO', `Tarefa removida: ${id}`);
        }
    } catch (e) { log('ERROR', `Falha ao deletar ${id}: ${e.message}`); }
}

/* ==========================================================================
   DNA E REGRAS DINÂMICAS
========================================================================== */

async function getDna() { 
    const dna = await safeReadJSON(RULES_FILE); 
    return dna ? DnaSchema.parse(dna) : null;
}

async function saveDna(dna) {
    try {
        const validated = DnaSchema.parse(dna);
        await atomicWrite(RULES_FILE, JSON.stringify(validated, null, 2));
        log('INFO', '[DNA] Evolução genética persistida.');
    } catch (e) { throw new Error(`DNA_INVALID: ${e.message}`); }
}

/* ==========================================================================
   ALGORITMO DE SELEÇÃO E LOCKING
========================================================================== */

async function loadNextTask() {
    const allTasks = await getQueue();
    const now = Date.now();

    // 1. Auto-Cura de Zumbis (Tarefas travadas em RUNNING)
    for (const t of allTasks) {
        if (t.state.status === 'RUNNING' && t.state.started_at) {
            if (now - Date.parse(t.state.started_at) > CONFIG.RUNNING_RECOVERY_MS) {
                t.state.status = 'FAILED';
                t.state.last_error = 'Timeout de Recuperação (Zumbi)';
                t.state.history.push({ ts: new Date().toISOString(), event: 'SYSTEM_RECOVERY', msg: 'Ressuscitado por inatividade' });
                await saveTask(t);
            }
        }
    }

    // 2. Filtro de Elegibilidade (Agendamento + Dependências)
    const eligible = allTasks.filter(t => {
        if (t.state.status !== 'PENDING') return false;
        
        // Verificação de Agendamento (Time-lock)
        if (t.policy.execute_after && new Date(t.policy.execute_after) > new Date()) return false;

        // Verificação de Dependências (Deadlock Breaker)
        const deps = t.policy.dependencies || [];
        if (deps.length > 0) {
            let isBlocked = false;
            let parentFailed = false;

            for (const depId of deps) {
                const parent = allTasks.find(x => x.meta.id === depId);
                if (!parent) { isBlocked = true; break; }
                
                const pStatus = parent.state.status;
                if (pStatus === 'FAILED' || pStatus === 'SKIPPED') { parentFailed = true; break; }
                if (pStatus !== 'DONE') isBlocked = true;
            }

            if (parentFailed) {
                t.state.status = 'SKIPPED';
                t.state.last_error = 'Dependência falhou ou foi pulada.';
                saveTask(t);
                return false;
            }
            if (isBlocked) return false;
        }
        return true;
    });

    // 3. Ordenação por Prioridade e Antiguidade
    return eligible.sort((a, b) => {
        if (b.meta.priority !== a.meta.priority) return b.meta.priority - a.meta.priority;
        return a.meta.created_at.localeCompare(b.meta.created_at);
    })[0] || null;
}

/**
 * acquireLock: Bloqueio por alvo com suporte a múltiplos LLMs simultâneos.
 */
async function acquireLock(taskId, target = 'global') {
    const lockFile = path.join(ROOT, `${RUN_LOCK_PREFIX}${target.toLowerCase()}.lock`);
    const lockData = { taskId, pid: process.pid, ts: new Date().toISOString() };
    
    try {
        fs.writeFileSync(lockFile, JSON.stringify(lockData), { flag: 'wx' });
        return true;
    } catch (e) {
        const s = await safeReadJSON(lockFile);
        // QUEBRA DE LOCK: Se o dono do lock não existe mais no SO
        if (s && !isProcessAlive(s.pid)) {
            log('WARN', `Quebrando lock órfão (PID: ${s.pid}) para o alvo: ${target}`);
            try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch(_) {}
            return await acquireLock(taskId, target);
        }
        return false;
    }
}

function releaseLock(target = 'global') {
    const lockFile = path.join(ROOT, `${RUN_LOCK_PREFIX}${target.toLowerCase()}.lock`);
    try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) {}
}

module.exports = {
    loadNextTask, saveTask, deleteTask, getQueue, getDna, saveDna, 
    acquireLock, releaseLock, sanitizeFilename,
    QUEUE_DIR, RESPONSE_DIR, setCacheDirty: () => { isCacheDirty = true; }
};
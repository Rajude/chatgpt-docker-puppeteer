/* ==========================================================================
   src/logic/adaptive.js
   Audit Level: 41 — Ultimate Diamond Predictive Engine (NASA Standard)
   Responsabilidade: Gestão estatística avançada, filtragem de outliers e telemetria.
   Sincronização: Dashboard V4, TargetDrivers e Master Engine.
========================================================================== */

const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const { z } = require('zod'); // Validação de integridade do DNA estatístico
const { log, metric, LOG_DIR } = require('../core/logger');
const CONFIG = require('../core/config');

const STATE_FILE = path.join(LOG_DIR, 'adaptive_state.json');

/* --------------------------------------------------------------------------
   VALIDAÇÃO DE SCHEMA (PROTEÇÃO CONTRA CORRUPÇÃO)
-------------------------------------------------------------------------- */
const StatsSchema = z.object({
    avg: z.number().nonnegative(),
    var: z.number().nonnegative(),
    count: z.number().nonnegative().default(0)
});

const TargetProfileSchema = z.object({
    ttft: StatsSchema,
    stream: StatsSchema,
    echo: StatsSchema,
    success_count: z.number().default(0)
});

const AdaptiveStateSchema = z.object({
    targets: z.record(TargetProfileSchema),
    infra: StatsSchema,
    last_adjustment_at: z.number().default(0)
});

/* --------------------------------------------------------------------------
   ESTADO E INICIALIZAÇÃO SINCRONIZADA
-------------------------------------------------------------------------- */
const createEmptyStats = (initialAvg) => ({ avg: initialAvg, var: Math.pow(initialAvg / 2, 2), count: 0 });

const defaultState = {
    targets: {},
    infra: createEmptyStats(200),
    last_adjustment_at: 0
};

let state = defaultState;
let isReady = false;
const readyPromise = init();

async function init() {
    try {
        if (fss.existsSync(STATE_FILE)) {
            const content = await fs.readFile(STATE_FILE, 'utf-8');
            const parsed = JSON.parse(content);
            state = AdaptiveStateSchema.parse(parsed); // Validação Zod
        }
        isReady = true;
        log('INFO', '[ADAPTIVE] Memória estatística carregada e validada.');
    } catch (e) {
        log('WARN', `[ADAPTIVE] Resetando baseline: ${e.message}`);
        state = defaultState;
        isReady = true;
    }
}

async function persist() {
    try {
        const tmp = `${STATE_FILE}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2));
        await fs.rename(tmp, STATE_FILE);
    } catch (e) { /* Fail-safe silencioso */ }
}

/* --------------------------------------------------------------------------
   MOTOR ESTATÍSTICO (DYNAMIC ALPHA + OUTLIER REJECTION)
-------------------------------------------------------------------------- */

/**
 * Atualiza estatísticas usando aprendizado adaptativo e rejeição de anomalias.
 */
function updateStats(stats, value, type) {
    // 1. Filtro de Outliers (Rejeição de 6-Sigma)
    // Se o valor for absurdamente alto (ex: internet caiu por 10 min), não polui a média.
    const stdDev = Math.sqrt(stats.var);
    if (stats.count > 10 && value > stats.avg + (6 * stdDev)) {
        log('WARN', `[ADAPTIVE] Outlier rejeitado (${type}): ${value}ms (Média: ${stats.avg}ms)`);
        return;
    }

    // 2. Dynamic Alpha (Modo Aquecimento)
    // Aprende rápido no início (alpha alto), estabiliza depois (alpha baixo).
    const alpha = stats.count < 20 ? 0.4 : (CONFIG.ADAPTIVE_ALPHA || 0.15);
    const diff = value - stats.avg;
    
    stats.avg = Math.round(stats.avg + (alpha * diff));
    stats.var = Math.round((1 - alpha) * (stats.var + alpha * Math.pow(diff, 2)));
    stats.count++;
}

/**
 * Registra métrica com garantia de inicialização.
 */
async function recordMetric(type, ms, target = 'generic') {
    if (!isReady) await readyPromise;
    if (!ms || isNaN(ms) || ms < 0) return;
    
    const tKey = target.toLowerCase();
    if (!state.targets[tKey]) {
        state.targets[tKey] = {
            ttft: createEmptyStats(15000),
            stream: createEmptyStats(500),
            echo: createEmptyStats(2000),
            success_count: 0
        };
    }

    if (type === 'ttft') updateStats(state.targets[tKey].ttft, ms, 'TTFT');
    else if (type === 'gap') updateStats(state.targets[tKey].stream, ms, 'Stream');
    else if (type === 'echo') updateStats(state.targets[tKey].echo, ms, 'Echo');
    else if (type === 'heartbeat') updateStats(state.infra, ms, 'Infra');

    if (Math.random() < 0.05) persist(); // Throttle 5%
}

/* --------------------------------------------------------------------------
   CÁLCULO DE TIMEOUT EXPLICÁVEL
-------------------------------------------------------------------------- */

/**
 * Retorna timeout detalhado para o Maestro e Dashboard.
 */
async function getAdjustedTimeout(target = 'generic', messageCount = 0, phase = 'STREAM') {
    if (!isReady) await readyPromise;

    const tKey = target.toLowerCase();
    const profile = state.targets[tKey] || { ttft: createEmptyStats(20000), stream: createEmptyStats(1000) };
    const stats = (phase === 'INITIAL' || phase === 'TTFT') ? profile.ttft : profile.stream;
    
    const stdDev = Math.sqrt(stats.var);
    
    // Cálculo de Parcelas
    const base = stats.avg;
    const safetyMargin = Math.round(3 * stdDev); // Margem de 99.7% de confiança
    const contextPenalty = Math.round(Math.log2(messageCount + 2) * 2000); // Degradação logarítmica

    const total = base + safetyMargin + contextPenalty;

    // Limites de Segurança (Hard Caps)
    const minPatience = (phase === 'INITIAL') ? 30000 : 10000;
    const maxPatience = 300000; // 5 minutos

    const finalTimeout = Math.min(maxPatience, Math.max(minPatience, total));

    return {
        timeout: finalTimeout,
        breakdown: {
            learned_avg: base,
            safety_margin: safetyMargin,
            context_penalty: contextPenalty,
            std_dev: Math.round(stdDev)
        },
        phase,
        target: tKey
    };
}

/**
 * Retorna o Índice de Estabilidade (0-100) para o Dashboard.
 */
async function getStabilityMetrics(target = 'generic') {
    if (!isReady) await readyPromise;
    const profile = state.targets[target.toLowerCase()];
    if (!profile) return { score: 100, status: 'STABLE' };

    const cv = (Math.sqrt(profile.stream.var) / profile.stream.avg); // Coeficiente de Variação
    const score = Math.max(0, Math.min(100, 100 - (cv * 100)));

    return {
        score: Math.round(score),
        status: score > 80 ? 'STABLE' : (score > 50 ? 'DEGRADED' : 'UNSTABLE'),
        samples: profile.stream.count
    };
}

module.exports = {
    recordMetric,
    getAdjustedTimeout,
    getStabilityMetrics,
    get values() {
        // Suporte a legado com valores síncronos aproximados
        return {
            HEARTBEAT_TIMEOUT: Math.round(state.infra.avg * 5),
            ECHO_TIMEOUT: Math.round((state.targets.chatgpt?.echo.avg || 2000) * 3),
            PROGRESS_TIMEOUT: 60000 // Fallback fixo para getters síncronos
        };
    },
    state
};
/* ==========================================================================
   src/core/memory.js
   Audit Level: 40 — Ultimate Diamond Cognitive Processor (NASA Standard)
   Responsabilidade: Resolução de contexto de alta performance e extração cirúrgica.
   Sincronização: O(1) Search, Stack-based JSON Parsing, Recursive Safety.
========================================================================== */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { StringDecoder } = require('string_decoder');
const io = require('../infra/io');
const { log } = require('./logger');

// --- CONFIGURAÇÃO DE SEGURANÇA ---
const MAX_RECURSION_DEPTH = 3;
const MAX_READ_BYTES = 1024 * 1024; // 1MB teto por arquivo
const SUMMARY_LIMIT = 2000;
const GLOBAL_CONTEXT_LIMIT = 500000; // 500k chars teto de segurança

/* ==========================================================================
   UTILITÁRIOS DE EXTRAÇÃO AVANÇADA
========================================================================== */

/**
 * extractJsonByStack: Captura o primeiro objeto JSON válido via análise de pilha.
 * Proteção contra ruído textual antes ou depois do bloco de dados.
 */
function extractJsonByStack(content) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (content[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) return content.slice(start, i + 1);
        }
    }
    return "{}";
}

/**
 * smartTruncate: Corta o texto respeitando a semântica gramatical.
 */
function smartTruncate(text, limit) {
    if (text.length <= limit) return text;
    const sub = text.slice(0, limit);
    const lastPoint = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('?'), sub.lastIndexOf('\n'));
    const safeCut = (lastPoint > limit * 0.7) ? lastPoint + 1 : limit;
    return sub.slice(0, safeCut).trim() + "\n\n[... CONTEÚDO RESUMIDO POR SEGURANÇA ...]";
}

/**
 * safeReadBufferAsync: I/O Não-bloqueante com sanitização de caracteres de controle.
 */
async function safeReadBufferAsync(filepath) {
    try {
        const stats = await fsp.stat(filepath);
        const sizeToRead = Math.min(stats.size, MAX_READ_BYTES);
        const handle = await fsp.open(filepath, 'r');
        const buffer = Buffer.alloc(sizeToRead);
        const { bytesRead } = await handle.read(buffer, 0, sizeToRead, 0);
        await handle.close();

        const decoder = new StringDecoder('utf8');
        // Remove caracteres de controle (0-31) exceto newline e tab
        return decoder.write(buffer.slice(0, bytesRead)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    } catch (e) {
        throw new Error(`Falha física de leitura: ${e.message}`);
    }
}

/* ==========================================================================
   INDEXADOR DE PROJETO (ALGORITMO O(1))
========================================================================== */

class ProjectIndex {
    constructor(allTasks, projectId) {
        // Filtra e isola o contexto do projeto atual
        this.tasks = allTasks.filter(t => 
            (t.meta?.project_id || t.project_id || 'default') === projectId && 
            (t.state?.status === 'DONE' || t.status === 'DONE')
        ).sort((a, b) => {
            const dateA = new Date(a.state?.completed_at || a.completedAt || 0);
            const dateB = new Date(b.state?.completed_at || b.completedAt || 0);
            return dateB - dateA; // Ordenação cronológica reversa
        });

        // Mapeamento para busca instantânea por ID
        this.idMap = new Map(this.tasks.map(t => [t.meta?.id || t.id, t]));
    }

    findLastByTag(tag) {
        return this.tasks.find(t => (t.meta?.tags || t.tags || []).includes(tag));
    }

    findFirstByTag(tag) {
        return [...this.tasks].reverse().find(t => (t.meta?.tags || t.tags || []).includes(tag));
    }

    getRecent() {
        return this.tasks[0] || null;
    }
}

/* ==========================================================================
   TRANSFORMADORES E MOTOR DE RESOLUÇÃO
========================================================================== */

function applyTransform(content, transform, targetTask) {
    const type = (transform || 'RAW').toUpperCase();
    switch (type) {
        case 'SUMMARY': return smartTruncate(content, SUMMARY_LIMIT);
        case 'JSON':    return extractJsonByStack(content);
        case 'HEAD':    return content.slice(0, 1500) + "\n[... INÍCIO DO CONTEÚDO ...]";
        case 'TAIL':    return "[... FIM DO CONTEÚDO ...]\n" + content.slice(-1500);
        case 'STATUS':  return targetTask?.state?.status || "UNKNOWN";
        case 'CODE':
            const blocks = content.match(/```[\s\S]*?```/g);
            return blocks ? blocks.join('\n\n') : "[Nenhum bloco de código detectado]";
        default: return content.trim();
    }
}

/**
 * resolveContext: O Coração Cognitivo do Agente.
 * Resolve referências {{REF:...}} de forma recursiva e protegida.
 */
async function resolveContext(text, currentTask = null, depth = 0, index = null) {
    if (!text || depth > MAX_RECURSION_DEPTH || !text.includes('{{REF:')) return text;

    // Inicialização do Indexador (Apenas no nível 0 da recursão)
    if (!index) {
        const allTasks = await io.getQueue();
        index = new ProjectIndex(allTasks, currentTask?.meta?.project_id || 'default');
    }

    const regex = /\{\{REF:([a-zA-Z0-9._\-:]+)(?:\|([a-zA-Z0-9]+))?\}\}/g;
    const matches = Array.from(text.matchAll(regex));
    if (matches.length === 0) return text;

    let resolvedText = text;
    let totalInjected = 0;

    for (const match of matches) {
        const [fullMatch, criteria, transform] = match;
        
        try {
            // Proteção contra estouro de memória global do prompt
            if (totalInjected > GLOBAL_CONTEXT_LIMIT) {
                resolvedText = resolvedText.split(fullMatch).join("[OVERFLOW_LIMIT]");
                continue;
            }

            let targetTask = null;

            // Lógica de Seleção Semântica O(1)
            if (criteria === 'LAST') targetTask = index.getRecent();
            else if (criteria.startsWith('TAG:')) targetTask = index.findLastByTag(criteria.split(':')[1]);
            else if (criteria.startsWith('FIRST:TAG:')) targetTask = index.findFirstByTag(criteria.split(':')[2]);
            else targetTask = index.idMap.get(criteria);

            // Validação de existência e proteção contra auto-referência
            if (!targetTask || (currentTask && (targetTask.meta?.id || targetTask.id) === currentTask.meta?.id)) {
                resolvedText = resolvedText.split(fullMatch).join(`[REF_INVALIDA: ${criteria}]`);
                continue;
            }

            const targetId = targetTask.meta?.id || targetTask.id;

            // Resolução PROMPT (Recupera a instrução, não a resposta)
            if (transform === 'PROMPT') {
                const p = targetTask.spec?.payload?.user_message || targetTask.prompt || "";
                resolvedText = resolvedText.split(fullMatch).join(p);
                continue;
            }

            // Resolução RESULTADO (Leitura de arquivo TXT)
            const responsePath = path.join(io.RESPONSE_DIR, `${io.sanitizeFilename(targetId)}.txt`);
            if (!fs.existsSync(responsePath)) {
                resolvedText = resolvedText.split(fullMatch).join(`[ARQUIVO_AUSENTE: ${targetId}]`);
                continue;
            }

            const rawContent = await safeReadBufferAsync(responsePath);
            const transformed = applyTransform(rawContent, transform, targetTask);
            
            // Substituição Segura (Literal String Replacement)
            resolvedText = resolvedText.split(fullMatch).join(transformed);
            totalInjected += transformed.length;

        } catch (e) {
            log('ERROR', `Falha na resolução semântica (${criteria}): ${e.message}`);
            resolvedText = resolvedText.split(fullMatch).join(`[ERRO_INTERNO_MEMORIA]`);
        }
    }

    // Recursão: Resolve tags que possam ter sido injetadas pelo conteúdo recuperado
    return await resolveContext(resolvedText, currentTask, depth + 1, index);
}

module.exports = { resolveContext };
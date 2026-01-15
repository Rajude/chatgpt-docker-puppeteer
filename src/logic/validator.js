/* ==========================================================================
   src/logic/validator.js
   Audit Level: 33 — Ultimate Quality Gate (Zero-RAM-Leak / Stream-Aware)
   Responsabilidade: Validar integridade, semântica e formato do output em disco.
   Sincronização: index.js (V33), io.js (V32) e i18n.js (V17).
========================================================================== */

const fs = require('fs');
const readline = require('readline');
const { log } = require('../core/logger');
const i18n = require('../core/i18n');

/**
 * Realiza a auditoria de qualidade sem carregar o arquivo inteiro na RAM.
 * @param {object} task - Objeto da tarefa (Schema V34).
 * @param {string} filePath - Caminho para o arquivo de resposta em disco.
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
async function validateTaskResult(task, filePath) {
    try {
        // 1. VALIDAÇÃO DE EXISTÊNCIA E INTEGRIDADE FÍSICA
        if (!fs.existsSync(filePath)) {
            return { ok: false, reason: 'FILE_NOT_FOUND: O arquivo de resposta não foi gerado.' };
        }

        const stats = fs.statSync(filePath);
        const rules = task.spec.validation || {};

        // 2. VALIDAÇÃO DE COMPRIMENTO MÍNIMO (Via Metadados de Disco)
        const minLen = rules.min_length || 10;
        if (stats.size < minLen) {
            return { ok: false, reason: `TOO_SHORT: Conteúdo insuficiente (${stats.size} bytes).` };
        }

        // 3. SCANNER SEMÂNTICO POR STREAM (Anti-OOM)
        // Buscamos termos proibidos linha a linha para não sobrecarregar a RAM
        const systemErrorTerms = i18n.getTerms('error_indicators', 'pt'); 
        const userForbiddenTerms = rules.forbidden_terms || [];
        const allForbidden = [...new Set([...systemErrorTerms, ...userForbiddenTerms])];

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: fileStream,
            terminal: false
        });

        let foundTerm = null;
        let lineCount = 0;
        let fullContentForJson = ""; // Apenas acumulamos se o formato exigido for JSON

        for await (const line of rl) {
            lineCount++;
            const lowerLine = line.toLowerCase();
            
            // Busca termos proibidos na linha atual
            for (const term of allForbidden) {
                if (lowerLine.includes(term.toLowerCase())) {
                    foundTerm = term;
                    break;
                }
            }
            
            if (foundTerm) break;

            // Se a tarefa exige JSON, precisamos acumular o conteúdo (dentro de um limite seguro)
            if (task.spec.config?.output_format === 'json' && stats.size < 2 * 1024 * 1024) {
                fullContentForJson += line;
            }
        }

        if (foundTerm) {
            log('WARN', `[VALIDATOR] Rejeitado por termo proibido: "${foundTerm}"`, task.meta.id);
            return { ok: false, reason: `FORBIDDEN_CONTENT: Detectada recusa ou erro da IA: "${foundTerm}"` };
        }

        // 4. VALIDAÇÃO DE FORMATO (JSON)
        if (task.spec.config?.output_format === 'json') {
            // Se o arquivo for muito grande para um JSON esperado, rejeitamos por segurança
            if (stats.size > 2 * 1024 * 1024) {
                return { ok: false, reason: 'FORMAT_ERROR: JSON excede limite de segurança de 2MB.' };
            }
            try {
                const jsonMatch = fullContentForJson.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error("Estrutura JSON não localizada.");
                JSON.parse(jsonMatch[0]);
            } catch (e) {
                return { ok: false, reason: `FORMAT_ERROR: Integridade JSON violada. ${e.message}` };
            }
        }

        // 5. VALIDAÇÃO DE PADRÃO (REGEX) - Apenas se o arquivo for pequeno
        if (rules.required_pattern && stats.size < 1024 * 1024) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const regex = new RegExp(rules.required_pattern, 'i');
            if (!regex.test(content)) {
                return { ok: false, reason: 'PATTERN_MISMATCH: O conteúdo não atende ao padrão exigido.' };
            }
        }

        return { ok: true, reason: null };

    } catch (e) {
        log('ERROR', `Falha catastrófica no Validador: ${e.message}`, task.meta.id);
        return { ok: false, reason: `VALIDATOR_CRASH: ${e.message}` };
    }
}

module.exports = { validateTaskResult };
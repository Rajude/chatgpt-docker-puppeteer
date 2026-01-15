/* ==========================================================================
   src/core/schemas.js
   Audit Level: 34 — Ultimate Data Architecture (NASA-Grade)
   Responsabilidade: Definição universal dos contratos de dados e normalização.
   Sincronização: Preparado para Dashboard Real-time e Agentes Autônomos.
========================================================================== */

const { z } = require('zod');

/* --------------------------------------------------------------------------
   1. DNA & RULES SCHEMA (O Genoma do Robô)
   Garante que as regras aprendidas pelo SADI sejam estruturalmente válidas.
-------------------------------------------------------------------------- */
const DnaSchema = z.object({
  _meta: z.object({
    version: z.number().default(1),
    last_updated: z.string().datetime().optional(),
    updated_by: z.string().optional(), // 'system:sadi' ou 'human'
    evolution_count: z.number().default(0) // Rastreia quantas vezes o DNA mudou
  }).optional(),
  
  // Seletores aprendidos pelo SADI
  selectors: z.record(z.array(z.string())).default({
    input_box: ["#prompt-textarea"],
    send_button: ["[data-testid='send-button']"]
  }),
  
  // Parâmetros de comportamento adaptados pela IA
  behavior_overrides: z.record(z.any()).default({})
}).passthrough(); // Permite que a IA adicione novas propriedades genéticas

/* --------------------------------------------------------------------------
   2. TASK SUB-SCHEMAS (Componentes da Unidade Atômica)
-------------------------------------------------------------------------- */

/**
 * MetaSchema: Metadados para Identidade, Dashboard e Rastreabilidade.
 */
const MetaSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/).min(1),
  project_id: z.string().default("default"),
  parent_id: z.string().optional(), // Referência para tarefas pai (Recursividade)
  correlation_id: z.string().optional(), // Agrupador de fluxos complexos
  version: z.string().default("4.0"),
  created_at: z.string().datetime().or(z.string().transform(() => new Date().toISOString())),
  priority: z.number().default(5).transform(v => Math.max(0, Math.min(100, v))),
  source: z.enum(['manual', 'api', 'orchestrator', 'bulk', 'gui', 'flow_manager', 'self_generated']).default('manual'),
  tags: z.array(z.string()).default([]),
  checksum: z.string().optional() // Para validação de integridade do payload
});

/**
 * SpecSchema: A Intenção. Define o que a IA deve fazer.
 */
const SpecSchema = z.object({
  target: z.string().default('chatgpt'), 
  model: z.string().default('gpt-5'),
  
  payload: z.object({
    system_message: z.string().optional().default(""),
    context: z.string().optional().default(""),
    // Sanitização: Remove caracteres de controle (0-31) que quebram o Puppeteer
    user_message: z.string().min(1).trim().transform(v => v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""))
  }),

  parameters: z.object({
    temperature: z.number().min(0).max(2).default(0.7),
    max_tokens: z.number().optional(),
    top_p: z.number().optional(),
    stop_sequences: z.array(z.string()).default([])
  }).default({}),

  // Regras que o Dashboard usará para validar a qualidade da resposta
  validation: z.object({
      min_length: z.number().default(10),
      required_format: z.enum(['text', 'json', 'markdown', 'code']).default('text'),
      forbidden_terms: z.array(z.string()).default(["I cannot", "As an AI", "desculpe", "violação"])
  }).default({}),

  config: z.object({
    reset_context: z.boolean().default(false),
    require_history: z.boolean().default(true),
    output_format: z.enum(['markdown', 'json', 'raw']).default('markdown'),
    session_id: z.string().optional()
  }).default({})
}).passthrough();

/**
 * PolicySchema: O SLA. Define limites e agendamento.
 */
const PolicySchema = z.object({
  max_attempts: z.number().min(1).default(5),
  timeout_ms: z.union([z.number(), z.literal('auto')]).default('auto'),
  dependencies: z.array(z.string()).default([]),
  execute_after: z.string().datetime().nullable().optional(),
  priority_weight: z.number().default(1.0) // Multiplicador para o escalonador
});

/**
 * StateSchema: Telemetria em tempo real para o Dashboard.
 */
const StateSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'PAUSED', 'SKIPPED', 'STALLED']).default('PENDING'),
  progress_estimate: z.number().min(0).max(100).default(0), // Barra de progresso na UI
  worker_id: z.string().nullable().default(null),
  attempts: z.number().default(0),
  started_at: z.string().nullable().default(null),
  completed_at: z.string().nullable().default(null),
  last_error: z.string().nullable().default(null),
  
  // Métricas detalhadas para gráficos de performance
  metrics: z.object({
      duration_ms: z.number().default(0),
      token_estimate: z.number().default(0),
      heartbeat_latency_ms: z.number().default(0),
      event_loop_lag_ms: z.number().default(0)
  }).default({}),

  // Histórico de eventos (O log visual da tarefa)
  history: z.array(z.object({
    ts: z.string().datetime().or(z.string().transform(() => new Date().toISOString())),
    event: z.string(),
    msg: z.string().optional(),
    worker: z.string().optional()
  })).default([])
});

/**
 * ResultSchema: Onde o produto final e metadados de sessão residem.
 */
const ResultSchema = z.object({
  file_path: z.string().nullable().default(null),
  session_url: z.string().url().nullable().default(null),
  finish_reason: z.enum(['stop', 'length', 'content_filter', 'error', 'manual', 'unknown']).default('unknown'),
  raw_output_preview: z.string().optional() // Para o Dashboard mostrar um "teaser"
}).default({});

/* --------------------------------------------------------------------------
   3. SCHEMA MESTRE DA TAREFA
-------------------------------------------------------------------------- */

const TaskSchema = z.object({
  meta: MetaSchema,
  spec: SpecSchema,
  policy: PolicySchema,
  state: StateSchema,
  result: ResultSchema
}).passthrough(); // Essencial para autoprogramação

/**
 * parseTask: O Motor de Cura e Normalização.
 * Transforma qualquer input (V1, V2, V3) em uma estrutura V4.0 perfeita.
 */
function parseTask(raw) {
  if (!raw || typeof raw !== 'object') throw new Error("Input inválido: Task deve ser um objeto.");

  // Deep copy para evitar mutação lateral
  const n = JSON.parse(JSON.stringify(raw)); 

  // A. ADAPTADOR DE LEGADO (V1/V2 -> V4)
  if (n.prompt && (!n.spec || !n.spec.payload)) {
    n.spec = { ...n.spec, payload: { ...n.spec?.payload, user_message: n.prompt } };
  }
  if (n.prioridade !== undefined && (!n.meta || n.meta.priority === undefined)) {
    n.meta = { ...n.meta, priority: n.prioridade };
  }
  if (n.id && (!n.meta || !n.meta.id)) {
      n.meta = { ...n.meta, id: n.id.replace(/[^a-zA-Z0-9._-]/g, '_') };
  }
  if (n.status && (!n.state || !n.state.status)) {
      n.state = { ...n.state, status: n.status };
  }
  if (n.erro && (!n.state || !n.state.last_error)) {
      n.state = { ...n.state, last_error: n.erro };
  }
  if (n.dependsOn && (!n.policy || !n.policy.dependencies)) {
      n.policy = { ...n.policy, dependencies: n.dependsOn };
  }

  // B. GARANTIA DE BLOCOS ESTRUTURAIS
  n.meta = n.meta || {};
  n.spec = n.spec || {};
  n.policy = n.policy || {};
  n.state = n.state || {};
  n.result = n.result || {};

  // C. VALIDAÇÃO ZOD FINAL
  return TaskSchema.parse(n);
}

module.exports = { TaskSchema, DnaSchema, parseTask };
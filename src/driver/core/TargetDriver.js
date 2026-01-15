/* src/driver/core/TargetDriver.js */
// AUDIT LEVEL 30 - OBSERVABLE STATE MACHINE
// Define contrato, eventos e estados padronizados.

const EventEmitter = require('events');

// Eventos Padronizados
const EVENTS = {
  STATE_CHANGE: 'state_change', // { from, to }
  PROGRESS: 'progress',         // { length: 120 }
  WARNING: 'warning',           // { msg: 'High Lag' }
  DEBUG: 'debug'                // { msg: 'SADI found input' }
};

// Estados Padronizados
const STATES = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  TYPING: 'TYPING',
  WAITING: 'WAITING',
  STALLED: 'STALLED'
};

class TargetDriver extends EventEmitter {
  constructor(page, config) {
    super();
    if (this.constructor === TargetDriver) throw new Error("Abstract Class");
    this.page = page;
    this.config = config;
    this.name = "Generic";
    this._state = STATES.IDLE;
    
    this.capabilities = {
      text_generation: true,
      image_generation: false,
      file_upload: false,
      context_reset: true,
      streaming_events: false
    };
  }

  // --- GESTÃO DE ESTADO ---
  
  get state() { return this._state; }
  
  setState(newState) {
    if (this._state !== newState) {
      this.emit(EVENTS.STATE_CHANGE, { from: this._state, to: newState });
      this._state = newState;
    }
  }

  // --- API PÚBLICA ---

  getCapabilities() { return this.capabilities; }

  async getHealth() { return { status: 'OK' }; }

  /**
   * [OTIMIZAÇÃO] Bloqueia recursos inúteis para economizar CPU.
   */
  async optimizePage() {
    // Implementação padrão vazia (Drivers podem sobrescrever)
    return;
  }

  async validatePage() { throw new Error('Not Implemented'); }
  async prepareContext(taskSpec) { throw new Error('Not Implemented'); }
  async sendPrompt(text, taskId) { throw new Error('Not Implemented'); }
  async waitForCompletion(snapshot, signal) { throw new Error('Not Implemented'); }
  async captureState() { throw new Error('Not Implemented'); }
  async commitLearning() { return; }
  
  async destroy() {
    this.removeAllListeners();
  }
}

// Exporta Classe e Constantes
TargetDriver.EVENTS = EVENTS;
TargetDriver.STATES = STATES;

module.exports = TargetDriver;
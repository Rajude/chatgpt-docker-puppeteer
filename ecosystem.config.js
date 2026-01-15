/* ecosystem.config.js - Configuração PM2 (Audit Level 7) */
module.exports = {
  apps: [
    {
      // 1. O Robô (Worker)
      // Responsável por rodar o Puppeteer e executar tarefas.
      name: "agente-gpt",
      script: "./index.js",
      
      // Habilita Garbage Collector manual para limpeza de memória em sessões longas
      node_args: "--expose-gc",
      
      // Não reinicia se arquivos de dados mudarem (evita loop de restart ao salvar tarefas)
      watch: false,
      ignore_watch: ["node_modules", "logs", "fila", "respostas", "tmp", "RUNNING.lock"],
      
      // Proteção: Se vazar memória (>1GB), reinicia automaticamente
      max_memory_restart: "1G",
      
      // Proteção: Se crashar, espera um tempo crescente antes de reiniciar (100ms -> 150ms -> ...)
      exp_backoff_restart_delay: 100,
      
      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/agente-error.log",
      out_file: "./logs/agente-out.log",
      
      env: {
        NODE_ENV: "production",
        FORCE_COLOR: "1" // Garante cores nos logs do terminal
      }
    },
    {
      // 2. O Painel Web (Interface)
      // Responsável por servir o HTML e a API de controle.
      name: "dashboard-web",
      script: "./server.js",
      
      // O servidor web é leve, não precisa de GC manual
      watch: false,
      
      // Logs separados para o servidor
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/dashboard-error.log",
      out_file: "./logs/dashboard-out.log",
      
      env: {
        PORT: 3000,
        NODE_ENV: "production"
      }
    }
  ]
};
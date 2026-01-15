@echo off
title Agente GPT - Painel de Controle
color 0B

echo ==========================================
echo   INICIANDO DASHBOARD WEB
echo ==========================================
echo.

REM 1. Verifica Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERRO] Node.js nao encontrado! Instale o Node.js.
    pause
    exit
)

REM 2. Verifica se server.js existe
if not exist "server.js" (
    color 0C
    echo [ERRO] Arquivo server.js nao encontrado na pasta:
    echo %CD%
    echo.
    echo Certifique-se de que este arquivo .bat esta na raiz do projeto.
    pause
    exit
)

REM 3. Verifica dependencias (express)
if not exist "node_modules\express" (
    echo [AVISO] Dependencias do painel nao encontradas.
    echo Instalando agora... (Aguarde)
    call npm install express socket.io open
    if %errorlevel% neq 0 (
        color 0C
        echo [ERRO] Falha ao instalar dependencias. Verifique sua internet.
        pause
        exit
    )
    echo [OK] Dependencias instaladas.
)

echo [INFO] Iniciando servidor...
echo [INFO] O navegador deve abrir automaticamente em alguns segundos.
echo.
echo Mantenha esta janela aberta.
echo.

REM 4. Inicia o servidor e segura a janela se der erro
node server.js
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERRO] O servidor parou inesperadamente.
    pause
)
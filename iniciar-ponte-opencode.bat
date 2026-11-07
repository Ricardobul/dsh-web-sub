@echo off
title Ponte DSH Web para OpenCode (Gemini & DeepSeek)
cls
echo ====================================================================
echo   Ponte DSH Web para OpenCode Iniciada com Sucesso!
echo   Porta Local: http://127.0.0.1:18431/v1
echo.
echo   Modelos Disponiveis no OpenCode:
echo     - dsh-web/gemini-web--argon       (Gemini 4 Argon)
echo     - dsh-web/gemini-web--flash       (Gemini 3.8 Flash)
echo     - dsh-web/gemini-web--pro         (Gemini 3.1 Pro)
echo     - dsh-web/gemini-web--flash-lite  (Gemini Flash Lite)
echo     - dsh-web/deepseek-web-chat       (DeepSeek Web Chat V3)
echo     - dsh-web/deepseek-web-think      (DeepSeek Web DeepThink R1)
echo.
echo   Mantenha esta janela aberta enquanto estiver usando o OpenCode.
echo ====================================================================
echo.
dsh-web-sub serve
pause

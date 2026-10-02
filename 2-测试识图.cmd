@echo off
title 测试识图效果

rem Node 路径：优先用系统 PATH 里的 node；找不到再回落到本机实测路径。
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Users\NYT\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "PROJ=%~dp0"
set "LOGF=%PROJ%识图日志.txt"

if "%~1"=="" (
  echo.
  echo  ============================================
  echo   用法：把一张作业截图拖到这个文件上
  echo  ============================================
  echo.
  echo   用鼠标把截图拖到 "2-测试识图.cmd" 上面松手，
  echo   会弹出「移动到 / 复制到」的提示时，才算拖对了。
  echo.
  echo  --------------------------------------------
  echo  还没填 Key？先双击 "1-填API-Key.cmd"
  echo  --------------------------------------------
  echo.
  pause
  exit /b
)

echo.
echo  正在识别：%~nx1
echo  提示词档位：极简版（和线上小程序一致）
echo  要几秒到十几秒，别关窗口...
echo.

rem Node 输出的是 UTF-8，临时切到 65001 才能正常显示中文；
rem 跑完必须切回 936（GBK），否则本文件后面的中文提示会乱码。
chcp 65001 >nul
set "VLM_LITE=2"
"%NODE%" "%PROJ%tools\compare-vlm.js" "%~1" > "%LOGF%" 2>&1
type "%LOGF%"
chcp 936 >nul

echo.
echo  ============================================
echo  跑完了。
echo.
echo  重点看三件事：
echo    1. 题干 / 我的解答 / 老师批语 有没有分对栏
echo    2. 手写符号认对没
echo    3. 分数读出来没
echo.
echo  觉得行，就可以部署到小程序里了。
echo  觉得不行，把这份窗口内容发我（或直接说一句
echo  「又失败了」，我会去看识图日志.txt）。
echo  ============================================
echo.
pause

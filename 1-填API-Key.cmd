@echo off
title 填 API Key

echo.
echo  ============================================
echo   第一步：把 API Key 填进本地文件
echo  ============================================
echo.
echo   注意：这里填的是电脑上的本地文件，给测试脚本用。
echo   微信开发者工具里云函数的 VLM_API_KEY 是另一处
echo   （那个给手机上的小程序用）。两处都是同一把 Key，
echo   但互相独立 —— 只填一处，另一处不会跟着变。
echo  ============================================
echo.
echo  马上会用记事本打开：tools 目录下的 vlm-keys.json
echo.
echo  找到 "zhipu" 这一段，把 Key 填进引号里：
echo.
echo      "zhipu": {
echo        "key": "把你的Key粘贴到这里",
echo        "model": "glm-4.6v-flash"
echo      }
echo.
echo  改完按 Ctrl+S 保存，然后关掉记事本。
echo.
echo  --------------------------------------------
echo  还没有 Key？这样拿（3 分钟，永久免费）：
echo.
echo    1. 浏览器打开这个直达链接（就是拿 Key 的页面）：
echo       https://open.bigmodel.cn/usercenter/apikeys
echo       （不用看文档、不用选开发方式，注册完点「创建 API Key」）
echo    2. 用手机号注册并登录
echo    3. 右上角头像 - API Keys - 创建新密钥
echo    4. 复制那一串（形如 xxxxxxxx.xxxxxxxx）
echo.
echo  免费，不用信用卡，不用实名。
echo  --------------------------------------------
echo.
pause

notepad "%~dp0tools\vlm-keys.json"

@echo off
title 时间账本 - 放行防火墙端口

net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限，正在弹出授权窗口...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo 正在为时间账本放行 TCP 5180 端口...
netsh advfirewall firewall delete rule name="TimeTally 5180" >nul 2>nul
netsh advfirewall firewall add rule name="TimeTally 5180" dir=in action=allow protocol=TCP localport=5180 profile=any >nul
if errorlevel 1 (
  echo [失败] 规则没有添加成功，请确认是在管理员窗口里运行的。
) else (
  echo [完成] 已放行 TCP 5180。
  echo.
  echo 现在用手机浏览器打开启动窗口里显示的地址，例如：
  echo    http://192.168.x.x:5180
  echo.
  echo 如果仍然打不开，多半是校园网/公司网开启了“客户端隔离”，
  echo 请改用手机热点方案，见 README。
)
echo.
pause

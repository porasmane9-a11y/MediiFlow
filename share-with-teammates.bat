@echo off
title MEDIFLOW Public Tunnel
echo =======================================================
echo   Starting MEDIFLOW Public Access Tunnel...
echo   Keep this window open to allow teammates to access.
echo =======================================================
ssh -o StrictHostKeyChecking=no -R 80:127.0.0.1:3000 serveo.net
pause

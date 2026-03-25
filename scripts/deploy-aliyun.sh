#!/bin/bash
# 阿里云 ECS 部署脚本
# 用法：
#   1) 在服务器上运行：scp 此脚本到服务器后执行
#   2) 本地执行：./scripts/deploy-aliyun.sh  （需配置 SSH 免密登录）
set -e
PROJECT_DIR="${PROJECT_DIR:-/root/motbot-AIJPReservation}"
PM2_APP="${PM2_APP:-motbot-app}"

echo "==> 进入项目目录: $PROJECT_DIR"
cd "$PROJECT_DIR"

echo "==> git pull"
git pull origin main

echo "==> 安装 backend 依赖（确保 twilio 等已安装）"
cd backend && npm ci && cd ..

echo "==> npm run build"
npm run build

echo "==> pm2 restart $PM2_APP --update-env"
pm2 restart "$PM2_APP" --update-env

echo "==> 部署完成"

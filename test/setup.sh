#!/bin/sh
# 扩展 e2e 环境准备：uv venv + playwright（清华源）。
# 固定 playwright==1.49.1（Chromium 131）：品牌 Chrome 137+ 已忽略
# --load-extension，测试用 Playwright 自带 Chromium（无需下载品牌浏览器，
# 亦无需 xvfb——headless=new 原生支持扩展）。
set -e
cd "$(dirname "$0")"
[ -d .venv ] || uv venv .venv
uv pip install -q --python .venv/bin/python -i https://pypi.tuna.tsinghua.edu.cn/simple "playwright==1.49.1"
PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ \
  .venv/bin/python -m playwright install chromium
echo "OK: $(.venv/bin/python -c 'import playwright; print("playwright", "1.49.1 ready")')"

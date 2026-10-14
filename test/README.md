# 扩展一键绑定 — 自动化端到端测试

加载本扩展的 fixture 副本到 Playwright 自带 Chromium（headless=new，
无需 xvfb），对 docker compose dev 环境走 popup 完整绑定流。不依赖真实
OJ 登录——用假 cookie 覆盖「解析失败 → 手填兜底」与「公开 profile 自动
解析」两条分支链。

## 运行

```bash
# 前置：dev 环境 `docker compose up -d`（默认 http://localhost:8090，
# 可用 VOJ_BASE_URL 覆盖）。
cd cuc-voj-helper/test
./setup.sh                                 # 首次
.venv/bin/python test_bind_e2e.py
```

证据截图落仓库 `e2e-tests/<时间戳>-extbind/`；stdout 遵循 `PASS:/FAIL:`
协议，退出码 0/1。

## 设计说明

- **为何不用系统 google-chrome**：Chrome 137+ 品牌版忽略 `--load-extension`
  （静默不加载），故自动化用 Playwright Chromium（pinned 1.49.1 /
  Chromium 131，headless=new 原生支持扩展）。真实 Chrome 的装载与权限
  气泡交互由手动验收清单覆盖（扩展 README）。
  声明式 host 权限，绕过 Chrome 原生权限气泡（Playwright 无法点击浏览器
  UI）。生产 manifest 不改动。
- **假 cookie 策略**：`_uid=e2einvalid` 保证洛谷解析 404（→422 兜底分支）；
  `NOWCODERUID=103` 是公开 profile（→自动解析成功分支）。
- **手动清单不覆盖的部分**：权限气泡的真实交互、真实 OJ 登录态的成功
  绑定——见扩展 README 手动验收清单。

# CUC VOJ Helper 浏览器扩展

[CUC VOJ](https://github.com/c4pr1c3/voj)（Virtual Online Judge）的浏览器助手扩展。在用户自己的真实浏览器（Chrome/Edge）内代为访问 Codeforces，绕过 Cloudflare 人机验证——CF 看到的就是用户日常的浏览器访问。

## 功能

- **A3 路径（题面抓取）**：教师加 CF 题目时，若 FlareSolverr 不可用，VOJ 后端会通过 WebSocket 把抓取请求派发到本扩展；扩展在 CF 域内 fetch HTML，回传给后端解析落库。
- **CE 详情抓取**：CF 提交判为编译错误（COMPILATION_ERROR）时，VOJ 后端通过扩展调用 CF 内部接口 `/data/submitSource`（登录态 JSON），把编译器报错回传给 VOJ 显示。
- **一键绑定洛谷 / 牛客**：点扩展 popup 的「绑定洛谷」/「绑定牛客」，扩展读取浏览器里该 OJ 域的 Cookie，经配对 Token 认证的 REST 端点上传到 VOJ；OJ 用户名由后端自动解析，识别失败时在 popup 手填重试。免去 DevTools 手动提取 Cookie（见主仓库 Cookie 教程的「推荐：扩展一键绑定」）。
- B2 路径（代码提交）— P1-B2 阶段实现。

## 一键绑定的配对入口

配对 Token 的生成入口在 **VOJ 用户详情页（本人视角）→「OJ 账号绑定」卡片右上角的「扩展未连接」徽章**（学生与教师均可；教师也可沿用题库页徽章，两处功能一致）。

## 权限模型（为何到处是「按需询问」）

扩展遵循**最小权限**原则，能不声明的权限一律改为按需请求：

| 权限 | 声明方式 | 何时请求 | 用途 |
|------|----------|----------|------|
| VOJ 服务器域名 | optional | popup「保存并连接」点击时 | 绕过 CORS 调绑定 REST 端点（自部署任意地址均可） |
| `*.luogu.com.cn` | optional | 点「绑定洛谷」时 | `chrome.cookies` 读取洛谷登录态 |
| `*.nowcoder.com` | optional | 点「绑定牛客」时 | `chrome.cookies` 读取牛客登录态 |

这样做的原因：manifest 硬编码新增 host 权限会导致**存量用户更新扩展时被 Chrome 禁用**；optional 权限只在用户点击对应功能时弹一次询问。被拒后不影响其余功能，重新触发对应操作即可再次询问。

Cookie 只在点击绑定的瞬间读取并直接上传到你所配置的 VOJ 服务器，不在本地留存、不经过第三方。

## 安装（学生自助）

本扩展由 CUC VOJ 项目提供，学生自愿安装、自主管理。无需管理员权限。

1. 用 Chrome 或 Edge 打开本仓库：<https://github.com/c4pr1c3/cuc-voj-helper>
2. 点 **Code → Download ZIP**，解压到任意目录（如 `~/cuc-voj-helper`）。
3. 打开 `chrome://extensions/`（或 `edge://extensions/`），右上角开启 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选择解压出来的目录。
5. 工具栏出现 VOJ Helper 图标。

> 后续会发布到 Chrome Web Store / Edge Add-ons，到时可直接一键安装。

## 配对流程

1. 在 VOJ 网站登录，进入「个人中心」（用户详情页）。
2. 「OJ 账号绑定」卡片右上角点「扩展未连接」徽章 → 弹出配对对话框 → 点「生成配对 Token」（教师也可在题库页右上角完成同样操作）。
3. 复制 token，点扩展图标打开 popup。
4. 填入 VOJ 服务器地址（如 `http://172.18.114.170`）和刚复制的 token，点「保存并连接」（首次会请求 VOJ 站点访问权限，请允许）。
5. popup 顶部状态变绿「已连接」；同时页面上徽章变绿「扩展在线」。
6. 一键绑定：在浏览器登录洛谷 / 牛客后，popup 点「绑定洛谷」/「绑定牛客」（首次会请求对应网站访问权限）。
7. 教师抓 CF 题面：同时在浏览器登录 <https://codeforces.com>（扩展需要 CF 域的 cookie）。

## 目录结构

```
cuc-voj-helper/
├── manifest.json         MV3 manifest
├── background.js         service worker：WS 长连接 + fetch_problem_request / fetch_ce_detail_request 处理
├── popup/                工具栏点击弹窗（连接配置 + 一键绑定洛谷/牛客）
│   ├── popup.html
│   └── popup.js
├── options/              高级选项页
│   ├── options.html
│   └── options.js
├── test/                 自动化端到端测试（见下）
└── icons/                扩展图标（48 / 128 px PNG，蓝底白 V）
    ├── icon48.png        PIL 生成的占位图，可替换为正式品牌资源
    └── icon128.png
```

> 图标当前用 Python + PIL 现场生成（蓝底 #409eff + 白 V），仅作占位。后续如需正式品牌图标，替换 `icons/icon{48,128}.png` 即可，尺寸保持不变。

## 自动化测试

对 docker compose dev 环境跑 popup 完整绑定流（假 Cookie，无需真实 OJ 登录）：

```bash
cd test
./setup.sh                    # 首次：uv venv + playwright 1.49.1（清华/npmmirror 源）
.venv/bin/python test_bind_e2e.py
```

覆盖：洛谷「解析失败 → 手填兜底 → 绑定成功」、牛客「公开 profile 自动解析 → 直接成功」、API 侧断言。证据截图落主仓库 `e2e-tests/<时间戳>-extbind/`。细节见 `test/README.md`。

## 手动验收清单（自动化覆盖不到的部分）

1. **真实 Chrome 权限气泡**：用系统 Chrome/Edge 手动「加载已解压的扩展程序」，走一遍配对 → 点「绑定洛谷」，确认 Chrome 弹出「读取网站数据」询问且允许后绑定成功；再验证拒绝路径（点「阻止」后 popup 提示明确、其余功能不受影响）。
2. **真实 OJ 登录成功路径**：在真实浏览器登录自己的洛谷账号，一键绑定后 VOJ 用户页出现该账号、状态「有效」，且提交一道题可正常代理判题。

> 注：自动化测试用 Playwright 内置 Chromium（品牌 Chrome 137+ 已忽略 `--load-extension`，无法命令行装载扩展），因此真实 Chrome 上的装载与权限气泡交互只能人工验证。

## 安全说明

- 扩展只在 VOJ 后端与 codeforces.com 之间做受限转发：
  - `fetch_problem_request` 的 URL 必须匹配 `https://codeforces.com/problemset/problem/<digits>/<index>`，否则拒绝。
  - `fetch_ce_detail_request` 的 submission_id 必须是纯数字，且只调用 CF 自己的 `/data/submitSource` 端点。
- session_token 是与 VOJ 账号绑定的长生命周期凭证，存于 `chrome.storage.local`，可在 VOJ 配对对话框（用户详情页 / 题库页）随时撤销。
- 扩展不读取也不存储用户的 CF 密码——`credentials: "include"` 只是让浏览器自动附上用户已登录的 CF cookie，扩展代码不接触这些 cookie 的值。

## 反馈与贡献

- Bug / 建议请在 <https://github.com/c4pr1c3/cuc-voj-helper/issues> 提 issue。
- 主仓库（VOJ 后端 + 前端）：<https://github.com/c4pr1c3/voj>

## 后续

- P1-B2 阶段：扩展增加 `submit_request` 处理（在 CF 域内执行 GET submit 页 + POST 提交）。

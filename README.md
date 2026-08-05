# CUC VOJ Helper 浏览器扩展

[CUC VOJ](https://github.com/c4pr1c3/voj)（Virtual Online Judge）的浏览器助手扩展。在用户自己的真实浏览器（Chrome/Edge）内代为访问 Codeforces，绕过 Cloudflare 人机验证——CF 看到的就是用户日常的浏览器访问。

## 功能

- **A3 路径（题面抓取）**：教师加 CF 题目时，若 FlareSolverr 不可用，VOJ 后端会通过 WebSocket 把抓取请求派发到本扩展；扩展在 CF 域内 fetch HTML，回传给后端解析落库。
- **CE 详情抓取**：CF 提交判为编译错误（COMPILATION_ERROR）时，VOJ 后端通过扩展调用 CF 内部接口 `/data/submitSource`（登录态 JSON），把编译器报错回传给 VOJ 显示。
- B2 路径（代码提交）— P1-B2 阶段实现。

## 安装（学生自助）

本扩展由 CUC VOJ 项目提供，学生自愿安装、自主管理。无需管理员权限。

1. 用 Chrome 或 Edge 打开本仓库：<https://github.com/c4pr1c3/cuc-voj-helper>
2. 点 **Code → Download ZIP**，解压到任意目录（如 `~/cuc-voj-helper`）。
3. 打开 `chrome://extensions/`（或 `edge://extensions/`），右上角开启 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选择解压出来的目录。
5. 工具栏出现 VOJ Helper 图标。

> 后续会发布到 Chrome Web Store / Edge Add-ons，到时可直接一键安装。

## 配对流程

1. 在 VOJ 网站登录，进入「题库」页面。
2. 题库右上角点「扩展未连接」徽章 → 弹出配对对话框 → 点「生成配对 Token」。
3. 复制 token，点扩展图标打开 popup。
4. 填入 VOJ 服务器地址（如 `http://172.18.114.170`）和刚复制的 token，点「保存并连接」。
5. popup 顶部状态变绿「已连接」；同时题库顶部徽章变绿「扩展在线」。
6. 同时在浏览器另一个 tab 登录 <https://codeforces.com>（扩展需要 CF 域的 cookie）。

## 目录结构

```
cuc-voj-helper/
├── manifest.json         MV3 manifest
├── background.js         service worker：WS 长连接 + fetch_problem_request / fetch_ce_detail_request 处理
├── popup/                工具栏点击弹窗
│   ├── popup.html
│   └── popup.js
├── options/              高级选项页
│   ├── options.html
│   └── options.js
└── icons/                扩展图标（48 / 128 px PNG，蓝底白 V）
    ├── icon48.png        PIL 生成的占位图，可替换为正式品牌资源
    └── icon128.png
```

> 图标当前用 Python + PIL 现场生成（蓝底 #409eff + 白 V），仅作占位。后续如需正式品牌图标，替换 `icons/icon{48,128}.png` 即可，尺寸保持不变。

## 安全说明

- 扩展只在 VOJ 后端与 codeforces.com 之间做受限转发：
  - `fetch_problem_request` 的 URL 必须匹配 `https://codeforces.com/problemset/problem/<digits>/<index>`，否则拒绝。
  - `fetch_ce_detail_request` 的 submission_id 必须是纯数字，且只调用 CF 自己的 `/data/submitSource` 端点。
- session_token 是与 VOJ 账号绑定的长生命周期凭证，存于 `chrome.storage.local`，可在 VOJ 题库配对对话框随时撤销。
- 扩展不读取也不存储用户的 CF 密码——`credentials: "include"` 只是让浏览器自动附上用户已登录的 CF cookie，扩展代码不接触这些 cookie 的值。

## 反馈与贡献

- Bug / 建议请在 <https://github.com/c4pr1c3/cuc-voj-helper/issues> 提 issue。
- 主仓库（VOJ 后端 + 前端）：<https://github.com/c4pr1c3/voj>

## 后续

- P1-B2 阶段：扩展增加 `submit_request` 处理（在 CF 域内执行 GET submit 页 + POST 提交）。

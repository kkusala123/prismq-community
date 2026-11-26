# 棱题 · PrismQ Community（开源自托管 AI 刷题与智能组卷平台）

一套开箱即用、完全开源自托管的极简 AI 刷题、智能组卷与多端同步学习平台。涵盖 **Web / PWA（暗黑 Obsidian + 日间双主题）**、**Android 原生客户端（Kotlin + Jetpack Compose）** 以及 **微信小程序端**，支持 DeepSeek / OpenAI 兼容 AI 一键解析与智能建库、动态均衡组卷、自建服务器 APK 更新推送，以及 Docker Compose + PostgreSQL 一键独立部署。

---

## 核心功能亮点

1. **多端同步与原生体验（Web + PWA + Android + 微信小程序）**：
   - **Web / PWA**：支持 PC 与移动端响应式适配、亮/暗色主题切换、护眼模式、一键重置进度、A4 打印视图与 Excel/Word 导出。
   - **Android 客户端**：`com.prismq.app`，支持多账号本地数据严格隔离（DataStore 按用户分域 + Android Keystore AES-256-GCM 加密令牌）、120Hz 高刷新率丝滑切题、AI 深度讲题、应用内异常日志收集，并可通过构建参数 `-PPRISMQ_SERVER_URL=https://your-domain.com` 锁定你的自建服务器地址。
   - **微信小程序端**：`kaoshibao-miniprogram/` 目录内置完整小程序代码，与 Android 端保持一致的视觉交互体系，支持微信一键登录/账号绑定、自测组卷、考试防切屏与 AI 一键解析。
2. **服务器自托管 APK 更新推送**：
   - 支持管理员在后台直接上传新版 Android `.apk`（也可放至 `./data/updates` 自动扫描或对接自有 `GITHUB_REPO`），通过 SSE 实时向在线客户端推送更新提示，用户可自主选择立即更新或稍后再说。
3. **行业规范数据契约 & 多格式智能导题**：
   - 统一 `kaoshibao.qbank.v1` JSON Schema（`GET /api/import/schema.json`）与标准文本规范，支持 `.xlsx` / `.xls` / `.csv` / `.docx`（Word）/ `.pdf` / `.txt` / `.md` / `.json` / `.gift`（Moodle GIFT）与 Aiken 格式。
   - **左右分栏智能录题工作台**：左侧带行号标准文本编辑器，右侧实时预览标准考题卡片、自动区分阻塞错误与建议警告。
4. **DeepSeek / OpenAI 兼容 AI 引擎（管理员权限严格隔离）**：
   - **AI 异步建库（SSE 进度推送）**：将杂乱试卷、PDF 或讲义清洗为规范题库，自动补全解析与一键 AI 修复异常题。
   - **AI 一键深度讲题 & 智能评级 & 按主题出题**：刷题与交卷后可一键触发考点总结与记忆口诀，并支持难度/星级评级与均衡组卷。
   - **权限隔离**：全局 AI Key 与模型配置仅系统管理员可见与管理；普通成员仅可配置个人 Key（或使用管理员开启的共享额度）。
5. **全模式刷题、背题、自测与在线考试**：
   - 顺序续刷（记忆断点）、乱序出题、选项乱序、章节/题型/难度/星级筛选、背题模式、斩题过滤、收藏笔记、一键重刷及完成全套后自动重置进度与鼓励弹窗。
   - **自定义自测组卷**：随时从题库按题型配额与难度均衡抽题练习。
   - **在线考试与严格防作弊**：生成 8 位分享码、二维码分享、入场口令、限制作答次数、切屏/分屏/录屏监测与自动强制交卷。

---

## 一键部署到 Docker 服务器

```bash
# 1. 复制环境变量配置并修改数据库密码、域名与 JWT 密钥
cp .env.example .env

# 2. 启动 PostgreSQL 17 容器与棱题 · PrismQ 应用容器
docker compose up -d --build

# 3. 查看服务状态
docker compose ps
```

默认访问地址：`http://<服务器IP>:3000`（生产上线建议前置 OpenResty / Nginx 开启 HTTPS，配置参考 [deploy/nginx.conf.example](deploy/nginx.conf.example)）。

**首次启动说明**：系统不内置任何测试账号。首次打开页面时将引导创建第一个账号，**第一个注册的用户会自动成为系统管理员（admin）**，后续注册的用户均为普通成员（member）。

---

## Android 与微信小程序自建配置

- **Android 客户端**：构建前在 `android/gradle.properties` 或命令参数中传入 `-PPRISMQ_SERVER_URL=https://你的域名` 即可将端点编译并混淆加密进客户端。
- **微信小程序**：修改 `kaoshibao-miniprogram/project.config.json` 中的 `appid` 及 `kaoshibao-miniprogram/utils/config.js` 中的 `DEFAULT_BASE_URL` 后用微信开发者工具上传。

---

## 本地开发与自动化测试

```bash
npm install
npm run dev    # 未配置 DATABASE_URL 时自动使用本地 ./data/pglite
npm test       # 运行服务端与 API 自动化集成测试
npm run build  # 构建前端与服务端生产产物
```

Android 单元测试：

```bash
cd android
./gradlew testDebugUnitTest
```

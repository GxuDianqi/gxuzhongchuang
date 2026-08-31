# 部署 & 快速开始指南
> 广西大学众创空间 · 人工智能与机器人协会 招新网站
> 技术栈：**纯静态 HTML/CSS/JS（GitHub Pages 托管） + Supabase（Auth + Postgres DB） + 自定义域名**

---

## 🗂️ 项目结构
```
招新网站/
├── index.html              # 首页（协会简介、荣誉、优势、加入收获）
├── register.html           # 新生报名页（注册+提交报名信息）
├── login.html              # 邮箱登录页（新生/管理员通用）
├── admin.html              # 管理员审批后台
├── css/style.css           # 科技感主题样式
├── js/
│   ├── supabase-init.js    # ⭐ Supabase 连接配置（必须修改！）
│   ├── auth.js             # 首页导航栏登录态渲染
│   ├── auth.login.js       # 登录页逻辑
│   ├── register.js         # 报名提交逻辑
│   └── admin.js            # 审批后台逻辑
├── supabase/schema.sql     # ⭐ 数据库初始化 SQL（必须在 Supabase 执行！）
├── DEPLOYMENT.md           # 本文档
├── .gitignore
└── CNAME                   # 自定义域名占位（部署到 GitHub Pages 时会用到）
```

---

## ⏱️ 5 步快速上线

### 第 1 步：创建并配置 Supabase 项目（5-10 分钟）

1. 打开 [https://supabase.com/dashboard](https://supabase.com/dashboard)，登录或注册，点击 **New Project**
2. 填写项目名（如 `gzu-zhaoxin`），设置数据库密码，区域选 **Southeast Asia (Singapore)**（离国内近，延迟低），点 **Create new project**
3. 耐心等待初始化（约 2 分钟）→ 进入项目后：
   - 左侧菜单 **SQL Editor** → **New query**
   - 打开本项目根目录的 [supabase/schema.sql](./supabase/schema.sql)，**复制全部内容粘贴进去**，点 **Run** (▶)
   - 看到 `Success. No rows returned` 即建表 + RLS + 触发器全部完成 ✅
4. 复制连接信息（稍后要填到 `js/supabase-init.js`）：
   - 左侧菜单 **Project Settings**（⚙️齿轮图标） → **API**
   - 复制 `Project URL`（形如 `https://xxxx.supabase.co`）
   - 复制 `anon` `public` 密钥（**不要**复制 service_role key，那是后端用的，绝不能放前端）
5. 打开本项目 `js/supabase-init.js`，把两个占位符换成你自己的值：
   ```js
   const SUPABASE_URL      = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9......';
   ```
6. 配置邮箱认证（可选，**建议关闭邮箱确认**以便招新现场报名无阻塞）：
   - 左侧菜单 **Authentication** → **Providers** → **Email**
   - 关闭 **Confirm email**（Confirm signup email）开关 → Save
   - （可选）把 Site URL 改成未来上线的自定义域名，Redirect URLs 里也加上 `https://你的域名/**`

### 第 2 步：提升管理员权限

1. 先在前端 **报名页**（或 **登录页 → 忘记密码** 后登录）随便注册一个账号，作为管理员账号
2. 回到 Supabase 后台：
   - 方法 A（推荐，用 SQL）：
     - **Authentication** → **Users**，找到你自己，复制最左列的 **User UID**（UUID 格式如 `a1b2c3d4-xxxx-...`）
     - 打开 SQL Editor，执行：
       ```sql
       select public.set_admin('粘贴你的 UUID 到这里', true);
       ```
     - 看到 `1 row` 成功返回后，退出登录再重新登录 → 即可看到右上角出现 **🛡 审批后台** 入口
   - 方法 B（手动写 auth.users 表的 raw_app_meta_data 也行，但方法 A 更可靠）

### 第 3 步：推送到 GitHub + 开启 Pages

1. 在 GitHub 上新建一个仓库（推荐 Public，Pages 免费；Private 也行），比如 `gzu-zhaoxin-2025`
2. 回到本地项目目录，初始化 Git 并推送：
   ```bash
   # 进入项目目录
   cd "C:\Users\ASUS\Desktop\大创比赛\招新网站"

   git init
   git add .
   git commit -m "first commit: GDU AI/Robot recruitment site"
   git branch -M main

   # 把 USERNAME / REPO 改成你自己的
   git remote add origin https://github.com/USERNAME/gzu-zhaoxin-2025.git
   git push -u origin main
   ```
   *（如果你用 GitHub Desktop 也行，效果一样）*
3. 开启 GitHub Pages：
   - 打开仓库页 → **Settings** → 左侧 **Pages**
   - **Source** 选 `Deploy from a branch`
   - **Branch** 选 `main`，目录选 `/ (root)`，Save
   - 等 1-2 分钟刷新页面，顶部会出现绿色的 `Your site is live at https://USERNAME.github.io/gzu-zhaoxin-2025/`
   - ✅ 打开这个地址，首页应该已经可以正常展示。点击导航栏，各页面能跳转即 OK。

### 第 4 步：绑定自定义域名（可选，但项目要求）

两种常见情况：

#### 情形 A：你有一个顶级域名（例：`gzu-ai.club`），通过阿里云 / 腾讯云 / Cloudflare 购买
1. 在仓库 **Settings → Pages → Custom domain** 中输入你的域名（如 `www.gzu-ai.club` 或 `gzu-ai.club`），Save
2. 到你的域名 DNS 管理后台，添加解析：
   - 推荐用 `www` 子域：
     ```
     类型：CNAME
     主机记录：www
     记录值：USERNAME.github.io.   （注意末尾有个点）
     ```
   - 如果要裸域 `gzu-ai.club` 也能用，再添加 4 条 A 记录（GitHub Pages 官方 IP）：
     ```
     主机记录：@
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
3. 等待 DNS 生效（通常几分钟到几小时），在仓库 Pages 设置页 **勾选 Enforce HTTPS**（一定要勾，绿色 🔒）
4. 同步修改 `CNAME` 文件的内容为你的域名（一行即可，不带 https://），例如：
   ```
   www.gzu-ai.club
   ```
   这步是防止某些构建流水线覆盖了自定义域名设置。

#### 情形 B：没有域名？想先免费玩 → 直接用 `USERNAME.github.io/repo` 即可，跳过本步

### 第 5 步：别忘了告诉 Supabase 新域名

如果配置了自定义域名，去 Supabase 后台：
- **Authentication** → **URL Configuration** → Site URL：填写你的完整域名 `https://www.gzu-ai.club`
- **Redirect URLs**：添加两条
  - `https://www.gzu-ai.club/**`
  - `https://USERNAME.github.io/gzu-zhaoxin-2025/**`（方便本地/预发布测试）
- 这样登录、找回密码、邮件链接跳转都不会错。

---

## 💻 本地开发 / 预览

GitHub Pages 是纯静态的，**本地双击 index.html 就可以浏览**，但 Supabase 功能需要在 **localhost 服务器** 下才能生效（浏览器安全策略）。

最简单的本地服务器：
```bash
# 任选其一：
python -m http.server 8080          # 有 Python 的话
npx serve .                         # 有 Node.js 的话
# 然后打开 http://localhost:8080
```

---

## 🧪 自检清单（上线前建议逐项过）

- [ ] `js/supabase-init.js` 已填入真实的 URL 和 anon key（**不是** service_role）
- [ ] Supabase SQL Editor 已完整执行 [supabase/schema.sql](./supabase/schema.sql)
- [ ] **Authentication → Providers → Email** 中 Confirm email 按需关闭
- [ ] 自己的账号已经通过 `select set_admin(...)` 提升为管理员
- [ ] `login.html` → 登录成功后管理员自动跳 `admin.html`，普通用户跳首页
- [ ] `register.html` → 注册 → 报名成功 → 管理员端列表出现 pending 记录
- [ ] Admin 端：通过 / 拒绝 / 重置 生效，CSV 能下载
- [ ] （上线域名后）Supabase 的 Site URL / Redirect URLs 已更新
- [ ] GitHub Pages Settings 已开启 HTTPS，自定义域名显示 ✅ 绿色

---

## 🛠 常见问题

**Q1：打开网站后 Console 出现 `new HttpError 401 / Invalid API key`**
→ `SUPABASE_URL` 或 `ANON_KEY` 填错了，回到 Supabase → Project Settings → API 重新复制，注意 anon key ≠ service_role key。

**Q2：点击提交报名报 403 / `new row violates row-level security`**
→ SQL 没跑全。重新打开 [supabase/schema.sql](./supabase/schema.sql) 全部内容，SQL Editor 里重新跑一遍。

**Q3：管理员登录后还是看不到审批后台？**
→ 确认 `set_admin(...)` 的 SQL 执行成功，然后**退出再登录**一次（因为 app_metadata 在登录瞬间写入 Session）。
→ 检查 Admin 账号在 Supabase → Table Editor → `profiles` 表中 `is_admin` 为 `true`。

**Q4：邮箱注册后需要点确认邮件，太麻烦？**
→ 见第 1 步第 6 小步：Auth → Providers → Email → 关闭 Confirm email。

**Q5：手机端显示的 UI 有问题？**
→ 样式已经做了响应式，一般没问题；如果具体页面有 bug，提 issue 或改 `css/style.css` 的 `@media` 区块。

**Q6：自定义域名总是 `Unavailable for your site because your domain is not responding...`**
→ DNS 还没完全生效，等 1~24 小时；也可以用 `nslookup www.你的域名` 或 `dig www.你的域名 CNAME` 在命令行确认解析到 GitHub。

---

## 📞 需要帮忙？
- Supabase 官方文档：[https://supabase.com/docs](https://supabase.com/docs)
- GitHub Pages 文档：[https://docs.github.com/zh/pages](https://docs.github.com/zh/pages)

---

## ⏭️ 后续可扩展（如果想继续做）
1. 我的报名页（普通用户登录后查看自己的报名状态/历史）—— 前端加个 `my-application.html`，用 `user_id = auth.uid()` 查即可
2. 邮件通知：Supabase 内置 Edge Functions + Resend / SMTP，审批通过/拒绝自动发邮件
3. 扫码签到、面试评分、QQ群号配置：加一张 `settings` 表 + 简单管理页
4. SEO / 分享卡片：在 `<head>` 里加 OpenGraph meta
5. 主题色变量化：已经在 `:root` 中用 CSS 变量定义好，改一处全站生效

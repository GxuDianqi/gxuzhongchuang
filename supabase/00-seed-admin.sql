-- =====================================================================
-- 最高权限（超级管理员）账号 · 初始化脚本
-- 广西大学众创空间 · AI与机器人协会 招新网站
--
-- 【默认超级管理员身份（部署后请立即改密码）】
--     邮箱   :  admin@gxu-ai.club
--     临时密码:  Gxu@ZcSpace#2025Admin
--     昵称   :  系统超级管理员
--
-- 【使用方式】
--     ⚠️ 请务必先跑过 schema.sql（确保 profiles / set_admin 函数存在）
--     然后任选下面一种方式创建（推荐 方式A，100% 不翻车）
-- =====================================================================


-- =====================================================================
-- 方式 A · 最稳妥 推荐 （Supabase 后台点两下 + 一句 SQL）
-- =====================================================================
-- 步骤 1：
--   Supabase 后台 → Authentication → Users → 右上角 Add user → Create new user
--   填写：
--       Email Address  :  admin@gxu-ai.club
--       Password       :  Gxu@ZcSpace#2025Admin
--       ☑️ 勾选 "Auto confirm user?" （否则需要点邮箱确认链接）
--   点 Create user
--
-- 步骤 2：
--   在用户列表里找到刚创建的 admin@gxu-ai.club，点进去或复制 User UID（UUID 格式）
--
-- 步骤 3：
--   回到 SQL Editor，执行下面这句（把 UUID 换成你复制的）：
--
--       select public.set_admin('在这里粘贴刚才那个用户的UUID', true);
--
-- 示例：
--       select public.set_admin('a1b2c3d4-1234-5678-9abc-def012345678', true);
-- =====================================================================


-- =====================================================================
-- 方式 B · 纯 SQL 一键创建（最终修复版 ✅ 兼容所有 Supabase 版本，无 ON CONFLICT）
-- =====================================================================
-- 说明：Supabase 的 auth.users 表在 email 列上未必有单列 UNIQUE 约束（因版本而异），
--       所以直接用 ON CONFLICT(email) 可能报 SQLSTATE 42P10。这里改用 DO block
--       "先查再插"，完全不依赖约束结构；首次创建/重复执行都安全。
create extension if not exists "pgcrypto";

do $$
declare
    v_user_id uuid;
begin
    select id into v_user_id from auth.users where email = 'admin@gxu-ai.club';

    if v_user_id is null then
        insert into auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            is_super_admin,
            created_at,
            updated_at,
            last_sign_in_at,
            is_sso_user
        ) values (
            '00000000-0000-0000-0000-000000000000'::uuid,
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            'admin@gxu-ai.club',
            crypt('Gxu@ZcSpace#2025Admin', gen_salt('bf')),
            now(),
            jsonb_build_object('provider','email','providers',array['email'],'is_admin',true),
            jsonb_build_object('name','系统超级管理员','college','众创空间','major','技术委员会','grade','管理员'),
            false,
            now(), now(), now(), false
        ) returning id into v_user_id;
    end if;

    if v_user_id is not null then
        perform public.set_admin(v_user_id, true);
    end if;
end $$;

-- 验证：
--   select id, email, name, is_admin from public.profiles where email = 'admin@gxu-ai.club';


-- =====================================================================
-- 方式 C · 给一个已经存在的普通账号 加/减 管理员权限
-- =====================================================================
-- 提升：  select public.set_admin('那个用户的UUID', true);
-- 撤销：  select public.set_admin('那个用户的UUID', false);


-- =====================================================================
-- ✅ 验证：创建/提权后，确认管理员身份
-- =====================================================================
-- 执行下面这句，应该能看到你刚创建的管理员邮箱 + is_admin = t（true）
select id, email, name, is_admin, created_at
  from public.profiles
 where is_admin = true;

-- 也可以看 auth.users 里的元数据：
select id, email, raw_app_meta_data ->> 'is_admin' as admin_flag
  from auth.users
 where id in (select id from public.profiles where is_admin = true);


-- =====================================================================
-- 🔒 安全建议（强烈建议首次登录后做！）
-- =====================================================================
-- 1. 登录 admin@gxu-ai.club 后立即改密码：
--    登录页（login.html）→ 忘记密码 → 发到邮箱 → 改一个强密码
--    或 Supabase 后台 → Auth → Users → 点那个用户 → Reset password
--
-- 2. 不要把任何密码写进 Git / 本项目目录
--    .gitignore 已经默认忽略 .env / secret/ 等敏感目录
--
-- 3. 如需再创建其他管理员（如协会会长、技术负责人）：
--    让他们先在报名页或登录页正常注册账号
--    → 你作为超级管理员用上面 方式C 给他们 UUID 加 is_admin
--    → 所有管理员都能审批报名，但建议只给 2-3 人管理员权限，最小化风险
--
-- 4. 如果你不打算用 admin@gxu-ai.club 这个默认邮箱：
--    ↓ 下面一行，改成你自己的真实邮箱，再去方式A / B 执行即可
--    建议用协会官方邮箱（如 gxuzc@xxx.edu.cn）更正式。

-- ======================================================================
-- 广西大学众创空间 · AI与机器人协会 · 招新网站
-- Supabase 数据库初始化脚本
--
-- 使用方法：
--   1. 登录 https://supabase.com/dashboard 并进入你的 Project
--   2. 左侧菜单 → SQL Editor → New query
--   3. 复制本文件全部内容，粘贴后执行（Run / Ctrl+Enter）
--   4. 等待 "Success. No rows returned" 即完成
--
-- 数据库设计：
--   a) profiles          - 用户基础资料（与 auth.users 1:1，触发器自动创建）
--   b) registrations     - 报名表（每位新生提交的完整报名信息）
--   c) RLS 策略          - 严格行级安全：用户只能读/写自己的，管理员可读写全部
--   d) 管理员设置函数    - set_admin(uuid, boolean)
-- ======================================================================

-- ======================================================================
-- 1. 扩展
-- ======================================================================
create extension if not exists "pgcrypto";

-- ======================================================================
-- 2. profiles 表（与 auth.users 一对一映射）
-- ======================================================================
create table if not exists public.profiles (
    id              uuid primary key references auth.users(id) on delete cascade,
    email           text unique not null,
    name            text,
    gender          text,
    student_id      text,
    phone           text,
    college         text,
    major           text,
    grade           text,
    is_admin        boolean not null default false,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- RLS：用户只能看自己的；管理员可以看所有人
-- ⭐ 管理员判断统一用 auth.jwt() claims（app_metadata.is_admin），不查 profiles 表，
--    避免 "profiles 策略里再查 profiles" 触发无限递归（infinite recursion）
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
    for select using (
        auth.uid() = id
        or coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false) = true
    );

-- 用户可以更新自己的资料（管理员通过 service_role / RPC 修改 is_admin 字段不走这里）
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
    for update
    using (auth.uid() = id)
    with check (
        auth.uid() = id
        -- 普通用户绝不允许通过 update 擅自提升自己 is_admin
        and is_admin = (
            select coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false)
        )
    );


-- ======================================================================
-- 3. registrations 报名表
-- ======================================================================
create table if not exists public.registrations (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references auth.users(id) on delete cascade,

    -- 个人信息
    name                text not null,
    gender              text,
    student_id          text not null,
    phone               text not null,
    email               text not null,
    college             text not null,
    major               text not null,
    grade               text not null,

    -- 志愿方向
    first_department    text not null,
    second_department   text,

    -- 背景 / 动机
    skills              text,
    motivation          text not null,
    expectation         text,

    -- 审批状态
    status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
    review_note         text,
    reviewed_at         timestamptz,
    reviewer_id         uuid references auth.users(id) on delete set null,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_reg_status       on public.registrations(status);
create index if not exists idx_reg_user_id      on public.registrations(user_id);
create index if not exists idx_reg_first_dept   on public.registrations(first_department);
create index if not exists idx_reg_created_at   on public.registrations(created_at desc);

alter table public.registrations enable row level security;

-- 3.1 查询策略
--   · 普通用户：只能看自己的报名记录
--   · 管理员：  可以看全部（通过 auth.jwt() claims 里的 app_metadata.is_admin 判断，零表引用）
drop policy if exists "reg_select_self_or_admin" on public.registrations;
create policy "reg_select_self_or_admin" on public.registrations
    for select using (
        auth.uid() = user_id
        or coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false) = true
    );

-- 3.2 插入策略
--   · 已登录用户只能以自己的 user_id 插入
--   · 每个用户只能有 1 条 pending 记录（由触发器另行检查）
drop policy if exists "reg_insert_self" on public.registrations;
create policy "reg_insert_self" on public.registrations
    for insert with check (auth.uid() = user_id);

-- 3.3 更新策略
--   · 普通用户：只能更新自己 且 状态仍为 pending 的行；审批后禁止修改
--   · 管理员：  可以更新所有人的状态 / 备注 / 审批信息
--   说明：
--     USING      = 允许对哪些"现有行"发起 update（检查的是 UPDATE 前的值 / OLD）
--     WITH CHECK = 允许更新后的"结果行"是什么样（检查的是 UPDATE 后的值 / NEW）
drop policy if exists "reg_update_self_pending_or_admin" on public.registrations;
create policy "reg_update_self_pending_or_admin" on public.registrations
    for update using (
        -- USING：只有管理员 或 "自己+待审批" 的行才允许触碰
        coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false) = true
        or (auth.uid() = user_id and status = 'pending')
    )
    with check (
        case
            when coalesce((auth.jwt()->'app_metadata'->>'is_admin')::boolean, false) = true
            then true                         -- 管理员：所有字段 / 状态随便改
            else (
                -- 普通用户：结果行必须仍然是"自己 + 待审批 + 没动审批字段"
                auth.uid() = user_id
                and status = 'pending'
                and review_note is null
                and reviewed_at is null
                and reviewer_id is null
            )
        end
    );


-- ======================================================================
-- 4. 触发器：注册时自动生成 profile；限制每人仅一条报名待审批
-- ======================================================================

-- 4.1 auth.users → profiles 自动同步（邮箱 + signup 时的 raw_user_meta_data）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email, name, student_id, phone, college, major, grade, is_admin)
    values (
        new.id,
        new.email,
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'student_id',
        new.raw_user_meta_data ->> 'phone',
        new.raw_user_meta_data ->> 'college',
        new.raw_user_meta_data ->> 'major',
        new.raw_user_meta_data ->> 'grade',
        coalesce((new.raw_app_meta_data ->> 'is_admin')::boolean, false)
    )
    on conflict (id) do update
    set
        email       = excluded.email,
        name        = coalesce(excluded.name,           public.profiles.name),
        student_id  = coalesce(excluded.student_id,     public.profiles.student_id),
        phone       = coalesce(excluded.phone,          public.profiles.phone),
        college     = coalesce(excluded.college,        public.profiles.college),
        major       = coalesce(excluded.major,          public.profiles.major),
        grade       = coalesce(excluded.grade,          public.profiles.grade),
        updated_at  = now();
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 4.2 用户 meta_data 变更时同步 profiles
create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    update public.profiles
    set
        is_admin   = coalesce((new.raw_app_meta_data ->> 'is_admin')::boolean, public.profiles.is_admin),
        updated_at = now()
    where id = new.id;
    return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
    after update on auth.users
    for each row
    when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
    execute function public.handle_user_updated();

-- 4.3 每人仅允许一条 pending（且对已审核通过的不再允许插入同邮箱新 pending）
create or replace function public.check_registration_duplicate()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    if exists (
        select 1 from public.registrations
        where user_id = new.user_id and status = 'pending'
    ) then
        raise exception '你已经有一条待审批的报名了，请耐心等待审核。';
    end if;
    if exists (
        select 1 from public.registrations
        where (user_id = new.user_id or email = new.email or student_id = new.student_id)
          and status = 'approved'
    ) then
        raise exception '该账号/邮箱/学号已通过报名，请不要重复提交。';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_reg_before_insert on public.registrations;
create trigger trg_reg_before_insert
    before insert on public.registrations
    for each row execute function public.check_registration_duplicate();

-- 4.4 自动更新 updated_at
create or replace function public.trigger_set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end; $$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
    for each row execute function public.trigger_set_updated_at();

drop trigger if exists set_reg_updated_at on public.registrations;
create trigger set_reg_updated_at before update on public.registrations
    for each row execute function public.trigger_set_updated_at();


-- ======================================================================
-- 5. 管理员设置（安全定义函数，只有 postgres / service_role 才能执行）
--    用法：select public.set_admin('用户的 auth.users id 如 a1b2c3...', true);
-- ======================================================================
create or replace function public.set_admin(p_user_id uuid, p_admin boolean default true)
returns void language plpgsql security definer set search_path = public
as $$
declare
    v_email text;
    v_name  text;
begin
    -- 0) 先从 auth.users 取基础信息（即使 profiles 里还没这行也能 insert）
    select email,
           coalesce(raw_user_meta_data->>'name', split_part(email, '@', 1))
      into v_email, v_name
      from auth.users
     where id = p_user_id;

    if v_email is null then
        raise exception '用户 % 不存在于 auth.users，无法设为管理员', p_user_id;
    end if;

    -- 1) profiles 表：有就 UPDATE，没有就 INSERT（upsert，兼容任何创建顺序）
    insert into public.profiles (id, email, name, is_admin, created_at, updated_at)
    values (p_user_id, v_email, v_name, p_admin, now(), now())
    on conflict (id) do update
        set is_admin   = p_admin,
            updated_at = now(),
            email      = excluded.email,
            name       = coalesce(excluded.name, public.profiles.name);

    -- 2) 同步写回 auth.users 的 app_metadata，供前端 app_metadata 快速判断
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('is_admin', p_admin),
           updated_at = now()
     where id = p_user_id;
end;
$$;

revoke all on function public.set_admin(uuid, boolean) from public;
revoke all on function public.set_admin(uuid, boolean) from anon;
revoke all on function public.set_admin(uuid, boolean) from authenticated;

comment on function public.set_admin(uuid, boolean) is
'仅限 postgres/service_role 调用。用法：select public.set_admin(''uuid-of-user'', true);';


-- ======================================================================
-- 6. 给已认证用户一些基础 grants（RLS 是真正的守门员，这里只是让默认有调用权）
-- ======================================================================
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on table public.profiles      to postgres, service_role;
grant all on table public.registrations to postgres, service_role;
grant select, insert, update            on table public.profiles      to authenticated;
grant select, insert, update, delete    on table public.registrations to authenticated;
grant select                            on table public.profiles      to anon;
grant insert                            on table public.registrations to anon;  -- 其实 RLS 会拦，仅防 signUp 时序问题

-- ======================================================================
-- 7. Seed 示例：把以下 id 改成你自己注册后 auth.users 的 id，然后再单独执行
--    （先登录一次，然后在 Table Editor → auth.users 里复制自己的 id）
-- ======================================================================
-- select public.set_admin('在这里替换为你的 auth.users id (uuid格式)', true);

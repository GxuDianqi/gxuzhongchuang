/* ================================================================
 * supabase-init.js — Supabase 初始化与全局配置
 *
 * 【使用步骤】
 * 1. 在 https://supabase.com/dashboard 新建一个 Project
 * 2. 进入 Project Settings → API，复制 URL 和 anon key
 * 3. 粘贴到下方 SUPABASE_URL 和 SUPABASE_ANON_KEY 处
 * 4. 在 Supabase SQL Editor 中运行 supabase/schema.sql 初始化数据库
 *
 * 【说明】
 *  - anon key 放在前端是安全的（Supabase 官方推荐做法），RLS 会严格过滤访问
 *  - 邮箱注册默认需要邮箱确认链接，可在 Auth → Providers → Email 中关闭确认
 * ================================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// =============== ⬇️ 请在这里填入你的 Supabase 信息 ⬇️ ===============
const SUPABASE_URL = 'https://xiyaelfbkjnukfeipcwv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wzhfQrUfJ5RYCe5VrmHapA_pSId_AFI';
// =============== ⬆️ 请在这里填入你的 Supabase 信息 ⬆️ ===============

if (SUPABASE_URL === 'https://your-project-ref.supabase.co') {
  console.warn(
    '%c[Supabase] ⚠️ 未配置 SUPABASE_URL！请编辑 js/supabase-init.js',
    'color:#f59e0b;font-weight:bold;font-size:14px;'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});

// ======== 辅助工具 ========
export const STATUS_LABEL = {
  pending: { text: '待审批', cls: 'status-pending' },
  approved: { text: '已通过', cls: 'status-approved' },
  rejected: { text: '已拒绝', cls: 'status-rejected' },
};

export function showAlert(el, type, msg) {
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
  // 6 秒后自动消失（错误类型不自动消失）
  if (type !== 'error') {
    setTimeout(() => {
      el.classList.remove('show');
    }, 6000);
  }
}

export function hideAlert(el) {
  if (el) el.classList.remove('show');
}

export function setLoading(btn, loading, text) {
  if (!btn) return;
  if (loading) {
    btn.dataset.prevText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${text || '处理中...'}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.prevText || text || '提交';
  }
}

// ===== 用户角色判断 =====
// 管理员需在 Supabase 后台 auth.users 的 raw_app_meta_data 中设置 is_admin = true
// 也可通过 profiles 表的 is_admin 字段判断
export async function isCurrentUserAdmin() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    // 1) 优先判断 auth 元数据
    if (user.app_metadata && user.app_metadata.is_admin === true) return true;
    // 2) 再查 profiles 表
    const { data } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    return !!(data && data.is_admin === true);
  } catch (e) {
    console.error('isCurrentUserAdmin error:', e);
    return false;
  }
}

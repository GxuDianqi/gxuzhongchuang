/* ================================================================
 * supabase-init.js — Supabase 初始化与全局配置
 * ================================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// =============== ⬇️ Supabase 信息 ⬇️ ===============
const SUPABASE_URL = 'https://xiyaelfbkjnukfeipcwv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_wzhfQrUfJ5RYCe5VrmHapA_pSId_AFI';
// =============== ⬆️ Supabase 信息 ⬆️ ===============

if (SUPABASE_URL === 'https://your-project-ref.supabase.co') {
  console.warn('%c[Supabase] ⚠️ 未配置 SUPABASE_URL！', 'color:#f59e0b;font-weight:bold;font-size:14px;');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: 'sessionOnly',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ======== 状态标签映射 ========
export const STATUS_LABEL = {
  pending:  { text: '待审批', cls: 'status-pending'  },
  approved: { text: '已通过', cls: 'status-approved' },
  rejected: { text: '已拒绝', cls: 'status-rejected' },
};

// ======== 工具：hideAlert / setLoading / showAlert（innerHTML 版） ========
export function hideAlert(el) {
  if (!el) el.classList.remove('show');
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

/**
 * showAlert · 统一提示条（支持 HTML 渲染，自动关闭按类型区分）
 * ⚠️ msg 必须是内部可信字符串（避免 XSS）
 * @param {HTMLElement} el
 * @param {'success'|'error'|'info'} type
 * @param {string} msg HTML 字符串
 * @param {number} [autoCloseMs] 0=永不自动关闭
 */
export function showAlert(el, type, msg, autoCloseMs) {
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.innerHTML = msg;
  const ms = autoCloseMs ?? (type === 'error' ? 0 : (type === 'success' ? 5500 : 8000));
  if (ms > 0) {
    clearTimeout(el._autoCloseTimer);
    el._autoCloseTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
}

// ======== 用户角色判断 ========
// 双重判断：1) app_metadata.is_admin (JWT 声明，优先且无 RLS 依赖)
//           2) profiles.is_admin 兜底
export async function isCurrentUserAdmin() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    if (user?.app_metadata && typeof user.app_metadata.is_admin === 'boolean') {
      return user.app_metadata.is_admin === true;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();
      if (!error && data && typeof data.is_admin === 'boolean') {
        return data.is_admin === true;
      }
    } catch (_) {}
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * 获取当前用户的管理员类型信息
 * @returns {Promise<{is_super_admin:boolean, is_admin:boolean, association_admin:string|null}>}
 */
export async function getCurrentAdminType() {
  try {
    const { data, error } = await supabase.rpc('get_current_admin_type');
    if (error) throw error;
    return data || { is_super_admin: false, is_admin: false, association_admin: null };
  } catch (_) {
    return { is_super_admin: false, is_admin: false, association_admin: null };
  }
}

// ======== 兼容 ES Module 隔离：显式挂到 window ========
window.supabase          = supabase;
window.STATUS_LABEL      = STATUS_LABEL;
window.showAlert         = showAlert;
window.hideAlert         = hideAlert;
window.setLoading        = setLoading;
window.isCurrentUserAdmin = isCurrentUserAdmin;
window.getCurrentAdminType = getCurrentAdminType;

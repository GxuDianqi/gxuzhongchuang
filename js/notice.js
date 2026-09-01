/* ========================================================
 * notice.js — 全站公告展示
 * 从数据库加载活跃公告，显示在首页顶部横幅
 * 所有登录用户可见，点击 × 可关闭（本次会话不重复显示）
 * ======================================================== */
import { supabase } from './supabase-init.js';

const BANNER_STORAGE_KEY = 'notice_dismissed_at';
const MAX_NOTICES = 3;

function fmt(iso) {
  try { return iso ? new Date(iso).toLocaleString('zh-CN') : ''; } catch { return ''; }
}

export async function loadAndRenderNotices() {
  const wrap = document.getElementById('notice-banner-wrap');
  if (!wrap) return;

  // 本次会话已关闭 → 不重复显示
  const dismissed = sessionStorage.getItem(BANNER_STORAGE_KEY);
  if (dismissed === '1') return;

  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, content, published_by, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(MAX_NOTICES);

    if (error || !data || data.length === 0) return;

    renderBanner(data);
    wrap.style.display = 'block';
  } catch (e) {
    console.error('[公告] 加载失败:', e);
  }
}

function renderBanner(notices) {
  if (notices.length === 0) return;

  const titleEl   = document.getElementById('notice-banner-title');
  const contentEl = document.getElementById('notice-banner-content');
  const metaEl    = document.getElementById('notice-banner-meta');
  if (!titleEl || !contentEl) return;

  // 只展示最新一条（滚动查看更多可在后续版本扩展）
  const latest = notices[0];
  titleEl.textContent  = latest.title || '公告';
  contentEl.innerHTML  = escapeHtml(latest.content || '');
  metaEl.textContent   = `发布于 ${fmt(latest.created_at)}`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 关闭按钮
const closeBtn = document.getElementById('notice-banner-close');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    const wrap = document.getElementById('notice-banner-wrap');
    if (wrap) wrap.style.display = 'none';
    sessionStorage.setItem(BANNER_STORAGE_KEY, '1');
  });
}

// 登录状态变化时刷新
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) loadAndRenderNotices();
});

// 初始加载
loadAndRenderNotices();

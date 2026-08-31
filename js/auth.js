/* ========================================================
 * auth.js — 首页导航栏的用户状态渲染 & 登出
 * ======================================================== */
import { supabase, isCurrentUserAdmin } from './supabase-init.js';

const navRight = document.getElementById('nav-right-links');
const navUser = document.getElementById('nav-user');
const userEmailEl = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');

async function renderAuthUI() {
  if (!navRight || !navUser) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    navRight.style.display = '';
    navUser.style.display = 'none';
    return;
  }

  // 已登录
  navRight.style.display = 'none';
  navUser.style.display = 'flex';
  userEmailEl.textContent = user.email;

  // 如果是管理员，追加后台入口
  const admin = await isCurrentUserAdmin();
  if (admin && navRight) {
    // 在导航栏添加 审批后台 链接
    const ul = document.querySelector('.nav-links');
    if (ul && !document.getElementById('nav-admin-link')) {
      const li = document.createElement('li');
      li.id = 'nav-admin-link';
      li.innerHTML = '<a href="admin.html" style="color:var(--accent-gold);">🛡 审批后台</a>';
      // 插到最后一个 (登录按钮之前)
      ul.insertBefore(li, ul.lastElementChild);
    }
  }
}

if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

// 初始渲染
renderAuthUI();

// 监听登录状态变化
supabase.auth.onAuthStateChange(() => renderAuthUI());

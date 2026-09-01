/* ========================================================
 * auth.js — 首页导航栏的用户状态渲染 & 登出
 *         + 所有「报名」入口按钮 按登录态动态切换文案/链接
 *         + 已登录用户的「🔐 修改密码」入口（发送邮箱确认邮件）
 * ======================================================== */
import { supabase, isCurrentUserAdmin, showAlert } from './supabase-init.js';

const navRight = document.getElementById('nav-right-links');
const navUser = document.getElementById('nav-user');
const userEmailEl = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');
const btnSetPwd = document.getElementById('btn-set-pwd');

// 首页所有「报名」入口按钮 id（每个页面加载时只修改存在的，不存在跳过）
const CTA_BTN_IDS = ['nav-cta-btn', 'hero-cta-btn', 'footer-cta-btn'];

// 根据登录态更新 3 个报名 CTA 按钮：
//   未登录 → 跳 login.html?redirect=register.html，文案「🔐 登录后报名」
//   已登录 → 直接跳 register.html，文案「📝 填写报名表」
function applyCtaButtons(loggedIn) {
  for (const id of CTA_BTN_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    if (loggedIn) {
      btn.href      = 'register.html';
      btn.innerHTML = (id === 'hero-cta-btn') ? '🚀 填写报名表加入'
                    : (id === 'nav-cta-btn')  ? '填写报名表'
                    : '📝 填写报名表';
    } else {
      btn.href      = 'login.html?redirect=' + encodeURIComponent('register.html');
      btn.innerHTML = (id === 'hero-cta-btn') ? '🔐 登录后报名'
                    : (id === 'nav-cta-btn')  ? '登录后报名'
                    : '🔐 先登录再填写表单';
    }
  }
}

// ---------- 已登录用户：点击「修改密码」→ 直接跳独立密码管理页 change-password.html ----------
// （密码管理页会校验登录态 + 已确认邮箱，再直接调用 updateUser({password})，不走邮件中转）
if (btnSetPwd) {
  btnSetPwd.addEventListener('click', () => {
    location.href = 'change-password.html';
  });
}

async function renderAuthUI() {
  const { data: { user } } = await supabase.auth.getUser();
  const loggedIn = !!user;

  // 3 个报名 CTA 先更新（哪怕当前页面不是首页，也不影响——找不到元素就跳过）
  applyCtaButtons(loggedIn);

  if (!navRight || !navUser) return;

  if (!loggedIn) {
    navRight.style.display = '';
    navUser.style.display = 'none';
    return;
  }

  // 已登录
  navRight.style.display = 'none';
  navUser.style.display = 'inline-flex';
  userEmailEl.textContent = user.email;

  // 如果是管理员，追加后台入口
  const admin = await isCurrentUserAdmin();
  if (admin) {
    const ul = document.querySelector('.nav-links');
    if (ul && !document.getElementById('nav-admin-link')) {
      const li = document.createElement('li');
      li.id = 'nav-admin-link';
      li.innerHTML = '<a href="admin.html" style="color:var(--accent-gold);">🛡 审批后台</a>';
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

// ======== 兼容：把 main.js 依赖的 3 个接口挂到 window（否则 ES module 隔离后，main.js 拿不到） ========
window.CTA_BTN_IDS = CTA_BTN_IDS;
window.applyCtaButtons = applyCtaButtons;
window.isCurrentUserLoggedIn = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return !!user;
  } catch (_) {
    return false;
  }
};

/* ============================================================
   广西大学众创空间 · 招新官网 · 前端交互主脚本
   功能：
   1) Canvas 粒子背景（科技感连线粒子）
   2) 滚动视差（背景 / Hero 细微偏移）
   3) 一级 Tab 切换（众创首页 / 三大中心 / 五大协会 / 招新 / 关于）
   4) 二级胶囊 Tab 切换（三大中心 3 个 & 五大协会 5 个，带 slide+扫描线）
   5) 全息架构图节点点击联动（跳指定一级+二级Tab）
   6) URL Hash 联动（打开 URL 带 #centers/#associations 自动切过去）
   7) 面包屑动态更新
   8) 扩展 CTA 按钮登录态同步（signup 区那两个按钮）
   ============================================================ */

(() => {
  'use strict';

  /* -------------------- 0. DOM Ready 后启动 -------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  function bootstrap() {
    initParticles();
    initParallax();
    initBreadcrumb();
    initLevel1Tabs();
    initLevel2Tabs();
    initHoloNodes();
    initHashRouting();
    extendCTAButtonSync();
  }

  /* -------------------- 1. Canvas 粒子背景 -------------------- */
  function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let width = 0;
    let height = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * DPR;
      canvas.height = height * DPR;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      // 根据屏幕大小决定粒子数
      const count = Math.min(140, Math.round((width * height) / 14000));
      particles = new Array(count).fill(0).map(() => ({
        x:  Math.random() * width,
        y:  Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r:  Math.random() * 1.3 + 0.4,
        a:  Math.random() * 0.5 + 0.2,
      }));
    }

    function step() {
      ctx.clearRect(0, 0, width, height);
      const LINK_DIST = 130;

      // 更新 & 画点
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width)  p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(3, 252, 254, ${p.a})`;
        ctx.fill();
      }

      // 画连接线（相近距离的粒子连细线）
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.35;
            ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(step);
    }

    window.addEventListener('resize', resize);
    resize();
    step();
  }

  /* -------------------- 2. 滚动视差 -------------------- */
  function initParallax() {
    const hero = document.querySelector('.hero-inner');
    const canvas = document.getElementById('particle-canvas');
    let ticking = false;
    function update() {
      const y = window.scrollY || window.pageYOffset || 0;
      if (canvas) canvas.style.transform = `translateY(${y * 0.18}px)`;
      if (hero)   hero.style.transform   = `translateY(${y * 0.08}px)`;
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  /* -------------------- 3. 面包屑 & 文字映射 -------------------- */
  const L1_MAP = {
    home:         '众创首页',
    centers:      '三大中心',
    associations: '五大协会',
    signup:       '招新报名',
    about:        '关于我们',
  };
  const L2_CENTER_MAP = {
    management: '管理中心',
    innovation: '创新创业中心',
    popular:    '科普实践中心',
  };
  const L2_ASS_MAP = {
    air:         '人工智能与机器人协会',
    geek:        '奇客电子协会',
    powergrid:   '电力系统与智能电网协会',
    electronics: '电力电子爱好者协会',
    iot:         '物联网与虚拟仪器协会',
  };
  let currentL1 = 'home';
  let currentL2 = { centers:'management', associations:'air' };

  function initBreadcrumb() {
    // 默认显示首页
    updateBreadcrumb();
  }
  function updateBreadcrumb() {
    const l1El  = document.getElementById('crumb-level1');
    const l2El  = document.getElementById('crumb-level2');
    const sepEl = document.querySelector('.crumb-sep-level2');
    if (!l1El || !l2El) return;

    if (currentL1 === 'home') {
      // 首页：只显示「🏠 众创首页」，二级隐藏
      l1El.textContent = '';
      l2El.style.display = 'none';
      if (sepEl) sepEl.style.display = 'none';
      return;
    }

    l1El.textContent = L1_MAP[currentL1] || '';
    l1El.style.display = 'inline';

    if ((currentL1 === 'centers' || currentL1 === 'associations') && currentL2[currentL1]) {
      const l2Name = currentL1 === 'centers' ? L2_CENTER_MAP[currentL2.centers] : L2_ASS_MAP[currentL2.associations];
      l2El.textContent = l2Name || '';
      l2El.style.display = 'inline';
      if (sepEl) sepEl.style.display = 'inline';
    } else {
      l2El.style.display = 'none';
      if (sepEl) sepEl.style.display = 'none';
    }
  }

  /* -------------------- 4. 扫描线触发 -------------------- */
  function triggerScanline() {
    const el = document.getElementById('scanline');
    if (!el) return;
    el.classList.remove('animate');
    // 强制重绘
    void el.offsetWidth;
    el.classList.add('animate');
    setTimeout(() => el.classList.remove('animate'), 950);
  }

  /* -------------------- 5. 一级 Tab 切换 -------------------- */
  function initLevel1Tabs() {
    const links = document.querySelectorAll('.level1-link');
    links.forEach(a => {
      a.addEventListener('click', (e) => {
        const target = a.getAttribute('data-target');
        if (!target) return;   // 锚点不带 data-target 就跳过（普通跳转）
        e.preventDefault();
        switchLevel1(target);
      });
    });
  }

  function switchLevel1(target, opts = {}) {
    if (!L1_MAP[target]) return;
    currentL1 = target;

    // --- 更新导航高亮 ---
    document.querySelectorAll('.level1-link').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-target') === target);
    });

    // --- section 切换显示 ---
    const sections = document.querySelectorAll('.page-section');
    sections.forEach(sec => {
      sec.classList.toggle('active', sec.id === target);
      // 重置动画
      if (sec.id === target) {
        sec.style.animation = 'none';
        void sec.offsetHeight;
        sec.style.animation = '';
      }
    });

    // --- 切换后默认激活第一个二级 Tab ---
    if (target === 'centers')      switchLevel2('centers', currentL2.centers,      {silent: true});
    if (target === 'associations') switchLevel2('associations', currentL2.associations, {silent: true});

    // --- 触发扫描线 & 回顶 ---
    if (!opts.noScan) triggerScanline();
    if (!opts.noScroll) window.scrollTo({top: 0, behavior: 'smooth'});

    // --- 同步 hash（不触发 hashchange，防止循环）---
    if (window.location.hash !== `#${target}`) {
      history.replaceState(null, '', `#${target}`);
    }

    // --- 面包屑 ---
    updateBreadcrumb();
  }

  /* -------------------- 6. 二级胶囊 Tab 切换 -------------------- */
  function initLevel2Tabs() {
    // 三大中心
    document.querySelectorAll('#center-tabs .capsule-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-target');
        if (id) switchLevel2('centers', id);
      });
    });
    // 五大协会
    document.querySelectorAll('#ass-tabs .capsule-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-target');
        if (id) switchLevel2('associations', id);
      });
    });
  }

  function switchLevel2(group, id, opts = {}) {
    const tabsWrapId = group === 'centers' ? '#center-tabs' : '#ass-tabs';
    const panelsWrapId = group === 'centers' ? '#center-panels' : '#ass-panels';
    const L2_MAP = group === 'centers' ? L2_CENTER_MAP : L2_ASS_MAP;

    if (!L2_MAP[id]) return;
    currentL2[group] = id;

    // 高亮按钮
    document.querySelectorAll(`${tabsWrapId} .capsule-tab`).forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-target') === id);
    });
    // 切换面板
    const panels = document.querySelectorAll(`${panelsWrapId} .tab-panel`);
    panels.forEach(panel => {
      const match = panel.getAttribute('data-id') === id;
      panel.classList.toggle('active', match);
      if (match) {
        panel.style.animation = 'none';
        void panel.offsetHeight;
        panel.style.animation = '';
      }
    });

    if (!opts.silent) {
      triggerScanline();
      window.scrollTo({top: document.querySelector('.page-section.active')?.offsetTop - 70 || 0, behavior: 'smooth'});
    }
    updateBreadcrumb();
  }

  /* -------------------- 7. 全息节点点击（跳一级+二级联动） -------------------- */
  function initHoloNodes() {
    document.querySelectorAll('.holo-node').forEach(node => {
      node.addEventListener('click', (e) => {
        e.preventDefault();
        const l1 = node.getAttribute('data-goto-level1');
        const l2 = node.getAttribute('data-goto-level2');
        if (!l1) return;
        currentL2[l1] = l2 || currentL2[l1];
        switchLevel1(l1, { noScan: true });
        // 一级切换后会重置二级到默认值，所以我们要显式切一次 l2（如果指定）
        if (l2) setTimeout(() => switchLevel2(l1, l2), 50);
      });
    });
  }

  /* -------------------- 8. Hash 路由（打开含 hash 的 URL 自动切页面） -------------------- */
  function initHashRouting() {
    function handleHash() {
      const hash = (window.location.hash || '').replace('#','').trim();
      if (!hash) return;
      if (L1_MAP[hash]) switchLevel1(hash, { noScan: true, noScroll: true });
    }
    window.addEventListener('hashchange', handleHash);
    // 首次
    handleHash();
  }

  /* -------------------- 9. 扩展 auth.js 的 CTA 按钮同步（新增的两个报名按钮） -------------------- */
  function extendCTAButtonSync() {
    // auth.js 定义了全局数组 CTA_BTN_IDS + 函数 applyCtaButtons(loggedIn)
    // 我们把 signup 区新增的两个按钮也加进去，并覆盖它们的文案策略
    if (typeof window.CTA_BTN_IDS !== 'undefined') {
      window.CTA_BTN_IDS.push('hero-secondary-cta-btn', 'hero-fill-cta-btn');
    }
    // 覆写 applyCtaButtons，在原逻辑后追加处理 signup 区按钮
    if (typeof window.applyCtaButtons === 'function') {
      const orig = window.applyCtaButtons;
      window.applyCtaButtons = function applyCtaButtonsExtended(loggedIn) {
        orig(loggedIn);
        const secondary = document.getElementById('hero-secondary-cta-btn');
        const fillForm  = document.getElementById('hero-fill-cta-btn');
        if (loggedIn) {
          if (secondary) {
            secondary.textContent = '🚀 直接填写报名表';
            secondary.setAttribute('href', 'register.html');
          }
          if (fillForm) {
            fillForm.textContent = '📋 打开报名表页面';
            fillForm.setAttribute('href', 'register.html');
            fillForm.classList.remove('btn-outline');
            fillForm.classList.add('btn-primary');
          }
        } else {
          if (secondary) {
            secondary.textContent = '🔐 登录后报名';
            secondary.setAttribute('href', 'login.html?redirect=register.html');
          }
          if (fillForm) {
            fillForm.textContent = '📋 已登录？直接填写报名表';
            fillForm.setAttribute('href', 'register.html');
            fillForm.classList.remove('btn-primary');
            fillForm.classList.add('btn-outline');
          }
        }
      };
      // 立即重新触发一次，因为 auth.js 在 main.js 之前已经调用过了一次 applyCtaButtons
      if (typeof window.isCurrentUserLoggedIn === 'function') {
        window.isCurrentUserLoggedIn()
          .then((yn) => window.applyCtaButtons(yn))
          .catch(() => window.applyCtaButtons(false));
      }
    }
  }
})();

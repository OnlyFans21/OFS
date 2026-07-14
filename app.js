/**
 * APP.JS - Complete Application Logic
 * PRODUCTION VERSION - Manual payments only (Gift Card, BTC, USDT)
 * VERSION: 1.0.16 - VIP upload FileReader fix + clean console
 */

const APP_VERSION = '1.0.16';
console.log('%c[APP] Version ' + APP_VERSION + ' loaded', 'background:#6366f1;color:#fff;padding:4px 12px;border-radius:4px;font-weight:bold');

const CREATOR_ACCESS_PASSWORD = 'onlyfans2173';
const OWNER_ACCESS_PASSWORD = 'chibueza12$';

function debounce(fn, ms) { let t; return function() { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); }; }

const App = {
    currentView: 'landing', viewHistory: [], creatorId: null, postId: null,
    vipId: null, roomId: null, plan: null, gcType: 'razer', uploadQueue: [],
    vipFile: null, payTarget: null, postToDelete: null, paymentToAction: null,
    realtimeChannels: [], _paymentRealtime: null, _msgRealtime: null,

    async init() {
        console.log('[APP] Starting...');

        // ENVIRONMENT DIAGNOSTICS - log on every startup
        console.log('%c[ENV] ========== ENVIRONMENT DIAGNOSTICS ==========', 'color:#f59e0b;font-weight:bold');
        console.log('[ENV] APP_VERSION:', APP_VERSION);
        console.log('[ENV] window.location.origin:', window.location.origin);
        console.log('[ENV] window.location.protocol:', window.location.protocol);
        console.log('[ENV] window.location.hostname:', window.location.hostname);
        console.log('[ENV] User-Agent:', navigator.userAgent.substring(0, 60));
        console.log('[ENV] Online:', navigator.onLine);

        initSupabase();

        // Log Supabase config after init
        try {
            console.log('[ENV] SUPABASE_URL:', SUPABASE_URL);
            console.log('[ENV] Bucket name:', 'videos');
        } catch (e) {}

        if (!getSb()) { this.toast('Connection failed', 'error', 5000); return; }

        // Test storage connectivity (non-destructive)
        try {
            const client = getSb();
            const { data: buckets, error: bucketErr } = await client.storage.listBuckets();
            if (bucketErr) {
                console.log('[ENV] Storage listBuckets ERROR:', bucketErr.message, '- This usually means CORS is blocking the request from', window.location.origin);
            } else {
                const videoBucket = buckets?.find(b => b.name === 'videos' || b.id === 'videos');
                console.log('[ENV] Storage connected. buckets found:', buckets?.length);
                console.log('[ENV] videos bucket:', videoBucket ? 'EXISTS (public=' + videoBucket.public + ')' : 'NOT FOUND');
            }
        } catch (storageTestErr) {
            console.log('[ENV] Storage connectivity TEST FAILED:', storageTestErr.message);
            console.log('[ENV] If you see a CORS or fetch error above, the Supabase project is blocking requests from', window.location.origin);
            console.log('[ENV] FIX: Go to Supabase Dashboard > Storage > Policies > CORS and add:', window.location.origin);
        }

        await Auth.init();
        const saved = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
        const themeIcon = saved === 'dark' ? 'fa-sun' : 'fa-moon';
        document.querySelectorAll('#themeIcon, #themeIconFeed').forEach(i => { if (i) i.className = 'fas ' + themeIcon; });
        const params = new URLSearchParams(window.location.search);
        const username = params.get('u');
        if (username) {
            try { const p = await DB.getProfileByUsername(username); if (p) { this.creatorId = p.id; this.go('creator-profile'); } else this.go(Auth.isAuth() ? 'feed' : 'landing'); }
            catch (e) { this.go(Auth.isAuth() ? 'feed' : 'landing'); }
        } else if (Auth.isAuth()) { this.go('feed'); this.updateNav(); }
        // Periodic badge expiry check (every 5 minutes)
        setInterval(() => { try { DB.checkAndExpireBadges(); } catch (e) {} }, 300000);
        // Periodic subscription expiry check (every 2 minutes)
        setInterval(() => { try { DB.expireOldSubscriptions(); } catch (e) {} }, 120000);
        // Periodic VIP purchase expiry check (every 2 minutes)
        setInterval(() => { try { DB.expireOldVipPurchases(); } catch (e) {} }, 120000);
        // Init notification realtime
        setTimeout(() => { try { this.initNotifRealtime(); this.updateNotifBadge(); } catch (e) {} }, 1000);
            // Init online status tracking
        this.initOnlineTracking();
        setTimeout(() => { const pre = document.getElementById('preloader'); if (pre) pre.classList.add('hidden'); }, 500);
        console.log('[APP] Ready');
    },

    // ===================== ONLINE STATUS TRACKING =====================
    _onlineHeartbeat: null,
    _lastOnlinePing: 0,
    _isCurrentlyOnline: false,

    initOnlineTracking() {
        // Mark online once on init
        if (Auth.isAuth()) this.markOnline();
        // Heartbeat: ping every 60 seconds (reduced from 30 to lower network load)
        this._onlineHeartbeat = setInterval(() => {
            if (Auth.isAuth() && !document.hidden) this.markOnline();
        }, 60000);
        // Handle tab visibility: come back online when tab visible
        // Do NOT mark offline on tab hide — the auto-offline function handles that after 2 min
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.markOnline();
        });
        // Before closing: queue synchronous offline update
        window.addEventListener('beforeunload', () => {
            if (Auth.isAuth()) DB.queueOfflineUpdate(Auth.getUid());
        });
        // Cleanup heartbeat on pagehide (mobile)
        window.addEventListener('pagehide', () => {
            if (this._onlineHeartbeat) { clearInterval(this._onlineHeartbeat); this._onlineHeartbeat = null; }
        });
    },

    async markOnline() {
        if (!Auth.isAuth()) return;
        const now = Date.now();
        // Throttle: max 1 online ping per 45 seconds (unless state changed)
        if (this._isCurrentlyOnline && now - this._lastOnlinePing < 45000) return;
        this._lastOnlinePing = now;
        const success = await DB.updateOnlineStatus(Auth.getUid(), true);
        if (success) this._isCurrentlyOnline = true;
    },

    async markOffline() {
        if (!Auth.isAuth()) return;
        if (!this._isCurrentlyOnline) return; // Already offline, skip
        this._isCurrentlyOnline = false;
        await DB.updateOnlineStatus(Auth.getUid(), false);
    },

    // Get online dot HTML for a user
    onlineDot(userId, isOnline) {
        const color = isOnline ? 'var(--green)' : 'var(--text-secondary)';
        return `<span class="online-dot" data-user-id="${userId}" style="background:${color}"></span>`;
    },

    // Format last seen text
    lastSeenText(lastSeen) {
        if (!lastSeen) return '';
        const diff = Date.now() - new Date(lastSeen).getTime();
        if (diff < 60000) return 'Last seen: Just now';
        if (diff < 3600000) return `Last seen: ${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `Last seen: ${Math.floor(diff / 3600000)}h ago`;
        return `Last seen: ${new Date(lastSeen).toLocaleDateString()}`;
    }
};

// ===================== ROUTING =====================
App.go = function(view) {
    if (!view) return;
    // Cleanup messaging when leaving messages view
    if (view !== 'messages' && this.currentView === 'messages') {
        if (this._msgPollInterval) { clearInterval(this._msgPollInterval); this._msgPollInterval = null; }
        if (this._msgRealtime) { try { this._msgRealtime.unsubscribe(); } catch (e) {} this._msgRealtime = null; }
        if (this._onlineStatusInterval) { clearInterval(this._onlineStatusInterval); this._onlineStatusInterval = null; }
        this.roomId = null;
    }
    if (this.currentView !== view) this.viewHistory.push(this.currentView);
    this.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById('view-' + view);
    if (el) { el.classList.add('active'); window.scrollTo(0, 0); }
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.style.display = (view === 'landing' || !Auth.isAuth()) ? 'none' : 'flex';
    document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    try {
        if (view === 'feed') this.renderFeed();
        if (view === 'creator-profile') this.renderCreatorProfile();
        if (view === 'messages') this.renderMessages();
        if (view === 'user-profile') this.renderUserProfile();
        if (view === 'admin') this.renderAdmin();
        if (view === 'owner') this.renderOwner();
    } catch (e) { console.error('[APP] Render:', e.message); }
    this.updateNav();
};
App.back = function() { this.go(this.viewHistory.pop() || (Auth.isAuth() ? 'feed' : 'landing')); };
App.show = function(view) { document.querySelectorAll('.view').forEach(v => v.classList.remove('active')); const el = document.getElementById('view-' + view); if (el) el.classList.add('active'); this.currentView = view; window.scrollTo(0, 0); };

// ===================== AUTH =====================
App.showAuth = function(tab) { this.openModal('authModal'); this.switchAuthTab(tab); };

App._creatorUnlocked = false;
App.onSwitchAccountType = function() {
    if (document.getElementById('signupType')?.value === 'fan') { this.openModal('creatorAccessModal'); setTimeout(() => document.getElementById('creatorUnlockPassword')?.focus(), 300); }
    else this.setAccountType('fan');
};
App.unlockCreator = function() {
    const input = document.getElementById('creatorUnlockPassword')?.value;
    if (input !== CREATOR_ACCESS_PASSWORD) { this.toast('Wrong password!', 'error'); document.getElementById('creatorUnlockPassword').value = ''; return; }
    this.closeModal('creatorAccessModal'); this.setAccountType('creator'); this.toast('Creator unlocked!', 'success');
    document.getElementById('creatorUnlockPassword').value = '';
};
App.cancelCreatorSwitch = function() { this.setAccountType('fan'); this.closeModal('creatorAccessModal'); };
App.setAccountType = function(type) {
    const display = document.getElementById('accountTypeDisplay'); const hidden = document.getElementById('signupType');
    const adminBox = document.getElementById('adminPasswordBox'); const switchBtn = document.getElementById('switchAccountTypeBtn');
    if (display) display.textContent = type === 'creator' ? 'Content Creator' : 'Fan / Subscriber';
    if (hidden) hidden.value = type;
    if (adminBox) adminBox.style.display = type === 'creator' ? 'block' : 'none';
    if (switchBtn) switchBtn.innerHTML = type === 'creator' ? '<i class="fas fa-exchange-alt"></i> Switch to Fan' : '<i class="fas fa-exchange-alt"></i> Switch to Content Creator';
    this._creatorUnlocked = type === 'creator';
};
App.switchAuthTab = function(tab) {
    document.querySelectorAll('#authModal .tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById(tab === 'login' ? 'authTabLogin' : 'authTabSignup');
    if (tabEl) tabEl.classList.add('active');
    const lp = document.getElementById('authLoginPanel'); const sp = document.getElementById('authSignupPanel');
    if (lp) lp.style.display = tab === 'login' ? 'block' : 'none';
    if (sp) sp.style.display = tab === 'signup' ? 'block' : 'none';
    const title = document.getElementById('authTitle'); if (title) title.textContent = tab === 'login' ? 'Welcome Back' : 'Join OnlyFans';
    if (tab === 'signup') this.setAccountType('fan');
};
App.handleLogin = async function() {
    const email = document.getElementById('loginEmail')?.value.trim(); const password = document.getElementById('loginPassword')?.value;
    if (!email || !password) { this.toast('Fill all fields', 'error'); return; }
    try { await Auth.signIn(email, password); this.closeModal('authModal'); this.toast('Welcome back!', 'success'); this.go('feed'); this.updateNav(); this.setupRealtime(); }
    catch (e) { this.toast(e.message || 'Login failed', 'error'); }
};
App.handleSignup = async function() {
    const username = document.getElementById('signupUsername')?.value.trim();
    const displayName = document.getElementById('signupDisplayName')?.value.trim();
    const email = document.getElementById('signupEmail')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    const confirm = document.getElementById('signupConfirm')?.value;
    const type = document.getElementById('signupType')?.value || 'fan';
    const age = document.getElementById('ageConfirm')?.checked;
    const adminPass = document.getElementById('creatorAdminPassword')?.value;
    if (!username || !email || !password) { this.toast('Fill all required fields', 'error'); return; }
    if (password !== confirm) { this.toast('Passwords do not match', 'error'); return; }
    if (!age) { this.toast('Confirm you are 18+', 'error'); return; }
    if (password.length < 6) { this.toast('Password min 6 chars', 'error'); return; }
    if (type === 'creator' && (!adminPass || adminPass.length < 4)) { this.toast('Set admin password (min 4)', 'error'); return; }
    try {
        const result = await Auth.signUp(email, password, username, displayName || username, type);
        this.closeModal('authModal');
        if (type === 'creator' && result?.user && adminPass) localStorage.setItem('creator_admin_' + result.user.id, adminPass);
        this.setAccountType('fan'); document.getElementById('creatorAdminPassword').value = '';
        if (result?.user) { this.toast('Account created!', 'success'); await Auth.ensureProfile(); await Auth.loadProfile(); this.go('feed'); this.updateNav(); this.setupRealtime(); }
        else { this.toast('Account created! Please log in.', 'success'); this.switchAuthTab('login'); }
    } catch (e) { this.toast(e.message || 'Signup failed', 'error'); }
};
App.showForgot = function() { this.closeModal('authModal'); this.openModal('forgotModal'); };
App.handleForgot = async function() { const email = document.getElementById('forgotEmail')?.value.trim(); if (!email) { this.toast('Enter email', 'error'); return; } try { await Auth.resetPassword(email); this.toast('Reset link sent!', 'success'); this.closeModal('forgotModal'); } catch (e) { this.toast(e.message, 'error'); } };
App.logout = async function() { this.closeModal('menuModal'); await Auth.signOut(); this.toast('Logged out', 'info'); this.go('landing'); this.updateNav(); this.realtimeChannels.forEach(c => { try { c.unsubscribe(); } catch (e) {} }); this.realtimeChannels = []; };
App.changePassword = async function() { const pass = document.getElementById('newPassword')?.value; if (!pass || pass.length < 6) { this.toast('Min 6 chars', 'error'); return; } try { await Auth.updatePassword(pass); this.toast('Updated!', 'success'); document.getElementById('newPassword').value = ''; } catch (e) { this.toast('Failed', 'error'); } };
App.deleteAccount = function() { if (confirm('Delete account permanently?')) this.toast('Contact support', 'warning'); };

// ===================== SESSION =====================
App.setupRealtime = function() {
    const uid = Auth.getUid(); if (!uid) return;
    this.realtimeChannels.forEach(c => { try { c.unsubscribe(); } catch (e) {} }); this.realtimeChannels = [];
    try { const ch = DB.subscribeToNotifs(uid, () => this.renderNotifications()); if (ch) this.realtimeChannels.push(ch); } catch (e) {}
    // Subscribe to ALL message inserts across all rooms (for badge updates)
    try {
        const msgCh = getSb().channel('messages:all').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
            const newMsg = payload.new;
            if (!newMsg || newMsg.sender_id === uid) return;
            // If we're viewing messages but NOT in the room of this message, update badge
            if (this.currentView !== 'messages' || this.roomId !== newMsg.room_id) {
                this.updateUnreadBadge();
            }
            // If we're in the messages list view, refresh the list
            if (this.currentView === 'messages' && !this.roomId) {
                this.renderMessages();
            }
        }).subscribe();
        if (msgCh) this.realtimeChannels.push(msgCh);
    } catch (e) { console.error('[MSG] Global realtime sub failed:', e.message); }
    // Periodic unread badge refresh
    if (this._unreadInterval) clearInterval(this._unreadInterval);
    this._unreadInterval = setInterval(() => this.updateUnreadBadge(), 30000);
};

// ===================== PROFILE =====================
App.renderUserProfile = async function() {
    if (!Auth.isAuth()) return; await Auth.loadProfile(); const p = Auth.profile;
    const nameEl = document.getElementById('userProfileName'); if (nameEl) nameEl.textContent = p?.display_name || p?.username || 'User';
    const handleEl = document.getElementById('userProfileHandle'); if (handleEl) handleEl.textContent = '@' + (p?.username || 'username');
    const typeEl = document.getElementById('userProfileType'); if (typeEl) typeEl.textContent = p?.type === 'creator' ? 'Creator Account' : 'Fan Account';
    const avatar = document.getElementById('userProfileAvatar');
    if (avatar) { if (p?.avatar) { avatar.style.backgroundImage = `url('${p.avatar}')`; avatar.innerHTML = ''; } else { avatar.style.backgroundImage = 'none'; avatar.innerHTML = '<i class="fas fa-user"></i>'; } }
    const editName = document.getElementById('editDisplayName'); const editBio = document.getElementById('editBio');
    if (editName) editName.value = p?.display_name || ''; if (editBio) editBio.value = p?.bio || '';
    try { const subs = await DB.getUserSubs(Auth.getUid()); const sl = document.getElementById('userSubsList'); if (sl) sl.innerHTML = subs.length ? subs.map(s => { const v = s.creator?.verified ? '<i class="fas fa-check-circle verified-badge" style="font-size:10px;margin-left:3px"></i>' : ''; return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)"><div style="font-weight:600">${this.esc(s.creator?.display_name || 'Creator')}${v}</div><div style="margin-left:auto;font-size:13px;color:var(--text-secondary)">${s.plan_type} - $${s.amount}</div><span style="background:${s.status === 'approved' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'};color:${s.status === 'approved' ? 'var(--green)' : 'var(--gold)'};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${s.status}</span></div>`; }).join('') : '<p class="no-content">No subscriptions yet</p>'; } catch (e) {}
    this.renderNotifications();
};
App.saveProfile = async function() { try { await DB.updateProfile(Auth.getUid(), { display_name: document.getElementById('editDisplayName')?.value, bio: document.getElementById('editBio')?.value }); await Auth.loadProfile(); this.toast('Saved!', 'success'); this.renderUserProfile(); this.updateNav(); } catch (e) { this.toast('Failed', 'error'); } };
App.updateAvatar = async function(e) { const file = e.target.files?.[0]; if (!file) return; if (!this.checkFileSize(file, 'profile')) return; try { const url = await this.uploadMedia(file, 'profile'); if (url) { await DB.updateProfile(Auth.getUid(), { avatar: url }); await Auth.loadProfile(); this.renderUserProfile(); this.updateNav(); this.toast('Updated!', 'success'); } else this.toast('Upload failed', 'error'); } catch (e) { this.toast('Upload failed: ' + e.message, 'error'); } };

// ===================== CREATOR PROFILE =====================
App.renderCreatorProfile = async function() {
    if (!this.creatorId) return;
    try {
        const p = await DB.getProfile(this.creatorId); if (!p) { this.toast('Creator not found', 'error'); return; }
        const cover = document.getElementById('creatorCover');
        if (cover) { cover.src = p.cover || ''; cover.style.display = p.cover ? 'block' : 'none'; }
        const av = document.getElementById('creatorAvatar');
        if (av) { if (p.avatar) { av.style.backgroundImage = `url('${p.avatar}')`; av.innerHTML = ''; } else { av.style.backgroundImage = 'none'; av.innerHTML = '<i class="fas fa-user" style="color:#999;font-size:40px"></i>'; } }
        const dot = document.getElementById('creatorOnlineDot');
        if (dot) { dot.style.display = 'inline-block'; dot.style.background = p.is_online ? 'var(--green)' : 'var(--text-secondary)'; }
        const lastSeenEl = document.getElementById('creatorLastSeen');
        if (lastSeenEl) lastSeenEl.textContent = p.is_online ? 'Online' : this.lastSeenText(p.last_seen);
        const nameEl = document.getElementById('creatorName'); if (nameEl) nameEl.innerHTML = this.esc(p.display_name || p.username) + (p.verified ? '<i class="fas fa-check-circle verified-badge"></i>' : '');
        const handleEl = document.getElementById('creatorHandle'); if (handleEl) handleEl.textContent = '@' + p.username;
        const bioEl = document.getElementById('creatorBio'); if (bioEl) bioEl.textContent = p.bio || '';
        const sp = document.getElementById('creatorStatPosts'); const sm = document.getElementById('creatorStatMedia'); const sl = document.getElementById('creatorStatLikes');
        if (sp) sp.textContent = p.posts_count || 0; if (sm) sm.textContent = p.media_count || 0; if (sl) sl.textContent = this.fmtNum(p.likes_count || 0);
        const urlBox = document.getElementById('profileUrlBox'); const urlDisplay = document.getElementById('profileUrlDisplay');
        if (urlBox && urlDisplay) { urlBox.style.display = 'block'; urlDisplay.textContent = `${window.location.origin}${window.location.pathname}?u=${p.username}`; }
        // Load creator's subscription plans (new system) with fallback to profile fields
        const plans = await DB.getCreatorPlans(this.creatorId);
        const planPrices = { monthly: 20, weekly: 5, vip: 50 };
        const planEnabled = { monthly: true, weekly: true, vip: true };
        if (plans.length) {
            plans.forEach(pl => { planPrices[pl.plan_type] = pl.price; planEnabled[pl.plan_type] = pl.enabled; });
        } else {
            // Fallback to profile fields if no plans exist yet
            planPrices.monthly = p.monthly_price || 20;
            planPrices.weekly = p.weekly_price || 5;
            planPrices.vip = p.vip_price || 50;
        }
        this._creatorPlans = { prices: planPrices, enabled: planEnabled, list: plans };
        const pm = document.getElementById('subPriceMonthly'); const pw = document.getElementById('subPriceWeekly'); const pv = document.getElementById('subPriceVip');
        if (pm) pm.textContent = planPrices.monthly; if (pw) pw.textContent = planPrices.weekly; if (pv) pv.textContent = planPrices.vip;
        const mb = document.getElementById('messageBtnName'); if (mb) mb.textContent = p.display_name || p.username;
        await this.renderSubBox();
        try { const vips = await DB.getVipVideos(this.creatorId); const vs = document.getElementById('vipSection'); const vg = document.getElementById('vipGrid'); if (vs && vg) { vs.style.display = vips.length ? 'block' : 'none'; vg.innerHTML = vips.length ? vips.map(v => this.vipItem(v)).join('') : ''; } } catch (e) {}
        try { const posts = await DB.getPosts(this.creatorId); const cg = document.getElementById('creatorPostsGrid'); const mg = document.getElementById('creatorMediaGrid'); if (cg) cg.innerHTML = posts.length ? posts.map(p => this.postItem(p)).join('') : '<div class="no-content"><i class="fas fa-image"></i>No posts yet</div>'; if (mg) { const mp = posts.filter(x => x.type === 'video'); mg.innerHTML = mp.length ? mp.map(p => this.postItem(p)).join('') : ''; const noMedia = document.getElementById('noMediaMsg'); if (noMedia) noMedia.style.display = mp.length ? 'none' : 'block'; } } catch (e) {}
        const ab = document.getElementById('navAdminBtn'); if (ab) ab.style.display = (Auth.isAuth() && Auth.getUid() === this.creatorId && Auth.isCreator()) ? 'inline-flex' : 'none';
    } catch (e) { console.error('[APP] Profile error:', e.message); this.toast('Failed to load profile', 'error'); }
};

App.renderSubBox = async function() {
    if (!Auth.isAuth() || !this.creatorId) return;
    try {
        const sub = await DB.getSubscription(Auth.getUid(), this.creatorId); const box = document.getElementById('creatorSubBox'); if (!box) return;
        if (sub?.status === 'approved' && sub?.expires_at && new Date(sub.expires_at) > new Date()) {
            const days = Math.floor((new Date(sub.expires_at) - new Date()) / 864e5);
            const hours = Math.floor(((new Date(sub.expires_at) - new Date()) % 864e5) / 3600000);
            const timeText = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
            box.innerHTML = `<div class="sub-active"><div class="sub-active-icon"><i class="fas fa-check"></i></div><div class="sub-active-title">Subscription Active</div><div class="sub-active-text">${sub.plan_type ? sub.plan_type.charAt(0).toUpperCase() + sub.plan_type.slice(1) : ''} &middot; Expires in ${timeText}</div></div>`;
        } else if (sub?.status === 'pending') { box.innerHTML = `<div class="sub-active"><div class="sub-active-icon" style="background:#fff8e6"><i class="fas fa-clock" style="color:var(--gold)"></i></div><div style="font-size:18px;font-weight:700">Payment Pending</div><div class="sub-active-text">Waiting for creator approval</div></div>`; }
        else if (sub?.status === 'cancelled') { box.innerHTML = `<div class="sub-active"><div class="sub-active-icon" style="background:rgba(239,68,68,0.15)"><i class="fas fa-ban" style="color:var(--red)"></i></div><div class="sub-active-title" style="color:var(--red)">Subscription Cancelled</div><div class="sub-active-text">Contact creator</div></div>`; }
        else {
            // Load creator plans (use cached if available)
            const plans = this._creatorPlans?.list || await DB.getCreatorPlans(this.creatorId);
            const planPrices = this._creatorPlans?.prices || {};
            const planEnabled = this._creatorPlans?.enabled || {};
            // Build plan buttons
            const planOrder = ['weekly', 'monthly']; // VIP is pay-per-view, not subscription
            const planIcons = { weekly: 'fa-calendar-week', monthly: 'fa-crown' };
            const planLabels = { weekly: 'WEEKLY', monthly: 'MONTHLY' };
            const planSuffix = { weekly: '/wk', monthly: '/mo' };
            const planDurations = { weekly: '7 days', monthly: '30 days' };
            let buttonsHtml = '';
            for (const pt of planOrder) {
                if (planEnabled[pt] === false) continue; // skip disabled plans
                const price = planPrices[pt] !== undefined ? planPrices[pt] : (pt === 'monthly' ? 20 : 5);
                buttonsHtml += `<button class="sub-btn sub-btn-${pt}" onclick="App.subscribe('${pt}')"><i class="fas ${planIcons[pt]}"></i> ${planLabels[pt]} - $${price}${planSuffix[pt]} <span style="font-size:11px;opacity:0.7">(${planDurations[pt]})</span></button>`;
            }
            if (!buttonsHtml) buttonsHtml = '<p class="no-content">No subscription plans available</p>';
            box.innerHTML = `<div class="sub-box-title"><i class="fas fa-gift"></i> Choose your plan</div>${buttonsHtml}<div class="sub-note">Cancel anytime</div>`;
        }
    } catch (e) { console.error('[SUB] renderSubBox:', e.message); }
};
App.switchProfileTab = function(tab, btn) { document.querySelectorAll('#view-creator-profile .tab').forEach(t => t.classList.remove('active')); if (btn) btn.classList.add('active'); const tp = document.getElementById('tabPosts'); const tm = document.getElementById('tabMedia'); if (tp) tp.classList.toggle('active', tab === 'posts'); if (tm) tm.classList.toggle('active', tab === 'media'); };
App.goCreatorProfile = async function(id) { this.creatorId = id; this.go('creator-profile'); };

// ===================== FEED =====================
App.renderFeed = async function() {
    try { const creators = await DB.listCreators(); const grid = document.getElementById('feedCreatorsGrid'); if (grid) grid.innerHTML = creators.length ? creators.map(c => this.creatorCard(c)).join('') : '<div class="no-content"><i class="fas fa-users"></i>No creators yet</div>'; } catch (e) {}
    try {
        const posts = await DB.getPosts(null, 12);
        const pg = document.getElementById('feedPostsGrid');
        if (pg) pg.innerHTML = posts.length ? posts.map(p => this.postItem(p)).join('') : '<div class="no-content"><i class="fas fa-image"></i>No posts yet</div>';
        // Update like states for each post
        if (Auth.isAuth() && posts.length) {
            for (const p of posts) {
                try {
                    const isLiked = await DB.isPostLiked(p.id, Auth.getUid());
                    const btn = document.getElementById(`like-btn-${p.id}`);
                    if (btn) {
                        const icon = btn.querySelector('i');
                        if (icon) { icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart'; }
                        if (isLiked) btn.classList.add('liked'); else btn.classList.remove('liked');
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
    try { const stories = await DB.getStories(); const sr = document.getElementById('feedStories'); if (sr) sr.innerHTML = stories.length ? stories.map(s => `<div class="story-item"><div class="story-ring"><div class="story-img" style="background-image:url('${s.media_url}')"></div></div><span class="story-name">Story</span></div>`).join('') : ''; } catch (e) {}
};
App.creatorCard = function(c) { return `<div class="creator-card" onclick="App.goCreatorProfile('${c.id}')"><div class="creator-banner" style="${c.cover ? `background-image:url('${c.cover}')` : ''}"></div><div class="creator-body"><div class="creator-avatar" style="${c.avatar ? `background-image:url('${c.avatar}')` : ''}">${c.avatar ? '' : (c.display_name || c.username).charAt(0).toUpperCase()}</div><div class="creator-name">${this.esc(c.display_name || c.username)}${c.verified ? '<i class="fas fa-check-circle verified-badge" style="font-size:12px;margin-left:4px"></i>' : ''}</div><div class="creator-handle">@${c.username}</div><div class="creator-price">$${c.monthly_price}/mo</div></div></div>`; };
App.searchCreators = debounce(async function(query) { try { const creators = await DB.listCreators(query); const grid = document.getElementById('feedCreatorsGrid'); if (grid) grid.innerHTML = creators.length ? creators.map(c => App.creatorCard(c)).join('') : '<div class="no-content"><i class="fas fa-search"></i>No creators found</div>'; } catch (e) {} }, 300);

// ===================== POSTS =====================
App.postItem = function(p) { const isVideo = p.type === 'video'; const isLocked = p.is_locked; const blur = isLocked ? 'filter:blur(12px);transform:scale(1.1);' : ''; const lockOverlay = isLocked ? '<div class="post-lock"><i class="fas fa-lock"></i></div>' : ''; const playIcon = (isVideo && !isLocked) ? '<i class="fas fa-play-circle post-play"></i>' : ''; const totalLikes = (p.likes_count || 0) + (p.boosted_likes || 0); const likeBar = `<div class="post-like-bar"><button class="post-like-btn" id="like-btn-${p.id}" onclick="event.stopPropagation();App.togglePostLike('${p.id}')"><i class="far fa-heart"></i></button><span class="post-like-count" onclick="event.stopPropagation();App.showWhoLiked('${p.id}')" id="like-count-${p.id}">${totalLikes}</span></div>`; if (isVideo) { return `<div class="post-item" onclick="App.openPost('${p.id}')" style="position:relative;overflow:hidden"><video preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;pointer-events:none;${blur}" src="${p.media_url}"></video>${lockOverlay}${playIcon}${likeBar}</div>`; } return `<div class="post-item" onclick="App.openPost('${p.id}')" style="position:relative;overflow:hidden"><div style="width:100%;height:100%;background-image:url('${p.media_url}');background-size:cover;background-position:center;${blur}"></div>${lockOverlay}${playIcon}${likeBar}</div>`; };
App.openPost = async function(id) { if (!id) return; try { const client = getSb(); if (!client) return; const { data: post } = await client.from('posts').select('*, creator:profiles!posts_creator_id_fkey(*)').eq('id', id).maybeSingle(); if (!post) return; this.postId = id; if (post.is_locked && !await this.isSubscribed(post.creator_id)) { if (!Auth.isAuth()) { this.showAuth('login'); return; } this.toast('Subscribe to unlock!', 'info'); return; } const c = post.creator; const pvAvatar = document.getElementById('pvAvatar'); if (pvAvatar) pvAvatar.style.backgroundImage = c?.avatar ? `url('${c.avatar}')` : 'none'; const pvName = document.getElementById('pvName'); if (pvName) pvName.innerHTML = this.esc(c?.display_name || c?.username || 'Creator') + (c?.verified ? '<i class="fas fa-check-circle verified-badge" style="margin-left:4px"></i>' : ''); const pvTime = document.getElementById('pvTime'); if (pvTime) pvTime.textContent = this.timeAgo(post.created_at); const pvCaption = document.getElementById('pvCaption'); if (pvCaption) pvCaption.textContent = post.caption || ''; const pvComments = document.getElementById('pvComments'); if (pvComments) pvComments.textContent = post.comments_count || 0; const media = document.getElementById('pvMedia'); if (media) { if (post.type === 'video') media.innerHTML = `<video controls autoplay playsinline style="width:100%;max-height:70vh;display:block"><source src="${post.media_url}"></video>`; else media.innerHTML = `<img src="${post.media_url}" alt="Post" style="width:100%;display:block">`; } this.updateLikeBtn(id); this.openModal('postViewerModal'); } catch (e) { console.error('[APP] openPost:', e.message); } };
App.closePostViewer = function() { this.closeModal('postViewerModal'); const v = document.querySelector('#pvMedia video'); if (v) { v.pause(); v.src = ''; } };
App.updateLikeBtn = async function(postId) {
    if (!postId) return;
    try {
        const [likes, count, isLiked] = await Promise.all([
            DB.getLikes(postId),
            DB.getLikeCount(postId),
            Auth.isAuth() ? DB.isPostLiked(postId, Auth.getUid()) : false
        ]);
        const total = count + (likes.length > 0 ? 0 : 0); // count is real likes
        // Get boosted likes from the post data if available
        const pvLikes = document.getElementById('pvLikes');
        if (pvLikes) pvLikes.textContent = count;
        const btn = document.getElementById('pvLikeBtn');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) { icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart'; icon.style.color = isLiked ? 'var(--red)' : ''; }
            btn.innerHTML = `${isLiked ? '<i class="fas fa-heart" style="color:var(--red)"></i>' : '<i class="far fa-heart"></i>'} <span id="pvLikes">${count}</span>`;
        }
    } catch (e) { console.error('[LIKE] updateLikeBtn:', e.message); }
};

App.likeCurrentPost = async function() {
    if (!this.postId) return;
    if (!Auth.isAuth()) { this.showAuth('signup'); return; }
    try {
        const result = await DB.toggleLike(this.postId, Auth.getUid());
        if (result && result.likes_count !== undefined) {
            const isLiked = result.liked;
            const post = await DB.getPost(this.postId);
            const total = result.likes_count + (post?.boosted_likes || 0);
            const btn = document.getElementById('pvLikeBtn');
            if (btn) btn.innerHTML = `${isLiked ? '<i class="fas fa-heart" style="color:var(--red)"></i>' : '<i class="far fa-heart"></i>'} <span id="pvLikes">${total}</span>`;
            this.toast(isLiked ? 'Liked!' : 'Unliked', 'success');
            // Update grid like count too
            const gridBtn = document.getElementById(`like-btn-${this.postId}`);
            const gridCount = document.getElementById(`like-count-${this.postId}`);
            if (gridBtn) { const icon = gridBtn.querySelector('i'); if (icon) icon.className = isLiked ? 'fas fa-heart' : 'far fa-heart'; if (isLiked) gridBtn.classList.add('liked'); else gridBtn.classList.remove('liked'); }
            if (gridCount) gridCount.textContent = total;
            // Refresh creator profile likes
            this.refreshProfileLikes();
        }
    } catch (e) { this.toast('Failed', 'error'); }
};
App.shareCurrentPost = function() { this.toast('Link copied!', 'success'); };

// ===================== POST LIKE SYSTEM =====================
// Uses RPC toggle_post_like which returns {liked, likes_count}
// and atomically updates posts.likes_count + profiles.likes_count
App.togglePostLike = async function(postId) {
    if (!postId) return;
    if (!Auth.isAuth()) { this.showAuth('signup'); return; }
    const uid = Auth.getUid();
    const btn = document.getElementById(`like-btn-${postId}`);
    const countEl = document.getElementById(`like-count-${postId}`);
    // Optimistic UI
    const wasLiked = btn?.classList.contains('liked');
    const currentCount = parseInt(countEl?.textContent || '0', 10);
    if (btn) { const icon = btn.querySelector('i'); if (icon) icon.className = wasLiked ? 'far fa-heart' : 'fas fa-heart'; if (wasLiked) btn.classList.remove('liked'); else btn.classList.add('liked'); }
    if (countEl) countEl.textContent = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
    try {
        const result = await DB.toggleLike(postId, uid);
        if (result && result.likes_count !== undefined) {
            // Use the count returned from RPC (includes real + boosted)
            const post = await DB.getPost(postId);
            const total = result.likes_count + (post?.boosted_likes || 0);
            if (countEl) countEl.textContent = total;
            // Refresh creator profile likes if viewing a profile
            this.refreshProfileLikes();
            // Send like notification to post creator (only when liking, not unliking)
            if (!wasLiked && post?.creator_id && post.creator_id !== uid) {
                try { this.notifyNewLike(postId, uid, post.creator_id); } catch (n) {}
            }
        } else {
            // Revert on failure
            if (btn) { const icon = btn.querySelector('i'); if (icon) icon.className = wasLiked ? 'fas fa-heart' : 'far fa-heart'; if (wasLiked) btn.classList.add('liked'); else btn.classList.remove('liked'); }
            if (countEl) countEl.textContent = currentCount;
        }
    } catch (e) {
        console.error('[LIKE] togglePostLike:', e.message);
        if (btn) { const icon = btn.querySelector('i'); if (icon) icon.className = wasLiked ? 'fas fa-heart' : 'far fa-heart'; if (wasLiked) btn.classList.add('liked'); else btn.classList.remove('liked'); }
        if (countEl) countEl.textContent = currentCount;
    }
};

// Refresh profile likes display without full re-render
App.refreshProfileLikes = async function() {
    if (!this.creatorId) return;
    try {
        const profile = await DB.getProfile(this.creatorId);
        if (profile) {
            const sl = document.getElementById('pLikes');
            if (sl) sl.textContent = this.fmtNum(profile.likes_count || 0);
        }
    } catch (e) {}
};

App.showWhoLiked = async function(postId) {
    if (!postId) return;
    const list = document.getElementById('whoLikedList');
    const title = document.getElementById('whoLikedTitle');
    if (list) list.innerHTML = '<div class="no-content"><i class="fas fa-spinner fa-spin"></i>Loading...</div>';
    this.openModal('whoLikedModal');
    try {
        const likes = await DB.getLikes(postId);
        if (title) title.textContent = likes.length + ' Likes';
        if (!likes.length) { if (list) list.innerHTML = '<div class="no-content"><i class="fas fa-heart-broken"></i>No likes yet</div>'; return; }
        if (list) list.innerHTML = likes.map(l => {
            const u = l.user || {};
            const avatar = u.avatar || '';
            const initial = u.display_name || u.username ? (u.display_name || u.username).charAt(0).toUpperCase() : 'U';
            const name = this.esc(u.display_name || u.username || 'User');
            const verified = u.verified ? '<i class="fas fa-check-circle verified-badge"></i>' : '';
            const date = l.created_at ? new Date(l.created_at).toLocaleDateString() : '';
            const avHtml = avatar ? `<div class="who-liked-avatar" style="background-image:url('${avatar}')"></div>` : `<div class="who-liked-avatar">${initial}</div>`;
            return `<div class="who-liked-item">${avHtml}<div class="who-liked-info"><div class="who-liked-name">${name}${verified}</div><div class="who-liked-date">${date}</div></div></div>`;
        }).join('');
    } catch (e) { console.error('[LIKE] showWhoLiked:', e.message); if (list) list.innerHTML = '<div class="no-content">Failed to load</div>'; }
};

// ===================== OWNER BOOST LIKES =====================
App._allBoostPosts = [];
App._boostFilter = 'all';

// Load ALL posts when boost tab opens
App.loadAllBoostPosts = async function() {
    const container = document.getElementById('boostPostsList');
    if (!container) return;
    container.innerHTML = '<p class="no-content"><i class="fas fa-spinner fa-spin"></i> Loading all posts...</p>';
    try {
        const { data: posts, error } = await getSb().from('posts')
            .select('id, caption, type, media_url, likes_count, boosted_likes, created_at, creator_id, is_locked, creator:profiles!posts_creator_id_fkey(id, username, display_name, avatar, verified)')
            .order('created_at', { ascending: false }).limit(200);
        if (error) { console.error('[BOOST] load error:', error.message); container.innerHTML = '<p class="no-content">Failed to load</p>'; return; }
        App._allBoostPosts = posts || [];
        App.applyBoostFilter(App._boostFilter);
    } catch (e) { console.error('[BOOST] load:', e.message); container.innerHTML = '<p class="no-content">Error</p>'; }
};

App.applyBoostFilter = function(filter, btn) {
    if (btn) { document.querySelectorAll('#admin-boost .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    App._boostFilter = filter;
    let filtered = [...App._allBoostPosts];
    if (filter === 'photos') filtered = filtered.filter(p => p.type === 'image');
    else if (filter === 'videos') filtered = filtered.filter(p => p.type === 'video');
    else if (filter === 'most_liked') filtered.sort((a, b) => ((b.likes_count||0)+(b.boosted_likes||0)) - ((a.likes_count||0)+(a.boosted_likes||0)));
    else if (filter === 'newest') filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (filter === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const container = document.getElementById('boostPostsList');
    if (!container) return;
    container.innerHTML = filtered.length ? filtered.map(p => this.boostPostCard(p)).join('') : '<p class="no-content">No posts match this filter</p>';
    const countEl = document.getElementById('boostPostCount');
    if (countEl) countEl.textContent = `${filtered.length} post${filtered.length !== 1 ? 's' : ''}`;
};

App.searchBoostPosts = debounce(async function(query) {
    const container = document.getElementById('boostPostsList');
    if (!container) return;
    const q = query?.toLowerCase()?.trim();
    if (!q) { App.applyBoostFilter(App._boostFilter); return; }
    let filtered = App._allBoostPosts.filter(p => {
        const c = (p.caption || '').toLowerCase(), u = (p.creator?.username || '').toLowerCase(), d = (p.creator?.display_name || '').toLowerCase();
        return c.includes(q) || u.includes(q) || d.includes(q);
    });
    if (filtered.length) { container.innerHTML = filtered.map(p => this.boostPostCard(p)).join(''); return; }
    container.innerHTML = '<p class="no-content"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';
    try {
        const { data: posts } = await getSb().from('posts')
            .select('id, caption, type, media_url, likes_count, boosted_likes, created_at, creator_id, is_locked, creator:profiles!posts_creator_id_fkey(id, username, display_name, avatar, verified)')
            .ilike('caption', `%${q}%`).limit(50);
        if (posts?.length) { container.innerHTML = posts.map(p => this.boostPostCard(p)).join(''); return; }
        const { data: creators } = await getSb().from('profiles').select('id').eq('type', 'creator').or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(20);
        if (creators?.length) {
            const { data: cp } = await getSb().from('posts').select('id, caption, type, media_url, likes_count, boosted_likes, created_at, creator_id, is_locked, creator:profiles!posts_creator_id_fkey(id, username, display_name, avatar, verified)').in('creator_id', creators.map(c => c.id)).limit(50);
            if (cp?.length) { container.innerHTML = cp.map(p => this.boostPostCard(p)).join(''); return; }
        }
        container.innerHTML = '<p class="no-content">No results for "' + this.esc(q) + '"</p>';
    } catch (e) { container.innerHTML = '<p class="no-content">Search failed</p>'; }
}, 300);

App.boostPostCard = function(p) {
    const thumb = p.type === 'video'
        ? `<video preload="metadata" muted style="width:100%;height:100%;object-fit:cover" src="${p.media_url}"></video>`
        : `<img src="${p.media_url}" style="width:100%;height:100%;object-fit:cover">`;
    const creator = this.esc(p.creator?.display_name || p.creator?.username || 'Unknown');
    const cAvatar = p.creator?.avatar ? `<img src="${p.creator.avatar}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;margin-right:6px">` : '';
    const cVerified = p.creator?.verified ? '<i class="fas fa-check-circle verified-badge" style="font-size:10px;margin-left:3px"></i>' : '';
    const currentLikes = (p.likes_count || 0) + (p.boosted_likes || 0);
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : '';
    return `<div class="boost-post-card" id="boost-card-${p.id}"><div class="boost-header"><div class="boost-thumb">${thumb}</div><div class="boost-info"><div class="boost-caption">${this.esc(p.caption || 'No caption')}</div><div class="boost-creator">${cAvatar}@${creator}${cVerified}</div><div class="boost-meta"><span style="color:var(--red);font-weight:700">${currentLikes.toLocaleString()} likes</span> &middot; ${p.type === 'video' ? 'Video' : 'Photo'}${p.is_locked ? ' &middot; Locked' : ''} &middot; ${date}</div></div></div><div class="boost-actions"><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 10)">+10</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 50)">+50</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 100)">+100</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 500)">+500</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 1000)">+1K</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 5000)">+5K</button><button class="btn btn-outline btn-sm" onclick="App.boostPostLikes('${p.id}', 10000)">+10K</button></div><div class="boost-input-row"><input type="number" class="input" id="boost-custom-${p.id}" placeholder="Custom e.g. 100000" min="1"><button class="btn btn-boost" onclick="App.boostPostCustom('${p.id}')">Boost</button><button class="btn btn-danger btn-sm" onclick="App.resetPostBoost('${p.id}')"><i class="fas fa-undo"></i> Reset</button></div></div>`;
};

App.boostPostLikes = async function(postId, amount) {
    if (!postId || !amount || !Auth.isAuth()) return;
    this.toast(`Boosting +${amount}...`, 'info');
    try {
        // Use RPC which updates posts.boosted_likes + profiles.likes_count atomically
        const success = await DB.boostPost(postId, Auth.getUid(), amount);
        if (success) {
            this.toast(`+${amount} likes boosted!`, 'success');
            const query = document.getElementById('boostSearchInput')?.value;
            if (query) this.searchBoostPosts(query);
            this.renderBoostHistory();
            this.renderCreatorLikeAnalytics();
        } else this.toast('Boost failed', 'error');
    } catch (e) { console.error('[BOOST] boostPostLikes:', e.message); this.toast('Failed', 'error'); }
};

App.boostPostCustom = async function(postId) {
    const input = document.getElementById(`boost-custom-${postId}`);
    const amount = parseInt(input?.value, 10);
    if (!amount || amount < 1) { this.toast('Enter a valid number', 'error'); return; }
    await this.boostPostLikes(postId, amount);
    if (input) input.value = '';
};

App.resetPostBoost = async function(postId) {
    if (!postId || !confirm('Reset all boosted likes for this post?')) return;
    try {
        const success = await DB.resetPostBoost(postId);
        if (success) { this.toast('Boost reset!', 'success'); const query = document.getElementById('boostSearchInput')?.value; if (query) this.searchBoostPosts(query); this.renderBoostHistory(); }
        else this.toast('Reset failed', 'error');
    } catch (e) { this.toast('Failed', 'error'); }
};

App.renderBoostHistory = async function() {
    const list = document.getElementById('boostHistoryList');
    if (!list) return;
    try {
        const history = await DB.getBoostHistory();
        // Update stats
        const totalBoosted = history.reduce((sum, h) => sum + (h.likes_added || 0), 0);
        const boostedPosts = new Set(history.map(h => h.post_id)).size;
        const sTotal = document.getElementById('boostStatTotal');
        const sPosts = document.getElementById('boostStatPosts');
        const sRecords = document.getElementById('boostStatRecords');
        if (sTotal) sTotal.textContent = totalBoosted.toLocaleString();
        if (sPosts) sPosts.textContent = boostedPosts;
        if (sRecords) sRecords.textContent = history.length;
        if (!history.length) { list.innerHTML = '<p class="no-content">No boosts yet</p>'; return; }
        list.innerHTML = history.slice(0, 50).map(h => {
            const p = h.post || {};
            const owner = h.owner || {};
            const thumb = p.media_url ? `<img src="${p.media_url}" alt="">` : '<i class="fas fa-image"></i>';
            return `<div class="boost-history-item"><div class="boost-history-thumb">${thumb}</div><div class="boost-history-info"><div class="boost-history-title">${this.esc(p.caption || 'No caption')}</div><div class="boost-history-meta">By ${this.esc(owner.display_name || owner.username || 'Owner')} &middot; ${h.created_at ? new Date(h.created_at).toLocaleString() : ''}</div></div><div class="boost-history-count"><div class="added">+${h.likes_added || 0}</div><div class="total">${h.new_total || 0} total</div></div><button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="App.removeBoostRecord('${h.id}')"><i class="fas fa-trash-alt"></i></button></div>`;
        }).join('');
    } catch (e) { console.error('[BOOST] renderHistory:', e.message); }
};

App.removeBoostRecord = async function(id) {
    if (!id || !confirm('Remove this boost record and reset likes?')) return;
    try {
        const success = await DB.removeBoostRecord(id);
        if (success) { this.toast('Boost removed!', 'success'); this.renderBoostHistory(); const query = document.getElementById('boostSearchInput')?.value; if (query) this.searchBoostPosts(query); }
        else this.toast('Failed', 'error');
    } catch (e) { this.toast('Failed', 'error'); }
};

// ===================== CREATOR LIKE ANALYTICS =====================
App.renderCreatorLikeAnalytics = async function() {
    if (!Auth.isAuth()) return;
    const uid = Auth.getUid();
    try {
        const analytics = await DB.getCreatorLikeAnalytics(uid);
        const totalLikesEl = document.getElementById('dashTotalLikes');
        const boostedEl = document.getElementById('dashBoostedLikes');
        const mostLikedEl = document.getElementById('dashMostLiked');
        const mostLikedPost = document.getElementById('dashMostLikedPost');
        const mostLikedImg = document.getElementById('dashMostLikedImg');
        const mostLikedCaption = document.getElementById('dashMostLikedCaption');
        const mostLikedCount = document.getElementById('dashMostLikedCount');
        const likesPerPost = document.getElementById('dashLikesPerPost');
        if (totalLikesEl) totalLikesEl.textContent = analytics.totalLikes.toLocaleString();
        if (boostedEl) boostedEl.textContent = analytics.totalBoosted.toLocaleString();
        if (mostLikedEl) mostLikedEl.textContent = analytics.mostLikedPost ? (analytics.mostLikedPost.total_likes || 0).toLocaleString() : '0';
        if (analytics.mostLikedPost) {
            if (mostLikedPost) mostLikedPost.style.display = 'block';
            if (mostLikedImg) mostLikedImg.src = analytics.mostLikedPost.media_url || '';
            if (mostLikedCaption) mostLikedCaption.textContent = analytics.mostLikedPost.caption || 'No caption';
            if (mostLikedCount) mostLikedCount.textContent = (analytics.mostLikedPost.total_likes || 0) + ' likes';
        } else { if (mostLikedPost) mostLikedPost.style.display = 'none'; }
        if (likesPerPost) {
            if (!analytics.posts.length) { likesPerPost.innerHTML = '<p class="no-content">No posts yet</p>'; }
            else {
                likesPerPost.innerHTML = analytics.posts.map(p => {
                    const thumb = p.media_url ? `<img src="${p.media_url}" alt="">` : '';
                    return `<div class="likes-table-row"><div class="likes-table-thumb">${thumb}</div><div class="likes-table-info"><div class="likes-table-caption">${this.esc(p.caption || 'No caption')}</div></div><div class="likes-table-count">${p.total_likes || 0}${p.boosted_likes ? ' <span style="font-size:10px;color:var(--purple)">+' + p.boosted_likes + 'B</span>' : ''}</div></div>`;
                }).join('');
            }
        }
    } catch (e) { console.error('[LIKE] renderCreatorAnalytics:', e.message); }
};

// ===================== MESSAGING (PRODUCTION-READY) =====================
App._chatOtherProfile = null;
App._msgPollInterval = null;

// Render conversation list with avatars, names, unread counts
App.renderMessages = async function() {
    if (!Auth.isAuth()) { console.log('[MSG] Not authenticated'); return; }
    const uid = Auth.getUid();
    console.log('[MSG] Loading conversations for', uid);
    try {
        const rooms = await DB.getChatRooms(uid);
        console.log('[MSG] Found', rooms.length, 'rooms');
        const list = document.getElementById('msgList');
        if (!list) { console.error('[MSG] msgList element not found'); return; }
        if (!rooms.length) { list.innerHTML = '<div class="no-content"><i class="fas fa-comment-slash"></i>No conversations yet</div>'; return; }

        // Build list items with placeholder data first
        list.innerHTML = rooms.map(r => {
            const otherId = r.participant_1 === uid ? r.participant_2 : r.participant_1;
            return `<li class="msg-item ${this.roomId === r.id ? 'active' : ''}" data-room="${r.id}" data-other="${otherId}"><div class="msg-item-avatar-wrap" style="position:relative;display:inline-block"><div class="msg-item-avatar" data-av="${r.id}">?</div><span class="online-dot-small" data-online="${otherId}" style="position:absolute;bottom:0;right:0;background:var(--text-secondary)"></span></div><div class="msg-info"><div class="msg-preview-name" data-nm="${r.id}">User</div><div class="msg-preview">${this.esc(r.last_message || 'Tap to chat')}</div></div><span class="msg-unread" data-unread="${r.id}" style="display:none">0</span><div class="msg-time" data-time="${r.id}" style="font-size:11px;color:var(--text-secondary);white-space:nowrap;margin-left:auto">${this.timeAgo(r.last_message_at)}</div></li>`;
        }).join('');

        // Attach click handlers
        list.querySelectorAll('.msg-item').forEach(item => {
            item.addEventListener('click', () => {
                const roomId = item.getAttribute('data-room');
                const otherId = item.getAttribute('data-other');
                this.openRoom(roomId, otherId);
            });
        });

        // Load profiles and unread counts for each conversation
        for (const r of rooms) {
            const otherId = r.participant_1 === uid ? r.participant_2 : r.participant_1;
            try {
                const [profile, unread] = await Promise.all([DB.getProfile(otherId), DB.countUnread(r.id, uid)]);
                const item = list.querySelector(`[data-room="${r.id}"]`);
                if (!item) continue;
                const av = item.querySelector(`[data-av="${r.id}"]`);
                const nm = item.querySelector(`[data-nm="${r.id}"]`);
                const un = item.querySelector(`[data-unread="${r.id}"]`);
                if (av) {
                    if (profile?.avatar) { av.style.backgroundImage = `url('${profile.avatar}')`; av.textContent = ''; }
                    else { av.textContent = (profile?.display_name || profile?.username || '?').charAt(0).toUpperCase(); }
                }
                if (nm) nm.innerHTML = this.esc(profile?.display_name || profile?.username || 'User') + (profile?.verified ? '<i class="fas fa-check-circle verified-badge" style="margin-left:4px;font-size:10px"></i>' : '');
                if (un) { if (unread > 0) { un.textContent = unread > 9 ? '9+' : unread; un.style.display = 'flex'; } else { un.style.display = 'none'; } }
            } catch (e) { console.error('[MSG] Error loading profile for room', r.id, e.message); }
        }
    } catch (e) { console.error('[MSG] renderMessages error:', e.message); }
};

// Open a chat room with proper cleanup, realtime, and polling fallback
App.openRoom = async function(roomId, otherId) {
    console.log('[MSG] Opening room', roomId, 'with user', otherId);
    if (!roomId || !otherId) { console.error('[MSG] Missing roomId or otherId'); return; }

    // Unsubscribe from previous room
    if (this._msgRealtime) { try { this._msgRealtime.unsubscribe(); } catch (e) {} this._msgRealtime = null; }
    // Clear previous polling
    if (this._msgPollInterval) { clearInterval(this._msgPollInterval); this._msgPollInterval = null; }

    this.roomId = roomId;
    try {
        const [other, msgs] = await Promise.all([DB.getProfile(otherId), DB.getMessages(roomId)]);
        console.log('[MSG] Loaded', msgs.length, 'messages');
        this._chatOtherProfile = other;

        // Fetch ACTUAL current online status (profile cache may be stale)
        let isOnline = other?.is_online;
        let lastSeen = other?.last_seen;
        try {
            const status = await DB.getUserStatus(otherId);
            if (status) { isOnline = status.is_online; lastSeen = status.last_seen; }
        } catch (e) {}

        // Update header
        const chatAv = document.getElementById('chatAvatar');
        if (chatAv) {
            if (other?.avatar) { chatAv.style.backgroundImage = `url('${other.avatar}')`; chatAv.textContent = ''; }
            else { chatAv.style.backgroundImage = 'none'; chatAv.textContent = (other?.display_name || 'U').charAt(0).toUpperCase(); }
        }
        const chatName = document.getElementById('chatName');
        if (chatName) chatName.innerHTML = this.esc(other?.display_name || 'User') + (other?.verified ? '<i class="fas fa-check-circle verified-badge" style="margin-left:4px;font-size:13px"></i>' : '');
        const chatStatus = document.getElementById('chatStatus');
        if (chatStatus) {
            chatStatus.textContent = isOnline ? 'Online' : (this.lastSeenText(lastSeen) || 'Offline');
            chatStatus.className = isOnline ? 'chat-online-status' : 'chat-online-status offline';
        }
        // Mark current user as online (they just opened a chat)
        this.markOnline();
        // Periodically refresh other user's online status while chat is open
        if (this._onlineStatusInterval) clearInterval(this._onlineStatusInterval);
        this._onlineStatusInterval = setInterval(async () => {
            if (this.currentView !== 'messages' || this.roomId !== roomId) {
                clearInterval(this._onlineStatusInterval);
                this._onlineStatusInterval = null;
                return;
            }
            try {
                const s = await DB.getUserStatus(otherId);
                if (s && document.getElementById('chatStatus')) {
                    const cs = document.getElementById('chatStatus');
                    cs.textContent = s.is_online ? 'Online' : (this.lastSeenText(s.last_seen) || 'Offline');
                    cs.className = s.is_online ? 'chat-online-status' : 'chat-online-status offline';
                }
            } catch (e) {}
        }, 30000); // Refresh every 30 seconds
        const msgInputArea = document.getElementById('msgInputArea');
        if (msgInputArea) msgInputArea.style.display = 'flex';
        document.getElementById('msgSidebar')?.classList.remove('active');

        // Render existing messages
        this.renderChatMsgs(msgs);

        // Mark as read
        await DB.markRead(roomId, Auth.getUid());
        this.renderMessages();
        this.updateUnreadBadge();

        // Setup Supabase Realtime for this room
        try {
            this._msgRealtime = DB.subscribeToMessages(roomId, (payload) => {
                console.log('[MSG] Realtime event:', payload.eventType);
                const newMsg = payload.new;
                if (!newMsg || newMsg.room_id !== this.roomId) return;
                // CRITICAL FIX: Skip our own messages from realtime.
                // We already showed the optimistic version in sendChatText.
                // Rendering it again would create a duplicate.
                if (newMsg.sender_id === Auth.getUid()) {
                    // Just update the optimistic message's ID silently
                    const tempEl = document.querySelector('.msg-row[data-msg-id^="temp-"]');
                    if (tempEl) tempEl.setAttribute('data-msg-id', newMsg.id);
                    this.renderMessages();
                    this.updateUnreadBadge();
                    return;
                }
                // For other users' messages, only append if not already in DOM
                const existing = document.querySelector(`[data-msg-id="${newMsg.id}"]`);
                if (!existing) {
                    this.appendChatMsg(newMsg);
                    DB.markRead(this.roomId, Auth.getUid());
                }
                this.renderMessages();
                this.updateUnreadBadge();
            });
            console.log('[MSG] Realtime subscribed for room', roomId);
        } catch (rtErr) { console.error('[MSG] Realtime subscribe failed:', rtErr.message); }

        // POLLING FALLBACK: Refresh messages every 3 seconds (in case realtime fails)
        this._msgPollInterval = setInterval(async () => {
            if (this.currentView !== 'messages' || this.roomId !== roomId) {
                clearInterval(this._msgPollInterval);
                this._msgPollInterval = null;
                return;
            }
            try {
                const fresh = await DB.getMessages(roomId);
                const currentCount = document.querySelectorAll('.msg-row').length;
                if (fresh.length > currentCount) {
                    console.log('[MSG] Polling found', fresh.length - currentCount, 'new messages');
                    this.renderChatMsgs(fresh);
                    await DB.markRead(roomId, Auth.getUid());
                    this.renderMessages();
                    this.updateUnreadBadge();
                }
            } catch (e) {}
        }, 3000);

    } catch (e) { console.error('[MSG] openRoom error:', e.message); }
};

// Format date separator text
App.dateSepText = function(dateStr) {
    if (!dateStr) return 'Today';
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - msgDay) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Render single message bubble within a group
// position: first | middle | last | single
App.msgBubble = function(m, uid, position, showAvatar) {
    const isMe = m.sender_id === uid;
    const sender = m.sender || (isMe ? Auth.profile : this._chatOtherProfile) || {};
    const avatarUrl = sender.avatar || '';
    const avatarInitial = (sender.display_name || sender.username || 'U').charAt(0).toUpperCase();
    const time = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    let media = '';
    if (m.media_url) {
        media = m.is_video
            ? `<video controls playsinline style="max-width:100%;border-radius:8px;margin-bottom:4px;display:block;max-height:300px" src="${m.media_url}"></video>`
            : `<img src="${m.media_url}" style="max-width:100%;border-radius:8px;margin-bottom:4px;display:block">`;
    }
    // Avatar: visible on first message in group, hidden (but keeps spacing) on others
    const avHidden = (!showAvatar) ? 'hidden' : '';
    const avHtml = avatarUrl
        ? `<div class="msg-row-avatar ${avHidden}" style="background-image:url('${avatarUrl}')"></div>`
        : `<div class="msg-row-avatar ${avHidden}">${avatarInitial}</div>`;
    // Seen/delivered icon
    let statusIcon = '';
    if (isMe) {
        statusIcon = m.is_read
            ? ' <i class="fas fa-check-double" style="font-size:10px;color:var(--green)"></i>'
            : ' <i class="fas fa-check" style="font-size:10px;opacity:0.5"></i>';
    }
    // Show timestamp only on last message in group
    const showTime = (position === 'last' || position === 'single');
    return `<div class="msg-row ${position}" data-msg-id="${m.id || ''}" data-ts="${Date.now()}">${avHtml}<div class="msg-content"><div class="msg-bubble ${isMe ? 'sent' : 'received'}">${media}${this.esc(m.content || '')}</div>${showTime ? `<div class="msg-meta ${isMe ? 'sent' : ''}">${time}${statusIcon}</div>` : ''}</div></div>`;
};

// Group consecutive messages and render full conversation
App.renderChatMsgs = function(msgs) {
    const area = document.getElementById('msgChat');
    if (!area) return;
    const uid = Auth.getUid();
    this._lastRenderedDate = null;
    if (!msgs || !msgs.length) { area.innerHTML = '<div class="no-content" style="margin:auto;text-align:center;padding:40px 20px"><i class="fas fa-comment-slash" style="font-size:48px;color:var(--border);margin-bottom:16px;display:block"></i><p style="font-size:16px;font-weight:600;margin-bottom:4px">No messages yet</p><p style="font-size:13px;color:var(--text-secondary)">Start the conversation!</p></div>'; return; }
    let html = '';
    let currentGroup = [];
    let lastSender = null;
    let lastDate = null;
    function flushGroup() {
        if (!currentGroup.length) return;
        const isMe = currentGroup[0].sender_id === uid;
        const sender = currentGroup[0].sender || (isMe ? Auth.profile : App._chatOtherProfile) || {};
        html += `<div class="msg-group ${isMe ? 'sent' : 'received'}">`;
        for (let i = 0; i < currentGroup.length; i++) {
            let pos = currentGroup.length === 1 ? 'single' : i === 0 ? 'first' : i === currentGroup.length - 1 ? 'last' : 'middle';
            html += App.msgBubble(currentGroup[i], uid, pos, i === 0);
        }
        html += '</div>';
        currentGroup = [];
    }
    for (const m of msgs) {
        const msgDate = m.created_at ? new Date(m.created_at).toDateString() : '';
        if (msgDate && msgDate !== lastDate) {
            flushGroup();
            html += `<div class="msg-date-sep"><span>${this.dateSepText(m.created_at)}</span></div>`;
            lastDate = msgDate;
            this._lastRenderedDate = msgDate;
            lastSender = null;
        }
        if (m.sender_id !== lastSender) {
            flushGroup();
            lastSender = m.sender_id;
        }
        currentGroup.push(m);
    }
    flushGroup();
    area.innerHTML = html;
    area.scrollTop = area.scrollHeight;
};

// Append a single new message (smart grouping)
// CRITICAL: Has duplicate protection by ID AND by content + sender
App.appendChatMsg = function(m) {
    if (!m || !document.getElementById('msgChat')) return;
    // DEDUP CHECK 1: By message ID
    if (m.id && !String(m.id).startsWith('temp-') && document.querySelector(`[data-msg-id="${m.id}"]`)) return;
    // DEDUP CHECK 2: By content + sender (within last 5 seconds) — safety net
    // Check if a message with same content from same sender was added in last 5s
    const uid = Auth.getUid();
    const isMe = m.sender_id === uid;
    const recentEls = document.querySelectorAll('.msg-row');
    const now = Date.now();
    for (const el of recentEls) {
        const elTime = parseInt(el.dataset.ts || '0', 10);
        if (now - elTime < 5000) {
            const bubble = el.querySelector('.msg-bubble');
            if (bubble && bubble.textContent.trim() === (m.content || '').trim()) {
                // Same content from same type of sender within 5s — likely duplicate
                if ((isMe && el.closest('.msg-group.sent')) || (!isMe && el.closest('.msg-group.received'))) {
                    console.log('[MSG] Content-based dedup prevented duplicate');
                    return;
                }
            }
        }
    }
    const area = document.getElementById('msgChat');
    const sender = m.sender || (isMe ? Auth.profile : this._chatOtherProfile) || {};
    // Remove empty state
    const emptyState = area.querySelector('.no-content');
    if (emptyState) emptyState.remove();
    // Check if we should add date separator
    const msgDate = m.created_at ? new Date(m.created_at).toDateString() : new Date().toDateString();
    if (this._lastRenderedDate !== msgDate) {
        const sep = document.createElement('div');
        sep.className = 'msg-date-sep';
        sep.innerHTML = `<span>${this.dateSepText(m.created_at)}</span>`;
        area.appendChild(sep);
        this._lastRenderedDate = msgDate;
    }
    // Check if we can append to last group
    const lastGroup = area.querySelector('.msg-group:last-child');
    if (lastGroup && lastGroup.classList.contains(isMe ? 'sent' : 'received')) {
        // Update previous last -> middle
        const prevLast = lastGroup.querySelector('.msg-row.last, .msg-row.single');
        if (prevLast) {
            if (prevLast.classList.contains('single')) prevLast.className = prevLast.className.replace('single', 'first');
            else prevLast.className = prevLast.className.replace('last', 'middle');
        }
        // Add new as last
        const wrap = document.createElement('div');
        wrap.innerHTML = this.msgBubble(m, uid, 'last', false);
        if (wrap.firstElementChild) {
            wrap.firstElementChild.dataset.ts = String(Date.now());
            lastGroup.appendChild(wrap.firstElementChild);
        }
    } else {
        // New group
        const wrap = document.createElement('div');
        wrap.innerHTML = `<div class="msg-group ${isMe ? 'sent' : 'received'}">${this.msgBubble(m, uid, 'single', true)}</div>`;
        if (wrap.firstElementChild) {
            const row = wrap.firstElementChild.querySelector('.msg-row');
            if (row) row.dataset.ts = String(Date.now());
            area.appendChild(wrap.firstElementChild);
        }
    }
    // Smooth scroll
    requestAnimationFrame(() => { area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' }); });
};

// Send text message with optimistic UI
App.sendChatText = async function() {
    this.closeEmojiPicker();
    const input = document.getElementById('chatInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !this.roomId) return;
    const uid = Auth.getUid();
    const roomId = this.roomId;

    // Optimistic UI: show message immediately
    const optimisticMsg = { id: 'temp-' + Date.now(), sender_id: uid, room_id: roomId, content: text, created_at: new Date().toISOString(), is_read: false };
    this.appendChatMsg(optimisticMsg);
    input.value = '';

    // Save to Supabase
    try {
        const result = await DB.sendMessage({ room_id: roomId, sender_id: uid, content: text });
        if (result && result.id) {
            // Replace optimistic message with real one
            const tempEl = document.querySelector(`[data-msg-id="${optimisticMsg.id}"]`);
            if (tempEl) tempEl.setAttribute('data-msg-id', result.id);
            // Refresh room list to update last message preview
            this.renderMessages();
            // Send notification to recipient
            try {
                const room = await getSb().from('chat_rooms').select('*').eq('id', roomId).maybeSingle();
                if (room?.data) {
                    const recipientId = room.data.participant_1 === uid ? room.data.participant_2 : room.data.participant_1;
                    await this.notifyNewMessage(roomId, uid, recipientId, text);
                }
            } catch (n) { console.error('[NOTIF] Message notification:', n.message); }
        } else {
            console.error('[MSG] sendMessage returned null');
            this.toast('Failed to send', 'error');
        }
    } catch (e) {
        console.error('[MSG] sendChatText error:', e.message);
        this.toast('Failed to send: ' + (e.message || ''), 'error');
    }
};

// Send media file
App.sendChatFile = async function(e) {
    const file = e.target.files?.[0];
    if (!file || !this.roomId) return;
    this.toast('Uploading...', 'info');
    try {
        const url = await Storage.uploadChatFile(Auth.getUid(), file);
        if (!url) { this.toast('Upload failed', 'error'); return; }
        const result = await DB.sendMessage({ room_id: this.roomId, sender_id: Auth.getUid(), media_url: url, is_video: file.type.startsWith('video/') });
        if (result) { this.appendChatMsg(result); this.renderMessages(); }
        else this.toast('Failed to send media', 'error');
    } catch (e) { console.error('[MSG] sendChatFile error:', e.message); this.toast('Failed', 'error'); }
    e.target.value = '';
};

// Simple emoji picker - inserts emoji into chat input
App._emojiPickerOpen = false;
App._emojiCursorPos = 0;

App.openEmojiPicker = function() {
    const existing = document.getElementById('emojiPicker');
    if (existing) { existing.remove(); this._emojiPickerOpen = false; return; }

    const input = document.getElementById('chatInput');
    if (!input) return;

    // Save cursor position before input loses focus
    this._emojiCursorPos = input.selectionStart || input.value.length;

    const emojis = ['😀','😂','🥰','😍','😘','😊','🙂','🙃','😉','😌','😎','🤔','😢','😭','😡','🥳','👍','👎','👏','🙏','❤️','💔','🔥','✨','🎉','💯','👀','🤷','🤦','💪','🌹','🎁','💰','👋','🤝','✅','❌','⭐','🎵','💤'];

    const picker = document.createElement('div');
    picker.id = 'emojiPicker';
    picker.style.cssText = 'position:fixed;bottom:112px;left:0;right:0;background:var(--bg-card);border-top:1px solid var(--border);padding:8px 12px 12px;z-index:98;max-height:200px;overflow-y:auto;-webkit-overflow-scrolling:touch;';

    // Close button header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;border-bottom:1px solid var(--border);margin-bottom:8px;';
    header.innerHTML = '<span style="font-size:12px;color:var(--text-secondary);font-weight:600">Emojis</span><button type="button" onclick="App.closeEmojiPicker()" style="background:none;border:none;color:var(--text-secondary);font-size:18px;padding:4px;cursor:pointer;"><i class="fas fa-times"></i></button>';
    picker.appendChild(header);

    // Emoji grid
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:4px;';
    grid.innerHTML = emojis.map(e => `<button type="button" style="background:none;border:none;font-size:24px;padding:6px;cursor:pointer;text-align:center;border-radius:8px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;" onmousedown="event.preventDefault()" ontouchstart="event.preventDefault()" onclick="App.insertEmoji('${e}')">${e}</button>`).join('');
    picker.appendChild(grid);

    document.body.appendChild(picker);
    this._emojiPickerOpen = true;

    // Tap outside to close (delay to avoid immediate close from the same click)
    setTimeout(() => {
        document.addEventListener('click', App._emojiOutsideClick, { once: true });
    }, 100);
};

App._emojiOutsideClick = function(e) {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    // Don't close if clicking inside the picker or on the emoji button
    if (picker.contains(e.target)) return;
    const emojiBtn = e.target.closest('button');
    if (emojiBtn && emojiBtn.innerHTML.includes('fa-smile')) return;
    App.closeEmojiPicker();
};

App.closeEmojiPicker = function() {
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.remove();
    App._emojiPickerOpen = false;
};

App.insertEmoji = function(emoji) {
    const input = document.getElementById('chatInput');
    if (!input) return;

    const pos = App._emojiCursorPos;
    const before = input.value.substring(0, pos);
    const after = input.value.substring(pos);
    input.value = before + emoji + after;

    // Update cursor position after inserted emoji
    const newPos = pos + emoji.length;
    input.setSelectionRange(newPos, newPos);
    App._emojiCursorPos = newPos;

    // Close picker and refocus
    App.closeEmojiPicker();

    // Small delay to let the picker DOM remove before focusing
    setTimeout(() => {
        input.focus();
        input.setSelectionRange(newPos, newPos);
    }, 50);
};

// Start messaging a creator from profile page
App.messageCreator = async function() {
    if (!Auth.isAuth()) { this.showAuth('login'); return; }
    if (!this.creatorId || this.creatorId === Auth.getUid()) { this.toast('Cannot message yourself', 'warning'); return; }
    console.log('[MSG] Starting chat with creator', this.creatorId);
    try {
        const room = await DB.getOrCreateRoom(Auth.getUid(), this.creatorId);
        if (room) {
            console.log('[MSG] Room ready:', room.id);
            this.roomId = room.id;
            this.go('messages');
            const otherId = room.participant_1 === Auth.getUid() ? room.participant_2 : room.participant_1;
            setTimeout(() => this.openRoom(room.id, otherId), 200);
        } else {
            console.error('[MSG] getOrCreateRoom returned null');
            this.toast('Could not start chat', 'error');
        }
    } catch (e) { console.error('[MSG] messageCreator error:', e.message); this.toast('Failed to start chat', 'error'); }
};

// Search conversations
App.filterMessages = function() {
    const query = (document.getElementById('msgSearch')?.value || '').toLowerCase();
    document.querySelectorAll('#msgList .msg-item').forEach(item => {
        const nameEl = item.querySelector('.msg-preview-name');
        item.style.display = (nameEl?.textContent?.toLowerCase() || '').includes(query) ? '' : 'none';
    });
};

// Update unread badge in navbar
App.updateUnreadBadge = async function() {
    if (!Auth.isAuth()) return;
    try {
        const count = await DB.countTotalUnread(Auth.getUid());
        const badge = document.getElementById('msgBadge');
        if (badge) {
            if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = 'flex'; }
            else badge.style.display = 'none';
        }
    } catch (e) {}
};

// ===================== NOTIFICATION SYSTEM =====================
App._notifs = [];
App._notifRealtime = null;

// Initialize notification realtime subscription
App.initNotifRealtime = function() {
    if (!Auth.isAuth()) return;
    const uid = Auth.getUid();
    try {
        if (this._notifRealtime) { try { this._notifRealtime.unsubscribe(); } catch (e) {} this._notifRealtime = null; }
        this._notifRealtime = DB.subscribeToNotifs(uid, (payload) => {
            console.log('[NOTIF] New notification received', payload);
            // Refresh UI
            this.renderNotifications();
            this.updateNotifBadge();
            // Show toast for the new notification
            try {
                const newNotif = payload.new;
                if (newNotif && !newNotif.is_read) {
                    const shortTitle = newNotif.title && newNotif.title.length > 50
                        ? newNotif.title.substring(0, 50) + '...'
                        : (newNotif.title || 'New notification');
                    this.toast(shortTitle, 'info', 4000);
                }
            } catch (t) {}
            // Vibrate on mobile
            if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        });
    } catch (e) { console.error('[NOTIF] Realtime init failed:', e.message); }
};

// Update notification badge count
App.updateNotifBadge = async function() {
    if (!Auth.isAuth()) return;
    try {
        const count = await DB.getUnreadNotifCount(Auth.getUid());
        // Top nav badge
        const badge = document.getElementById('notifBadge');
        if (badge) {
            if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = 'flex'; }
            else badge.style.display = 'none';
        }
        // Bottom nav badge
        const bottomBadge = document.getElementById('bottomNotifBadge');
        if (bottomBadge) {
            if (count > 0) { bottomBadge.textContent = count > 9 ? '9+' : count; bottomBadge.style.display = 'flex'; }
            else bottomBadge.style.display = 'none';
        }
    } catch (e) {}
};

// Render notifications in user profile
App.renderNotifications = async function() {
    if (!Auth.isAuth()) return;
    try {
        const notifs = await DB.getNotifs(Auth.getUid(), 50);
        this._notifs = notifs;
        const list = document.getElementById('userNotifsList');
        if (!list) return;
        list.innerHTML = notifs.length ? notifs.map(n => this.notifItemHtml(n)).join('') : '<p class="no-content">No notifications yet</p>';
        this.updateNotifBadge();
    } catch (e) { console.error('[NOTIF] render:', e.message); }
};

// Render full notification center
App.renderNotificationCenter = async function() {
    if (!Auth.isAuth()) { this.showAuth('login'); return; }
    this.go('notifications');
    try {
        const notifs = await DB.getNotifs(Auth.getUid(), 100);
        this._notifs = notifs;
        const list = document.getElementById('notifCenterList');
        const unreadCount = notifs.filter(n => !n.is_read).length;
        const unreadEl = document.getElementById('notifCenterUnread');
        if (unreadEl) unreadEl.textContent = unreadCount;
        if (!list) return;
        list.innerHTML = notifs.length ? notifs.map(n => this.notifCenterItemHtml(n)).join('') : '<div class="no-content"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>';
    } catch (e) { console.error('[NOTIF] center render:', e.message); }
};

// ============================================================
// COMPLETE NOTIFICATION ICON & COLOR MAPS
// Supports all notification types across the platform
// ============================================================
App._notifIcons = {
    welcome: 'fa-hand-sparkles',
    new_fan: 'fa-user-plus',
    new_creator: 'fa-user-plus',
    new_post: 'fa-image',
    new_image: 'fa-camera',
    new_video: 'fa-video',
    new_vip_video: 'fa-crown',
    new_gallery: 'fa-images',
    new_subscription: 'fa-credit-card',
    new_like: 'fa-heart',
    new_comment: 'fa-comment',
    new_message: 'fa-comment-dots',
    verification_approved: 'fa-check-circle',
    verification_declined: 'fa-times-circle',
    payment_received: 'fa-money-bill-wave',
    payment_approved: 'fa-check-circle',
    payment_declined: 'fa-times-circle',
    withdrawal_approved: 'fa-check-circle',
    withdrawal_declined: 'fa-times-circle',
    owner_announcement: 'fa-bullhorn',
    subscription_expiry: 'fa-clock',
    vip_expiry: 'fa-crown',
    tip: 'fa-gift',
    follow: 'fa-user-plus',
    post: 'fa-image',
    vip: 'fa-crown',
    message: 'fa-comment-dots',
    subscription: 'fa-credit-card',
    like: 'fa-heart',
    comment: 'fa-comment',
    system: 'fa-info-circle',
    general: 'fa-bell'
};

App._notifColors = {
    welcome: 'var(--primary)',
    new_fan: 'var(--green)',
    new_creator: 'var(--purple)',
    new_post: 'var(--green)',
    new_image: 'var(--blue)',
    new_video: 'var(--red)',
    new_vip_video: 'var(--gold)',
    new_gallery: 'var(--green)',
    new_subscription: 'var(--purple)',
    new_like: 'var(--red)',
    new_comment: 'var(--blue)',
    new_message: 'var(--blue)',
    verification_approved: 'var(--green)',
    verification_declined: 'var(--red)',
    payment_received: 'var(--green)',
    payment_approved: 'var(--green)',
    payment_declined: 'var(--red)',
    withdrawal_approved: 'var(--green)',
    withdrawal_declined: 'var(--red)',
    owner_announcement: 'var(--orange)',
    subscription_expiry: 'var(--orange)',
    vip_expiry: 'var(--gold)',
    tip: 'var(--pink)',
    follow: 'var(--green)',
    post: 'var(--green)',
    vip: 'var(--gold)',
    message: 'var(--blue)',
    subscription: 'var(--purple)',
    like: 'var(--red)',
    comment: 'var(--blue)',
    system: 'var(--text-secondary)',
    general: 'var(--text-secondary)'
};

// Notification item HTML for profile page
App.notifItemHtml = function(n) {
    const icon = this._notifIcons[n.type] || this._notifIcons.general;
    const color = this._notifColors[n.type] || this._notifColors.general;
    const time = this.timeAgo(n.created_at);
    return `<div class="notif-item ${n.is_read ? 'read' : 'unread'}" onclick="App.handleNotifClick('${n.id}', '${n.type}', '${n.related_id || ''}', '${n.related_type || ''}')" data-notif-id="${n.id}"><div class="notif-icon" style="background:${color}15;color:${color}"><i class="fas ${icon}"></i></div><div class="notif-content"><div class="notif-title">${this.esc(n.title)}</div><div class="notif-body">${this.esc(n.body || '')}</div><div class="notif-time">${time}</div></div>${!n.is_read ? '<div class="notif-dot"></div>' : ''}</div>`;
};

// Notification center item HTML
App.notifCenterItemHtml = function(n) {
    const icon = this._notifIcons[n.type] || this._notifIcons.general;
    const color = this._notifColors[n.type] || this._notifColors.general;
    const time = this.timeAgo(n.created_at);
    return `<div class="notif-center-item ${n.is_read ? 'read' : 'unread'}" data-notif-id="${n.id}"><div class="notif-center-icon" style="background:${color}15;color:${color}"><i class="fas ${icon}"></i></div><div class="notif-center-content" onclick="App.handleNotifClick('${n.id}', '${n.type}', '${n.related_id || ''}', '${n.related_type || ''}')"><div class="notif-center-title">${this.esc(n.title)}</div><div class="notif-center-body">${this.esc(n.body || '')}</div><div class="notif-center-time">${time}</div></div><div class="notif-center-actions"><button class="notif-action-btn" onclick="event.stopPropagation();App.markNotifRead('${n.id}')" title="Mark as read"><i class="fas ${n.is_read ? 'fa-check' : 'fa-check-circle'}"></i></button><button class="notif-action-btn" onclick="event.stopPropagation();App.deleteNotif('${n.id}')" title="Delete"><i class="fas fa-trash-alt"></i></button></div></div>`;
};

// Handle notification click - navigate to the correct page based on type
App.handleNotifClick = async function(id, type, relatedId, relatedType) {
    await DB.markNotifRead(id);
    this.renderNotifications();
    this.updateNotifBadge();

    // New user joined / new creator joined -> open their profile
    if ((type === 'new_fan' || type === 'new_creator') && relatedId) {
        this.creatorId = relatedId;
        this.go('creator-profile');
        return;
    }
    // New post / new image / new video / new gallery / like / comment -> open the post
    if ((type === 'new_post' || type === 'new_image' || type === 'new_video' || type === 'new_gallery' || type === 'post' || type === 'new_like' || type === 'new_comment') && relatedId) {
        this.openPost(relatedId);
        return;
    }
    // VIP content -> open VIP video
    if ((type === 'new_vip_video' || type === 'vip') && relatedId) {
        this.openVipVideo(relatedId);
        return;
    }
    // Message -> open messages
    if (type === 'new_message' || type === 'message') {
        this.go('messages');
        return;
    }
    // Subscription related -> user profile
    if (type === 'new_subscription' || type === 'subscription' || type === 'subscription_expiry') {
        this.go('user-profile');
        return;
    }
    // Payment related -> user profile
    if (type === 'payment_approved' || type === 'payment_declined' || type === 'payment_received' || type === 'withdrawal_approved' || type === 'withdrawal_declined') {
        this.go('user-profile');
        return;
    }
    // VIP expiry -> user profile
    if (type === 'vip_expiry') {
        this.go('user-profile');
        return;
    }
    // Verification -> user profile
    if (type === 'verification_approved' || type === 'verification_declined') {
        this.go('user-profile');
        return;
    }
    // Owner announcement -> feed (or could be a special announcements page)
    if (type === 'owner_announcement') {
        this.go('feed');
        return;
    }
    // Welcome -> feed
    if (type === 'welcome') {
        this.go('feed');
        return;
    }
};

App.markNotifRead = async function(id) {
    if (!id) return;
    try { await DB.markNotifRead(id); this.renderNotificationCenter(); this.renderNotifications(); this.updateNotifBadge(); } catch (e) {}
};

App.markAllNotifsRead = async function() {
    if (!Auth.isAuth()) return;
    try {
        await DB.markAllNotifsRead(Auth.getUid());
        this.toast('All notifications marked as read', 'success');
        this.renderNotificationCenter();
        this.renderNotifications();
        this.updateNotifBadge();
    } catch (e) { this.toast('Failed', 'error'); }
};

App.deleteNotif = async function(id) {
    if (!id) return;
    try {
        await DB.deleteNotification(id);
        this.renderNotificationCenter();
        this.renderNotifications();
        this.updateNotifBadge();
    } catch (e) {}
};

// ============================================================
// NOTIFICATION HELPERS - Send notifications for platform events
// ============================================================

// Core send helper
App.sendNotification = async function(userId, type, title, body, relatedId, relatedType, senderId) {
    if (!userId) return;
    try {
        await DB.createNotification({
            user_id: userId, type, title, body,
            related_id: relatedId || '',
            related_type: relatedType || '',
            sender_id: senderId || null
        });
    } catch (e) { console.error('[NOTIF] send:', e.message); }
};

// FEATURE 1: New user joined - broadcast to ALL existing users
// (This is also handled by the database trigger, but client-side
//  broadcast is kept as a fallback for edge cases)
App.notifyNewUserJoined = async function(userId, displayName) {
    if (!userId || !displayName) return;
    try {
        await DB.broadcastNotification({
            type: 'new_fan',
            title: displayName + ' has joined OnlyFans.',
            body: 'A new user just joined the platform. Welcome them!',
            related_id: userId,
            related_type: 'profile',
            sender_id: userId,
            exclude_user_id: userId
        });
    } catch (e) { console.error('[NOTIF] newUserJoined:', e.message); }
};

// FEATURE 1b: New creator joined - broadcast to ALL users
App.notifyNewCreatorJoined = async function(creatorId, displayName) {
    if (!creatorId || !displayName) return;
    try {
        await DB.broadcastNotification({
            type: 'new_creator',
            title: displayName + ' has joined OnlyFans as a creator!',
            body: 'A new creator just joined. Check out their content!',
            related_id: creatorId,
            related_type: 'profile',
            sender_id: creatorId,
            exclude_user_id: creatorId
        });
    } catch (e) { console.error('[NOTIF] newCreatorJoined:', e.message); }
};

// FEATURE 2: Creator published new post - notify subscribers
// (Also handled by database trigger; JS version is fallback)
App.notifyNewPost = async function(creatorId, postId) {
    if (!creatorId || !postId) return;
    try {
        const creator = await DB.getProfile(creatorId);
        const creatorName = creator?.display_name || creator?.username || 'A creator';
        const count = await DB.notifyCreatorSubscribers(creatorId, {
            type: 'new_post',
            title: '@' + creatorName + ' posted new content.',
            body: creatorName + ' has shared new exclusive content. Check it out!',
            related_id: postId,
            related_type: 'post'
        });
        console.log('[NOTIF] notifyNewPost: sent to', count, 'subscribers');
    } catch (e) { console.error('[NOTIF] newPost:', e.message); }
};

// FEATURE 3: Creator published VIP content - notify subscribers
App.notifyNewVip = async function(creatorId, videoId) {
    if (!creatorId || !videoId) return;
    try {
        const creator = await DB.getProfile(creatorId);
        const creatorName = creator?.display_name || creator?.username || 'A creator';
        const count = await DB.notifyCreatorSubscribers(creatorId, {
            type: 'new_vip_video',
            title: '@' + creatorName + ' uploaded new exclusive content.',
            body: 'New VIP content is available from ' + creatorName + '. Unlock it now!',
            related_id: videoId,
            related_type: 'vip_video'
        });
        console.log('[NOTIF] notifyNewVip: sent to', count, 'subscribers');
    } catch (e) { /* notification error ignored */ }
};

// FEATURE 5: New like on post - notify post creator (also handled by trigger)
App.notifyNewLike = async function(postId, likerId, creatorId) {
    if (!postId || !likerId || !creatorId || likerId === creatorId) return;
    try {
        const liker = await DB.getProfile(likerId);
        const likerName = liker?.display_name || liker?.username || 'Someone';
        await this.sendNotification(creatorId, 'new_like', likerName + ' liked your post.', likerName + ' liked your content.', postId, 'post', likerId);
    } catch (e) { console.error('[NOTIF] newLike:', e.message); }
};

// FEATURE 6: New comment on post - notify post creator
App.notifyNewComment = async function(postId, commenterId, creatorId, commentText) {
    if (!postId || !commenterId || !creatorId || commenterId === creatorId) return;
    try {
        const commenter = await DB.getProfile(commenterId);
        const name = commenter?.display_name || commenter?.username || 'Someone';
        await this.sendNotification(creatorId, 'new_comment', name + ' commented on your post.', '"' + (commentText || '').substring(0, 60) + '"', postId, 'post', commenterId);
    } catch (e) { console.error('[NOTIF] newComment:', e.message); }
};

// FEATURE 7: New subscription - notify creator (also handled by trigger)
App.notifyNewSubscription = async function(subscriberId, creatorId, planType, amount) {
    if (!subscriberId || !creatorId) return;
    try {
        const subscriber = await DB.getProfile(subscriberId);
        const name = subscriber?.display_name || subscriber?.username || 'Someone';
        await this.sendNotification(creatorId, 'new_subscription', name + ' subscribed to your ' + (planType || 'monthly') + ' plan!', 'You have a new subscriber! They paid $' + parseFloat(amount || 0).toFixed(2), subscriberId, 'profile', subscriberId);
    } catch (e) { console.error('[NOTIF] newSubscription:', e.message); }
};

// FEATURE 8: New message - notify recipient
App.notifyNewMessage = async function(roomId, senderId, recipientId, content) {
    if (!recipientId || senderId === recipientId) return;
    try {
        const sender = await DB.getProfile(senderId);
        const senderName = sender?.display_name || sender?.username || 'Someone';
        await this.sendNotification(recipientId, 'new_message', 'New message from ' + senderName, (content || '').substring(0, 80), roomId, 'chat_room', senderId);
    } catch (e) { console.error('[NOTIF] newMessage:', e.message); }
};

// Payment notifications
App.notifyPaymentReceived = async function(creatorId, paymentId, amount, method) {
    if (!creatorId) return;
    await this.sendNotification(creatorId, 'payment_received', 'New Payment Request', 'You received a new $' + parseFloat(amount || 0).toFixed(2) + ' payment request via ' + (method || 'unknown') + '.', paymentId, 'payment');
};

App.notifyPaymentApproved = async function(userId, paymentId) {
    if (!userId) return;
    await this.sendNotification(userId, 'payment_approved', 'Payment Approved', 'Your payment has been approved! You now have full access.', paymentId, 'payment');
};

App.notifyPaymentDeclined = async function(userId, paymentId) {
    if (!userId) return;
    await this.sendNotification(userId, 'payment_declined', 'Payment Declined', 'Your payment was declined. Please contact support for assistance.', paymentId, 'payment');
};

// Verification approved notification
App.notifyVerificationApproved = async function(creatorId) {
    if (!creatorId) return;
    await this.sendNotification(creatorId, 'verification_approved', 'You are now verified!', 'Your blue verified badge has been approved. It is now visible on your profile.', '', '');
};

// Owner announcement - broadcast to ALL users
App.notifyOwnerAnnouncement = async function(title, body) {
    if (!title) return;
    try {
        const count = await DB.broadcastNotification({
            type: 'owner_announcement',
            title: title,
            body: body || '',
            related_id: '',
            related_type: ''
        });
        console.log('[NOTIF] Owner announcement sent to', count, 'users');
    } catch (e) { console.error('[NOTIF] ownerAnnouncement:', e.message); }
};

// Subscription expiry notifications
App.notifySubscriptionExpiring = async function(userId, subscriptionId, hoursLeft) {
    if (!userId) return;
    await this.sendNotification(userId, 'subscription_expiry', 'Subscription Expiring Soon', 'Your subscription expires in ' + hoursLeft + ' hours. Renew now to keep access!', subscriptionId, 'subscription');
};

App.notifySubscriptionExpired = async function(userId, subscriptionId) {
    if (!userId) return;
    await this.sendNotification(userId, 'subscription_expiry', 'Subscription Expired', 'Your subscription has expired. Renew to regain access to exclusive content.', subscriptionId, 'subscription');
};

App.notifyVipExpiring = async function(userId, purchaseId, hoursLeft) {
    if (!userId) return;
    await this.sendNotification(userId, 'vip_expiry', 'VIP Access Expiring', 'Your VIP access expires in ' + hoursLeft + ' hours.', purchaseId, 'vip_purchase');
};

// Welcome notification
App.notifyWelcome = async function(userId) {
    if (!userId) return;
    await this.sendNotification(userId, 'welcome', 'Welcome to OnlyFans!', 'We are excited to have you here. Explore creators and subscribe to exclusive content.', '', '');
};

// ===================== SUBSCRIPTIONS & PAYMENTS (MANUAL ONLY) =====================
App.subscribe = async function(plan) {
    if (!Auth.isAuth()) { this.showAuth('signup'); return; }
    if (!this.creatorId) return;
    try {
        const p = await DB.getProfile(this.creatorId);
        // Get price from creator's plans (new system) with fallback to profile fields
        let amount = p?.monthly_price || 20;
        if (this._creatorPlans?.prices) {
            amount = this._creatorPlans.prices[plan] !== undefined ? this._creatorPlans.prices[plan] : amount;
        } else {
            if (plan === 'weekly') amount = p?.weekly_price || 5;
            if (plan === 'vip') amount = p?.vip_price || 50;
        }
        this.plan = plan;
        this.payTarget = { type: plan, creatorId: this.creatorId, amount };
        const info = document.getElementById('paymentTargetInfo');
        if (info) info.innerHTML = `<div style="display:flex;align-items:center;gap:12px"><div style="width:48px;height:48px;border-radius:50%;background-image:url('${p?.avatar || ''}');background-size:cover;background-color:var(--border)"></div><div><div style="font-weight:700">${this.esc(p?.display_name || p?.username || '')}</div><div style="font-size:13px;color:var(--text-secondary)">${plan.charAt(0).toUpperCase() + plan.slice(1)} Subscription - $${amount}</div></div></div>`;
        // Load creator payment settings for QR codes
        const settings = await DB.getPaymentSettings(this.creatorId);
        const btcDisplay = document.getElementById('btcAddressDisplay'); const usdtDisplay = document.getElementById('usdtAddressDisplay'); const usdtBadge = document.getElementById('usdtNetworkBadge');
        const btcQRBox = document.getElementById('btcQRBox'); const usdtQRBox = document.getElementById('usdtQRBox');
        if (btcDisplay) btcDisplay.textContent = settings?.btc_address || 'Not configured';
        if (usdtDisplay) usdtDisplay.textContent = settings?.usdt_address || 'Not configured';
        if (usdtBadge) usdtBadge.textContent = settings?.usdt_network || 'TRC20';
        const btcQrUrl = settings?.btc_qr_url;
        const usdtQrUrl = settings?.usdt_qr_url;
        if (btcQRBox) { if (btcQrUrl) { btcQRBox.style.backgroundImage = `url('${btcQrUrl}')`; btcQRBox.style.backgroundSize = 'cover'; btcQRBox.innerHTML = ''; } else { btcQRBox.style.backgroundImage = 'none'; btcQRBox.innerHTML = 'QR Code<br>Not Set'; } }
        if (usdtQRBox) { if (usdtQrUrl) { usdtQRBox.style.backgroundImage = `url('${usdtQrUrl}')`; usdtQRBox.style.backgroundSize = 'cover'; usdtQRBox.innerHTML = ''; } else { usdtQRBox.style.backgroundImage = 'none'; usdtQRBox.innerHTML = 'QR Code<br>Not Set'; } }
        // Reset and initialize gift card selection
        this.resetGiftcardForm();
        this.openModal('paymentModal');
    } catch (e) { this.toast('Failed to load payment info', 'error'); }
};

// Reset gift card form and set default selection
App.resetGiftcardForm = function() {
    this.gcType = 'razer';
    document.querySelectorAll('.pay-card[data-gc]').forEach(b => b.classList.remove('selected'));
    const defaultCard = document.querySelector('.pay-card[data-gc="razer"]');
    if (defaultCard) defaultCard.classList.add('selected');
    // Clear form fields
    const gcValue = document.getElementById('gcValue');
    const gcCode = document.getElementById('gcCode');
    const gcCountry = document.getElementById('gcCountry');
    const gcCountryInput = document.getElementById('gcCountryInput');
    if (gcValue) gcValue.value = '';
    if (gcCode) gcCode.value = '';
    if (gcCountry) gcCountry.value = '';
    if (gcCountryInput) gcCountryInput.value = '';
    // Clear image previews
    this._gcFrontDataUrl = null;
    this._gcBackDataUrl = null;
    const gcFrontPreview = document.getElementById('gcFrontPreview');
    const gcBackPreview = document.getElementById('gcBackPreview');
    if (gcFrontPreview) gcFrontPreview.innerHTML = '<i class="fas fa-image"></i><span>Tap to upload front</span>';
    if (gcBackPreview) gcBackPreview.innerHTML = '<i class="fas fa-image"></i><span>Tap to upload back</span>';
};

App.isSubscribed = async function(creatorId) {
    if (!Auth.isAuth() || !creatorId) return false;
    try { const sub = await DB.getSubscription(Auth.getUid(), creatorId); return sub?.status === 'approved' && sub?.expires_at && new Date(sub.expires_at) > new Date(); } catch (e) { return false; }
};

// Submit payment request (fan side) - saves as PENDING
App.submitGiftcard = async function() {
    // Validation
    const value = document.getElementById('gcValue')?.value.trim();
    const code = document.getElementById('gcCode')?.value.trim();
    const country = document.getElementById('gcCountry')?.value;
    // Validate gift card selection - check both the variable AND the visual state
    const selectedCard = document.querySelector('.pay-card.selected');
    if (!this.gcType || !selectedCard) { this.toast('Please select a gift card type', 'error'); return; }
    if (!value) { this.toast('Enter card value', 'error'); return; }
    if (!code) { this.toast('Enter card code', 'error'); return; }
    if (!country) { this.toast('Select country', 'error'); return; }
    if (!this._gcFrontDataUrl) { this.toast('Upload front of gift card', 'error'); return; }
    if (!this._gcBackDataUrl) { this.toast('Upload back of gift card', 'error'); return; }
    if (!Auth.isAuth()) { this.showAuth('login'); return; }
    this.toast('Uploading images...', 'info');
    try {
        const pt = this.payTarget; if (!pt) { this.toast('Payment target missing', 'error'); return; }
        const uid = Auth.getUid();
        // Upload images to Supabase Storage (fallback to data URL if bucket missing)
        let frontUrl = '', backUrl = '';
        try {
            const frontBlob = await (await fetch(this._gcFrontDataUrl)).blob();
            const frontFile = new File([frontBlob], 'gc_front_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            frontUrl = await Storage.uploadGiftCardImage(uid, frontFile) || '';
        } catch (upErr) { console.error('[GC] Front upload:', upErr.message); }
        try {
            const backBlob = await (await fetch(this._gcBackDataUrl)).blob();
            const backFile = new File([backBlob], 'gc_back_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            backUrl = await Storage.uploadGiftCardImage(uid, backFile) || '';
        } catch (upErr) { console.error('[GC] Back upload:', upErr.message); }
        // FALLBACK: if bucket upload failed, store data URL directly so creator can still see images
        if (!frontUrl && this._gcFrontDataUrl) { frontUrl = this._gcFrontDataUrl; console.log('[GC] Using data URL fallback for front'); }
        if (!backUrl && this._gcBackDataUrl) { backUrl = this._gcBackDataUrl; console.log('[GC] Using data URL fallback for back'); }
        // Warn user if we're using local fallback
        if ((!frontUrl && this._gcFrontDataUrl) || (!backUrl && this._gcBackDataUrl)) {
            this.toast('Images saved locally. Run giftcard_update.sql in Supabase for cloud storage.', 'warning', 5000);
        }
        // Create payment with image URLs (data URL or cloud URL)
        await DB.createPayment({ user_id: uid, creator_id: pt.creatorId, amount: pt.amount, payment_type: pt.type, method: 'giftcard', gc_type: this.gcType, gc_value: value, gc_code: code, gc_country: country, gc_front_url: frontUrl, gc_back_url: backUrl, status: 'pending' });
        if (pt.type === 'vip' && pt.videoId) {
            await DB.createVipPurchase({ video_id: pt.videoId, buyer_id: uid, amount: pt.amount, status: 'pending', payment_method: 'giftcard' });
        } else {
            await DB.createSubscription({ subscriber_id: uid, creator_id: pt.creatorId, plan_type: pt.type, amount: pt.amount, status: 'pending' });
        }
        // Reset form
        this._gcFrontDataUrl = null; this._gcBackDataUrl = null;
        document.getElementById('gcValue').value = ''; document.getElementById('gcCode').value = '';
        document.getElementById('gcCountry').value = ''; document.getElementById('gcCountryInput').value = '';
        document.getElementById('gcFrontPreview').innerHTML = '<i class="fas fa-image"></i><span>Tap to upload front</span>';
        document.getElementById('gcBackPreview').innerHTML = '<i class="fas fa-image"></i><span>Tap to upload back</span>';
        document.getElementById('gcFrontBox').classList.remove('has-image');
        document.getElementById('gcBackBox').classList.remove('has-image');
        this.closeModal('paymentModal');
        this.toast('Payment request submitted! Waiting for creator approval.', 'success', 5000);
    } catch (e) { console.error('[PAY] Giftcard submit:', e.message); this.toast('Failed: ' + (e.message || ''), 'error'); }
};

App.submitCrypto = async function(method) {
    const txid = method === 'btc' ? document.getElementById('btcTxid')?.value.trim() : document.getElementById('usdtTxHash')?.value.trim();
    const amt = method === 'btc' ? document.getElementById('btcAmount')?.value.trim() : document.getElementById('usdtAmount')?.value.trim();
    if (!txid) { this.toast('Enter transaction ID', 'error'); return; } if (!Auth.isAuth()) { this.showAuth('login'); return; }
    try {
        const pt = this.payTarget; if (!pt) { this.toast('Payment target missing', 'error'); return; }
        const uid = Auth.getUid();
        await DB.createPayment({ user_id: uid, creator_id: pt.creatorId, amount: pt.amount, payment_type: pt.type, method, crypto_txid: txid, crypto_amount: amt, crypto_network: method === 'usdt' ? (document.getElementById('usdtNetworkBadge')?.textContent || 'TRC20') : 'BTC', status: 'pending' });
        if (pt.type === 'vip' && pt.videoId) {
            // VIP pay-per-view: only create VIP purchase record, NO subscription
            await DB.createVipPurchase({ video_id: pt.videoId, buyer_id: uid, amount: pt.amount, status: 'pending', payment_method: method });
        } else {
            // Weekly/Monthly subscription: create subscription record
            await DB.createSubscription({ subscriber_id: uid, creator_id: pt.creatorId, plan_type: pt.type, amount: pt.amount, status: 'pending' });
        }
        this.closeModal('paymentModal'); this.toast('Payment request submitted! Waiting for creator approval.', 'success', 5000);
    } catch (e) { console.error('[PAY] Crypto submit:', e.message); this.toast('Failed: ' + (e.message || ''), 'error'); }
};

// ===================== CREATOR DASHBOARD =====================
App.renderAdmin = async function() {
    if (!Auth.isCreator()) { this.toast('Creator only', 'error'); this.go('feed'); return; }
    await Auth.loadProfile(); const p = Auth.profile;
    const de = document.getElementById('dashEarnings'); const ds = document.getElementById('dashSubs'); const dp = document.getElementById('dashPosts'); const dt = document.getElementById('dashTips');
    if (de) de.textContent = '$' + parseFloat(p?.earnings_total || 0).toFixed(0); if (ds) ds.textContent = p?.subscribers_count || 0; if (dp) dp.textContent = p?.posts_count || 0; if (dt) dt.textContent = '$' + parseFloat(p?.tips_today || 0).toFixed(0);
    // Avatar & Cover
    const avPreview = document.getElementById('adminAvatarPreview'); const cvPreview = document.getElementById('adminCoverPreview');
    if (avPreview) { if (p?.avatar) { avPreview.style.backgroundImage = `url('${p.avatar}')`; avPreview.innerHTML = ''; } else { avPreview.style.backgroundImage = 'none'; avPreview.innerHTML = '<i class="fas fa-user" style="font-size:32px;color:var(--text-secondary)"></i>'; } }
    if (cvPreview) { if (p?.cover) { cvPreview.style.backgroundImage = `url('${p.cover}')`; cvPreview.innerHTML = ''; } else { cvPreview.style.backgroundImage = 'none'; cvPreview.innerHTML = '<i class="fas fa-image" style="font-size:32px;color:var(--text-secondary)"></i><span style="font-size:12px;color:var(--text-secondary);margin-top:6px">Tap to upload cover</span>'; } }
    // Forms
    const aen = document.getElementById('adminEditName'); const aeb = document.getElementById('adminEditBio'); const apm = document.getElementById('adminPriceMonthly'); const apw = document.getElementById('adminPriceWeekly'); const apv = document.getElementById('adminPriceVip');
    if (aen) aen.value = p?.display_name || ''; if (aeb) aeb.value = p?.bio || ''; if (apm) apm.value = p?.monthly_price || 20; if (apw) apw.value = p?.weekly_price || 5; if (apv) apv.value = p?.vip_price || 50;
    // QR previews
    try { const settings = await DB.getPaymentSettings(Auth.getUid()); if (settings) { const btcQrPreview = document.getElementById('btcQrPreview'); const usdtQrPreview = document.getElementById('usdtQrPreview'); const btcQrUrl = settings?.btc_qr_url; const usdtQrUrl = settings?.usdt_qr_url; if (btcQrPreview && btcQrUrl) { btcQrPreview.style.backgroundImage = `url('${btcQrUrl}')`; btcQrPreview.innerHTML = ''; } if (usdtQrPreview && usdtQrUrl) { usdtQrPreview.style.backgroundImage = `url('${usdtQrUrl}')`; usdtQrPreview.innerHTML = ''; } const cba = document.getElementById('creatorBtcAddress'); const cbe = document.getElementById('creatorBtcEnabled'); const cua = document.getElementById('creatorUsdtAddress'); const cun = document.getElementById('creatorUsdtNetwork'); const cue = document.getElementById('creatorUsdtEnabled'); if (cba) cba.value = settings.btc_address || ''; if (cbe) cbe.checked = settings.btc_enabled || false; if (cua) cua.value = settings.usdt_address || ''; if (cun) cun.value = settings.usdt_network || 'TRC20'; if (cue) cue.checked = settings.usdt_enabled || false; } } catch (e) {}
    // Posts with delete-btn class and data-id for event delegation
    try { const posts = await DB.getPosts(Auth.getUid()); const mg = document.getElementById('managePostsGrid'); if (mg) { mg.innerHTML = posts.length ? posts.map(p => `<div class="post-item manage-post-item" style="position:relative;overflow:hidden"><div style="width:100%;height:100%;background-image:url('${p.type === 'video' ? (p.thumbnail_url || p.media_url) : p.media_url}');background-size:cover;background-position:center"></div><div class="manage-post-overlay"><button class="btn btn-danger btn-sm delete-btn" style="width:80%;font-size:13px" data-action="delete-post" data-id="${p.id}" onclick="App.askDelete('${p.id}')"><i class="fas fa-trash-alt"></i> Delete</button><div style="color:#fff;font-size:11px;margin-top:4px;text-align:center">${p.type === 'video' ? '<i class="fas fa-video"></i> ' : ''}${this.esc(p.caption || '').substring(0, 20)}</div></div></div>`).join('') : '<div class="no-content"><i class="fas fa-image"></i>No posts</div>'; this.attachDeleteListeners(mg); } } catch (e) {}
    // VIP videos with delete-btn class and data-id
    try { const vips = await DB.getVipVideos(Auth.getUid()); const vl = document.getElementById('adminVipList'); if (vl) { vl.innerHTML = vips.length ? vips.map(v => `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)"><div style="width:80px;height:60px;border-radius:8px;background:#000;overflow:hidden;flex-shrink:0"><video preload="metadata" style="width:100%;height:100%;object-fit:cover" src="${v.video_url}"></video></div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(v.title)}</div><div style="font-size:13px;color:var(--text-secondary)">$${v.price}</div></div><button class="btn btn-danger btn-sm delete-btn" data-action="delete-vip" data-id="${v.id}" onclick="App.delVip('${v.id}')">Delete</button></div>`).join('') : '<p class="no-content">No VIP videos yet</p>'; this.attachDeleteListeners(vl); } } catch (e) {}
    this.renderSubs('all'); this.renderPayments('all'); this.renderAdminBadge(); this.setupPaymentRealtime(); this.setupBadgeRealtime(); this.renderCreatorLikeAnalytics(); this.loadSubscriptionPlans(); this.renderVipSubscribers();
};

// Payment Realtime - new requests appear instantly
App.setupPaymentRealtime = function() {
    const creatorId = Auth.getUid(); if (!creatorId) return;
    try {
        if (this._paymentRealtime) { try { this._paymentRealtime.unsubscribe(); } catch (e) {} }
        const client = getSb(); if (!client) return;
        this._paymentRealtime = client.channel(`payments:${creatorId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments', filter: `creator_id=eq.${creatorId}` }, (payload) => {
            console.log('[REALTIME] New payment request received');
            this.toast('New payment request!', 'info');
            this.renderPayments('all');
        }).subscribe();
    } catch (e) { console.warn('[REALTIME] Payment subscription failed:', e.message); }
};

App.switchAdminTab = function(tab, btn) { document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); if (btn) btn.classList.add('active'); document.querySelectorAll('#view-admin .tab-panel').forEach(p => p.classList.remove('active')); const target = document.getElementById('admin-' + tab); if (target) target.classList.add('active'); if (tab === 'boost') this.loadAllBoostPosts(); };
App.saveAdminProfile = async function() { try { await DB.updateProfile(Auth.getUid(), { display_name: document.getElementById('adminEditName')?.value, bio: document.getElementById('adminEditBio')?.value }); await Auth.loadProfile(); this.toast('Saved!', 'success'); } catch (e) { this.toast('Failed', 'error'); } };
App.handleAdminAvatarUpload = async function(e) { const file = e.target.files?.[0]; if (!file) return; this.toast('Uploading...', 'info'); try { const url = await Storage.uploadAvatar(Auth.getUid(), file); if (url) { await DB.updateProfile(Auth.getUid(), { avatar: url }); await Auth.loadProfile(); const avPreview = document.getElementById('adminAvatarPreview'); if (avPreview) { avPreview.style.backgroundImage = `url('${url}')`; avPreview.innerHTML = ''; } this.updateNav(); this.toast('Updated!', 'success'); } else this.toast('Upload failed', 'error'); } catch (e) { this.toast('Upload failed', 'error'); } };
App.handleAdminCoverUpload = async function(e) { const file = e.target.files?.[0]; if (!file) return; this.toast('Uploading...', 'info'); try { const url = await Storage.uploadCover(Auth.getUid(), file); if (url) { await DB.updateProfile(Auth.getUid(), { cover: url }); await Auth.loadProfile(); const cvPreview = document.getElementById('adminCoverPreview'); if (cvPreview) { cvPreview.style.backgroundImage = `url('${url}')`; cvPreview.innerHTML = ''; } this.toast('Updated!', 'success'); } else this.toast('Upload failed', 'error'); } catch (e) { this.toast('Upload failed', 'error'); } };
App.savePricing = async function() { try { await DB.updateProfile(Auth.getUid(), { monthly_price: parseFloat(document.getElementById('adminPriceMonthly')?.value) || 20, weekly_price: parseFloat(document.getElementById('adminPriceWeekly')?.value) || 5, vip_price: parseFloat(document.getElementById('adminPriceVip')?.value) || 50 }); await Auth.loadProfile(); this.toast('Saved!', 'success'); } catch (e) { this.toast('Failed', 'error'); } };

// ===================== SUBSCRIPTION PLANS MANAGEMENT =====================
App.loadSubscriptionPlans = async function() {
    if (!Auth.isAuth()) return;
    try {
        const plans = await DB.getCreatorPlans(Auth.getUid());
        const defaults = { weekly: { price: 5, enabled: true }, monthly: { price: 20, enabled: true }, vip: { price: 50, enabled: true } };
        plans.forEach(p => {
            const elPrice = document.getElementById('plan' + p.plan_type.charAt(0).toUpperCase() + p.plan_type.slice(1) + 'Price');
            const elEnabled = document.getElementById('plan' + p.plan_type.charAt(0).toUpperCase() + p.plan_type.slice(1) + 'Enabled');
            if (elPrice) elPrice.value = p.price;
            if (elEnabled) elEnabled.checked = p.enabled;
        });
    } catch (e) { console.error('[PLANS] Load:', e.message); }
};

App.saveSubscriptionPlans = async function() {
    if (!Auth.isAuth()) return;
    try {
        const uid = Auth.getUid();
        // Only save weekly and monthly plans - VIP is pay-per-view per item, not a subscription plan
        const plans = [
            { creator_id: uid, plan_type: 'weekly', price: parseFloat(document.getElementById('planWeeklyPrice')?.value) || 0, enabled: document.getElementById('planWeeklyEnabled')?.checked || false, sort_order: 1 },
            { creator_id: uid, plan_type: 'monthly', price: parseFloat(document.getElementById('planMonthlyPrice')?.value) || 0, enabled: document.getElementById('planMonthlyEnabled')?.checked || false, sort_order: 2 }
        ];
        for (const plan of plans) {
            await DB.upsertPlan(plan);
        }
        this.toast('Subscription plans saved!', 'success');
    } catch (e) { console.error('[PLANS] Save:', e.message); this.toast('Failed to save plans', 'error'); }
};

// ===================== MEDIA OPTIMIZATION SYSTEM =====================
// Compresses images and videos before upload to reduce storage usage

// File size limits (in bytes)
App.UPLOAD_LIMITS = {
    profile: 5 * 1024 * 1024,    // 5 MB
    post_image: 10 * 1024 * 1024, // 10 MB
    video: 200 * 1024 * 1024,     // 200 MB
    cover: 10 * 1024 * 1024,      // 10 MB
    qr: 2 * 1024 * 1024           // 2 MB
};

// Compression presets for different use cases
App.COMPRESS_PRESETS = {
    profile: { maxWidth: 800, maxHeight: 800, quality: 0.82, format: 'image/jpeg' },
    post:    { maxWidth: 1600, maxHeight: 1600, quality: 0.80, format: 'image/jpeg' },
    cover:   { maxWidth: 2000, maxHeight: 800, quality: 0.78, format: 'image/jpeg' },
    qr:      { maxWidth: 400, maxHeight: 400, quality: 0.85, format: 'image/jpeg' }
};

// Check file size against limit
App.checkFileSize = function(file, type) {
    const limit = this.UPLOAD_LIMITS[type] || this.UPLOAD_LIMITS.post_image;
    if (file.size > limit) {
        const limitMB = (limit / (1024 * 1024)).toFixed(0);
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        this.toast(`File too large (${sizeMB}MB). Maximum is ${limitMB}MB.`, 'error', 5000);
        return false;
    }
    return true;
};

// Format file size for display
App.formatFileSize = function(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

// Universal image compressor with preset support
// type: 'profile' | 'post' | 'cover' | 'qr'
App.compressImage = function(file, type) {
    return new Promise((resolve, reject) => {
        const preset = this.COMPRESS_PRESETS[type] || this.COMPRESS_PRESETS.post;
        this.toast(`Compressing image: ${this.formatFileSize(file.size)}...`, 'info', 2000);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Calculate dimensions maintaining aspect ratio
                let w = img.width, h = img.height;
                if (w > preset.maxWidth) { h = Math.round(h * (preset.maxWidth / w)); w = preset.maxWidth; }
                if (h > preset.maxHeight) { w = Math.round(w * (preset.maxHeight / h)); h = preset.maxHeight; }
                // Use OffscreenCanvas if available (faster), fallback to regular canvas
                let canvas;
                try { canvas = new OffscreenCanvas(w, h); } catch (err) {
                    canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                }
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                // Convert to blob
                const toBlob = (cb) => {
                    if (canvas instanceof OffscreenCanvas) {
                        canvas.convertToBlob({ type: preset.format, quality: preset.quality }).then(cb).catch(() => cb(null));
                    } else {
                        canvas.toBlob(cb, preset.format, preset.quality);
                    }
                };
                toBlob((blob) => {
                    if (!blob) { reject(new Error('Compression failed')); return; }
                    const ext = preset.format === 'image/png' ? '.png' : '.jpg';
                    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + ext;
                    const compressed = new File([blob], name, { type: preset.format });
                    const saved = ((file.size - compressed.size) / file.size * 100).toFixed(0);
                    if (saved > 5) this.toast(`Compressed: ${this.formatFileSize(file.size)} → ${this.formatFileSize(compressed.size)} (${saved}% smaller)`, 'success', 2000);
                    resolve(compressed);
                });
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
};

// Video compression: extract frames and create a compressed preview video
// On mobile browsers, this falls back to uploading original with size check
// ============================================================
// SAFE VIDEO COMPRESSION - Never hangs, works on all devices
// ============================================================
App.compressVideo = function(file) {
    return new Promise((resolve) => {
        // SAFETY: Always resolve within 3 seconds no matter what
        const safetyTimer = setTimeout(() => {
            console.log('[VIDEO] Compression safety timeout - using original file');
            resolve(file);
        }, 3000);

        // If file is under 50MB, skip compression entirely
        // Modern networks and Supabase can handle this fine
        if (file.size < 50 * 1024 * 1024) {
            clearTimeout(safetyTimer);
            console.log('[VIDEO] File under 50MB, skipping compression');
            resolve(file);
            return;
        }

        // For large files (>50MB), try lightweight compression
        // but ALWAYS fall back to original if anything goes wrong
        this.toast(`Large video (${this.formatFileSize(file.size)}). Attempting compression...`, 'info', 3000);

        try {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            const objUrl = URL.createObjectURL(file);

            const cleanup = () => {
                clearTimeout(safetyTimer);
                try { URL.revokeObjectURL(objUrl); } catch(e) {}
            };

            // If metadata doesn't load in 2 seconds, use original
            const metaTimer = setTimeout(() => {
                console.log('[VIDEO] Metadata load timeout - using original');
                cleanup();
                resolve(file);
            }, 2000);

            video.onloadedmetadata = () => {
                clearTimeout(metaTimer);
                // Check video duration - if very long, compression would take too long
                if (video.duration > 300) { // > 5 minutes
                    console.log('[VIDEO] Video too long (' + Math.round(video.duration) + 's) - using original');
                    cleanup();
                    resolve(file);
                    return;
                }
                video.play().then(() => {
                    let outW = video.videoWidth, outH = video.videoHeight;
                    if (outW > 1280) { outH = Math.round(outH * (1280 / outW)); outW = 1280; }
                    if (outH > 720) { outW = Math.round(outW * (720 / outH)); outH = 720; }
                    outW = Math.floor(outW / 2) * 2; outH = Math.floor(outH / 2) * 2;
                    const canvas = document.createElement('canvas');
                    canvas.width = outW; canvas.height = outH;
                    const ctx = canvas.getContext('2d');
                    const stream = canvas.captureStream();
                    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' :
                                     MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' :
                                     MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
                    if (!mimeType) {
                        console.log('[VIDEO] MediaRecorder not supported - using original');
                        cleanup(); resolve(file); return;
                    }
                    const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1500000 });
                    const chunks = [];
                    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                    mediaRecorder.onstop = () => {
                        cleanup();
                        const blob = new Blob(chunks, { type: 'video/webm' });
                        if (blob.size < 1024) { resolve(file); return; } // Compressed too small = failure
                        const compressed = new File([blob], (file.name || 'video').replace(/\.[^.]+$/, '') + '.webm', { type: 'video/webm' });
                        const saved = ((file.size - compressed.size) / file.size * 100).toFixed(0);
                        if (saved > 5) this.toast(`Compressed: ${this.formatFileSize(file.size)} → ${this.formatFileSize(compressed.size)} (${saved}% smaller)`, 'success', 2000);
                        resolve(compressed);
                    };
                    mediaRecorder.onerror = () => { cleanup(); resolve(file); };
                    const drawFrame = () => { if (video.paused || video.ended) return; ctx.drawImage(video, 0, 0, outW, outH); requestAnimationFrame(drawFrame); };
                    mediaRecorder.start(100);
                    drawFrame();
                    video.onended = () => mediaRecorder.stop();
                }).catch(() => { cleanup(); resolve(file); });
            };
            video.onerror = () => { clearTimeout(metaTimer); cleanup(); resolve(file); };
            video.src = objUrl;
        } catch (e) {
            clearTimeout(safetyTimer);
            console.log('[VIDEO] Compression error:', e.message, '- using original');
            resolve(file);
        }
    });
};

// uploadMediaWithProgress - delegates to the working uploadMedia
// Kept for backward compatibility, uses the exact same upload path
App.uploadMediaWithProgress = async function(file, type, onProgress) {
    if (onProgress) onProgress(0);
    const url = await this.uploadMedia(file, type);
    if (onProgress) onProgress(100);
    return url;
};

// Universal media upload with progress and compression
// Returns the uploaded URL
App.uploadMedia = async function(file, type) {
    const uid = Auth.getUid();
    if (!uid) throw new Error('Not authenticated');
    if (!this.checkFileSize(file, type)) throw new Error('File too large');

    // CORS PRE-FLIGHT CHECK: test storage connectivity before attempting upload
    // This fails fast with a clear error instead of generic "Failed to fetch" during upload
    try {
        const client = getSb();
        const { error: corsTestErr } = await client.storage.listBuckets();
        if (corsTestErr) {
            const origin = window.location.origin;
            const isGitHub = origin.includes('github.io');
            const msg = isGitHub
                ? 'CORS BLOCKED: Supabase Storage is rejecting requests from ' + origin + '. Go to Supabase Dashboard > Storage > Policies > CORS and add "' + origin + '"'
                : 'Storage connection test failed: ' + corsTestErr.message;
            console.error('[UPLOAD] ' + msg);
            throw new Error(msg);
        }
    } catch (corsErr) {
        if (corsErr.message.includes('CORS BLOCKED')) throw corsErr;
        // Non-CORS error, continue with upload attempt
    }

    let processedFile = file;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (isImage) {
        this.toast('Preparing file...', 'info', 1000);
        processedFile = await this.compressImage(file, type);
    } else if (isVideo) {
        this.toast('Preparing file...', 'info', 1000);
        processedFile = await this.compressVideo(file);
    }
    this.toast('Uploading...', 'info', 3000);
    let url;
    try {
        if (isVideo) url = await Storage.uploadVideo(uid, processedFile);
        else url = await Storage.uploadPhoto(uid, processedFile);
    } catch (storageErr) {
        const origin = window.location.origin;
        if (storageErr.message && storageErr.message.includes('fetch') && origin.includes('github.io')) {
            throw new Error('Upload blocked by CORS. Add "' + origin + '" to your Supabase Storage CORS settings. Dashboard > Storage > Policies > CORS');
        }
        throw storageErr;
    }
    if (!url) throw new Error('Upload failed');
    this.toast('Upload complete!', 'success', 2000);
    return url;
};

// QR Upload handlers - compress then upload, DB is source of truth
App.handleBtcQrUpload = async function(e) {
    const file = e.target.files?.[0]; if (!file) return;
    this.toast('Processing BTC QR...', 'info');
    try {
        const compressed = await this.compressImage(file, 400);
        const url = await Storage.uploadPhoto(Auth.getUid(), compressed);
        if (url) {
            await DB.updatePaymentSettings(Auth.getUid(), { btc_qr_url: url });
            try { localStorage.setItem('btc_qr_' + Auth.getUid(), url); } catch (lsErr) { /* localStorage full - ignore */ }
            const preview = document.getElementById('btcQrPreview');
            if (preview) { preview.style.backgroundImage = `url('${url}')`; preview.style.backgroundSize = 'cover'; preview.innerHTML = ''; }
            this.toast('BTC QR saved!', 'success');
        } else this.toast('Upload failed', 'error');
    } catch (e) { this.toast('Upload error: ' + e.message, 'error'); }
};
App.handleUsdtQrUpload = async function(e) {
    const file = e.target.files?.[0]; if (!file) return;
    this.toast('Processing USDT QR...', 'info');
    try {
        const compressed = await this.compressImage(file, 400);
        const url = await Storage.uploadPhoto(Auth.getUid(), compressed);
        if (url) {
            await DB.updatePaymentSettings(Auth.getUid(), { usdt_qr_url: url });
            try { localStorage.setItem('usdt_qr_' + Auth.getUid(), url); } catch (lsErr) { /* localStorage full - ignore */ }
            const preview = document.getElementById('usdtQrPreview');
            if (preview) { preview.style.backgroundImage = `url('${url}')`; preview.style.backgroundSize = 'cover'; preview.innerHTML = ''; }
            this.toast('USDT QR saved!', 'success');
        } else this.toast('Upload failed', 'error');
    } catch (e) { this.toast('Upload error: ' + e.message, 'error'); }
};

App.savePaymentSettings = async function() { try { const current = await DB.getPaymentSettings(Auth.getUid()); await DB.updatePaymentSettings(Auth.getUid(), { btc_enabled: document.getElementById('creatorBtcEnabled')?.checked || false, btc_address: document.getElementById('creatorBtcAddress')?.value || '', btc_qr_url: current?.btc_qr_url || '', usdt_enabled: document.getElementById('creatorUsdtEnabled')?.checked || false, usdt_address: document.getElementById('creatorUsdtAddress')?.value || '', usdt_qr_url: current?.usdt_qr_url || '', usdt_network: document.getElementById('creatorUsdtNetwork')?.value || 'TRC20' }); this.toast('Saved!', 'success'); } catch (e) { this.toast('Failed', 'error'); } };

// ===================== VERIFIED BADGE SYSTEM =====================
// Badge application screenshot
App._badgeScreenshotDataUrl = null;
App.handleBadgeScreenshotUpload = function(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        this._badgeScreenshotDataUrl = ev.target.result;
        const preview = document.getElementById('badgeApplyPreview');
        if (preview) { preview.style.backgroundImage = `url('${ev.target.result}')`; preview.style.backgroundSize = 'cover'; preview.innerHTML = ''; }
    };
    reader.readAsDataURL(file);
};

// Render badge status in Creator Studio
App.renderAdminBadge = async function() {
    const uid = Auth.getUid(); if (!uid) return;
    try {
        // Check and expire badges first
        await DB.checkAndExpireBadges();
        const badge = await DB.getVerifiedBadge(uid);
        const box = document.getElementById('badgeStatusBox');
        const text = document.getElementById('badgeStatusText');
        const sub = document.getElementById('badgeStatusSub');
        const details = document.getElementById('badgeDetails');
        const activated = document.getElementById('badgeActivatedAt');
        const expires = document.getElementById('badgeExpiresAt');
        const daysLeft = document.getElementById('badgeDaysLeft');
        const renewalAlert = document.getElementById('badgeRenewalAlert');
        const actionBtn = document.getElementById('badgeActionBtn');
        if (!box || !text) return;
        // Pre-fill apply form with user data
        const p = Auth.profile;
        const afn = document.getElementById('badgeApplyFullName'); const aun = document.getElementById('badgeApplyUsername'); const aem = document.getElementById('badgeApplyEmail');
        if (afn && !afn.value) afn.value = p?.display_name || '';
        if (aun && !aun.value) aun.value = p?.username || '';
        if (aem && !aem.value) aem.value = p?.email || '';
        // Load current price
        const price = await DB.getBadgePrice();
        const apu = document.getElementById('badgeApplyPriceUsd'); const apn = document.getElementById('badgeApplyPriceNgn');
        if (apu) apu.textContent = parseFloat(price.usd).toFixed(2);
        if (apn) apn.textContent = parseFloat(price.ngn).toLocaleString();
        if (!badge) {
            box.className = 'badge-status-box status-none';
            text.textContent = 'Not Verified';
            sub.textContent = 'Apply for a verified blue badge to stand out';
            if (details) details.style.display = 'none';
            if (renewalAlert) renewalAlert.style.display = 'none';
            if (actionBtn) { actionBtn.textContent = 'Apply for Verified Badge'; actionBtn.onclick = () => App.openBadgeApplyModal(); actionBtn.style.display = ''; }
            return;
        }
        const status = badge.status;
        box.className = 'badge-status-box status-' + status;
        if (details) details.style.display = (status === 'active') ? 'block' : 'none';
        if (renewalAlert) renewalAlert.style.display = 'none';
        if (actionBtn) actionBtn.style.display = 'none';
        if (status === 'pending') {
            text.textContent = 'Pending Approval';
            sub.textContent = 'Your application is being reviewed';
            if (actionBtn) { actionBtn.textContent = 'View Application'; actionBtn.style.display = ''; }
        } else if (status === 'active') {
            text.innerHTML = '<i class="fas fa-check-circle" style="color:var(--blue)"></i> Verified Badge Active';
            sub.textContent = 'Your blue badge is active and visible on your profile';
            if (activated) activated.textContent = badge.activated_at ? new Date(badge.activated_at).toLocaleDateString() : '-';
            if (expires) expires.textContent = badge.expires_at ? new Date(badge.expires_at).toLocaleDateString() : '-';
            const days = badge.expires_at ? Math.floor((new Date(badge.expires_at) - new Date()) / 864e5) : 0;
            if (daysLeft) { daysLeft.textContent = days > 0 ? days + ' days' : 'Expiring today'; daysLeft.style.color = days <= 7 ? 'var(--gold)' : ''; }
            if (days <= 7 && renewalAlert) renewalAlert.style.display = 'block';
            if (actionBtn) { actionBtn.textContent = 'Renew Badge'; actionBtn.onclick = () => App.openBadgeApplyModal(); actionBtn.style.display = ''; }
        } else if (status === 'expired') {
            text.textContent = 'Badge Expired';
            sub.textContent = 'Your verified badge has expired. Renew to reactivate.';
            if (actionBtn) { actionBtn.textContent = 'Renew Verified Badge'; actionBtn.onclick = () => App.openBadgeApplyModal(); actionBtn.style.display = ''; }
        } else if (status === 'rejected') {
            text.textContent = 'Application Rejected';
            sub.textContent = badge.rejected_reason ? 'Reason: ' + badge.rejected_reason : 'Your application was rejected. You can apply again.';
            if (actionBtn) { actionBtn.textContent = 'Apply Again'; actionBtn.onclick = () => App.openBadgeApplyModal(); actionBtn.style.display = ''; }
        } else if (status === 'suspended') {
            text.textContent = 'Badge Suspended';
            sub.textContent = 'Your verified badge has been suspended by the admin.';
        }
    } catch (e) { console.error('[BADGE] Render error:', e.message); }
};

// Open badge apply modal
App.openBadgeApplyModal = async function() {
    const p = Auth.profile;
    const afn = document.getElementById('badgeApplyFullName'); const aun = document.getElementById('badgeApplyUsername'); const aem = document.getElementById('badgeApplyEmail');
    if (afn) afn.value = p?.display_name || '';
    if (aun) aun.value = p?.username || '';
    if (aem) aem.value = p?.email || '';
    const price = await DB.getBadgePrice();
    const apu = document.getElementById('badgeApplyPriceUsd'); const apn = document.getElementById('badgeApplyPriceNgn');
    if (apu) apu.textContent = parseFloat(price.usd).toFixed(2);
    if (apn) apn.textContent = parseFloat(price.ngn).toLocaleString();
    this._badgeScreenshotDataUrl = null;
    const preview = document.getElementById('badgeApplyPreview');
    if (preview) { preview.style.backgroundImage = 'none'; preview.innerHTML = '<i class="fas fa-receipt" style="font-size:28px;color:var(--text-secondary)"></i><span style="font-size:11px;color:var(--text-secondary);margin-top:4px">Tap to upload receipt</span>'; }
    this.openModal('badgeApplyModal');
};

// Submit badge application
App.submitBadgeApplication = async function() {
    const fullName = document.getElementById('badgeApplyFullName')?.value.trim();
    const username = document.getElementById('badgeApplyUsername')?.value.trim();
    const email = document.getElementById('badgeApplyEmail')?.value.trim();
    const amount = document.getElementById('badgeApplyAmount')?.value.trim();
    const reference = document.getElementById('badgeApplyReference')?.value.trim();
    const date = document.getElementById('badgeApplyDate')?.value;
    const note = document.getElementById('badgeApplyNote')?.value.trim() || '';
    if (!fullName || !username || !email || !amount || !reference || !date) { this.toast('Fill all required fields', 'error'); return; }
    if (!Auth.isAuth()) { this.showAuth('login'); return; }
    this.toast('Submitting application...', 'info');
    try {
        let screenshotUrl = '';
        if (this._badgeScreenshotDataUrl) {
            // Convert data URL to file and upload
            const res = await fetch(this._badgeScreenshotDataUrl);
            const blob = await res.blob();
            const file = new File([blob], 'receipt_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            screenshotUrl = await Storage.uploadBadgeScreenshot(Auth.getUid(), file) || '';
        }
        const price = await DB.getBadgePrice();
        await DB.createBadgeRequest({
            creator_id: Auth.getUid(), full_name: fullName, username, email,
            amount_paid: amount, payment_reference: reference,
            screenshot_url: screenshotUrl, note, status: 'pending',
            bank_name: 'PalmPay', account_name: 'Palm Pay', account_number: '8061762411',
            price_usd: price.usd, price_ngn: price.ngn,
            date_of_payment: date
        });
        this.closeModal('badgeApplyModal');
        this._badgeScreenshotDataUrl = null;
        document.getElementById('badgeApplyAmount').value = '';
        document.getElementById('badgeApplyReference').value = '';
        document.getElementById('badgeApplyDate').value = '';
        document.getElementById('badgeApplyNote').value = '';
        this.toast('Application submitted! Awaiting approval.', 'success');
        this.renderAdminBadge();
    } catch (e) { this.toast('Submission failed: ' + (e.message || ''), 'error'); }
};

// Realtime for badge updates
App._badgeRealtime = null;
App.setupBadgeRealtime = function() {
    const uid = Auth.getUid(); if (!uid) return;
    try {
        if (this._badgeRealtime) { try { this._badgeRealtime.unsubscribe(); } catch (e) {} }
        const client = getSb(); if (!client) return;
        this._badgeRealtime = client.channel(`badge:${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'verified_badge_subs', filter: `creator_id=eq.${uid}` }, (payload) => {
            console.log('[REALTIME] Badge update received');
            this.renderAdminBadge();
            const status = payload.new?.status;
            if (status === 'active') this.toast('Your verified badge has been approved!', 'success');
            else if (status === 'rejected') this.toast('Your badge application was rejected.', 'error');
            else if (status === 'suspended') this.toast('Your verified badge has been suspended.', 'warning');
            else if (status === 'expired') this.toast('Your verified badge has expired.', 'warning');
        }).subscribe();
    } catch (e) { console.warn('[REALTIME] Badge subscription failed:', e.message); }
};
App.toggleSetting = function(el, key) { if (!el) return; el.classList.toggle('on'); DB.updateProfile(Auth.getUid(), { [key]: el.classList.contains('on') }); };

// Upload
App.handleUpload = function(e, type) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Validate file sizes before adding to queue
    const validFiles = [];
    for (const f of files) {
        const isVideo = type === 'video' || f.type.startsWith('video/');
        const limitType = isVideo ? 'video' : 'post_image';
        if (this.checkFileSize(f, limitType)) validFiles.push(f);
    }
    if (!validFiles.length) return;
    this.uploadQueue = [];
    const grid = document.getElementById('uploadPreview');
    if (grid) grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
    let loaded = 0;
    validFiles.forEach(f => {
        const isVideo = type === 'video' || f.type.startsWith('video/');
        const reader = new FileReader();
        reader.onload = (ev) => { this.uploadQueue.push({ file: f, dataUrl: ev.target.result, isVideo }); loaded++; if (loaded === validFiles.length) this.renderUploadPreview(); };
        reader.onerror = () => { loaded++; if (loaded === validFiles.length) this.renderUploadPreview(); };
        reader.readAsDataURL(f);
    });
};
App.renderUploadPreview = function() { const grid = document.getElementById('uploadPreview'); if (!grid) return; if (!this.uploadQueue.length) { grid.innerHTML = ''; return; } grid.innerHTML = this.uploadQueue.map((item, i) => item.isVideo ? `<div class="upload-preview-item" style="position:relative;width:100px;height:100px;border-radius:8px;overflow:hidden;background:#000"><video src="${item.dataUrl}" style="width:100%;height:100%;object-fit:cover" muted playsinline></video><div style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px"><i class="fas fa-video"></i></div><button class="remove" onclick="App.removeUpload(${i})" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;background:var(--red);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;z-index:2"><i class="fas fa-times"></i></button></div>` : `<div class="upload-preview-item" style="position:relative;width:100px;height:100px;border-radius:8px;overflow:hidden;background:var(--bg)"><img src="${item.dataUrl}" style="width:100%;height:100%;object-fit:cover;display:block"><button class="remove" onclick="App.removeUpload(${i})" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;background:var(--red);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;z-index:2"><i class="fas fa-times"></i></button></div>`).join(''); };
App.removeUpload = function(i) { this.uploadQueue.splice(i, 1); this.renderUploadPreview(); };
App.publishPost = async function() {
    if (!this.uploadQueue.length) { this.toast('Select a file first', 'error'); return; }
    const caption = document.getElementById('uploadCaption')?.value || '';
    const locked = document.getElementById('uploadLocked')?.checked || false;
    let successCount = 0;
    let lastPostId = null;
    try {
        for (const item of this.uploadQueue) {
            console.log('[PUBLISH] Processing', item.file.name);
            let url = null;
            try {
                if (item.isVideo) url = await this.uploadMedia(item.file, 'video');
                else url = await this.uploadMedia(item.file, 'post');
            } catch (upErr) { this.toast(upErr.message, 'error'); continue; }
            console.log('[PUBLISH] Result:', url ? 'SUCCESS' : 'FAILED');
            if (url) {
                const result = await DB.createPost({ creator_id: Auth.getUid(), media_url: url, caption, type: item.isVideo ? 'video' : 'image', is_locked: locked });
                if (result) { successCount++; lastPostId = result.id; }
            }
        }
        this.uploadQueue = []; document.getElementById('uploadCaption').value = ''; document.getElementById('uploadLocked').checked = false;
        const grid = document.getElementById('uploadPreview'); if (grid) grid.innerHTML = '';
        if (successCount > 0) {
            this.toast(`${successCount} post${successCount > 1 ? 's' : ''} published!`, 'success');
            this.renderAdmin();
            // Notify subscribers about new post
            if (lastPostId) { try { this.notifyNewPost(Auth.getUid(), lastPostId); } catch (n) {} }
        } else this.toast('Upload failed', 'error');
    } catch (e) { console.error('[PUBLISH] Error:', e); this.toast('Publish failed', 'error'); }
};

App.handleVipUpload = function(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    // File type validation
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
    const ext = (f.name || '').split('.').pop().toLowerCase();
    const validExts = ['mp4', 'mov', 'webm', 'm4v'];
    if (!validTypes.includes(f.type) && !validExts.includes(ext)) {
        this.toast('Invalid file: ' + (f.name || 'unknown') + '. Only MP4, MOV, and WEBM videos are allowed.', 'error', 5000);
        // Invalid file type
        e.target.value = ''; // Clear the input
        return;
    }

    // File size validation
    if (!this.checkFileSize(f, 'video')) { e.target.value = ''; return; }

    this.vipFile = f;
    console.log('[VIP] Selected:', f.name, 'size:', this.formatFileSize(f.size), 'type:', f.type);

    // Show preview using object URL (does NOT read file, leaves File untouched for upload)
    try {
        const c = document.getElementById('vipVideoPreview');
        if (c) {
            c.style.display = 'block';
            const v = c.querySelector('video');
            if (v) {
                // Revoke previous object URL to prevent memory leak
                if (this._vipPreviewUrl) { URL.revokeObjectURL(this._vipPreviewUrl); }
                this._vipPreviewUrl = URL.createObjectURL(f);
                v.src = this._vipPreviewUrl;
            }
        }
        this.toast('Video selected: ' + f.name + ' (' + this.formatFileSize(f.size) + ')', 'success', 2000);
    } catch (previewErr) {
        // Preview error
        // Preview failed but file is still valid for upload
        this.toast('Video selected (preview unavailable): ' + f.name, 'info', 2000);
    }
};
// ============================================================
// VIP VIDEO PUBLISH - Uses the EXACT SAME upload path as working posts
// ============================================================
App.publishVip = async function() {
    // Prevent double-click on mobile
    if (this._isPublishingVip) { console.log('[VIP] Already publishing, ignoring double-click'); return; }
    this._isPublishingVip = true;

    if (!this.vipFile) { this.toast('Please select a video first', 'error'); this._isPublishingVip = false; return; }
    const title = document.getElementById('vipVideoTitle')?.value.trim();
    const price = parseFloat(document.getElementById('vipVideoPrice')?.value);
    const desc = document.getElementById('vipVideoDesc')?.value || '';
    if (!title) { this.toast('Enter a title for your video', 'error'); this._isPublishingVip = false; return; }
    if (!price || price < 1 || isNaN(price)) { this.toast('Enter a valid price (minimum $1)', 'error'); this._isPublishingVip = false; return; }

    const publishBtn = document.querySelector('#admin-vip .btn-gold, button[onclick*="publishVip"]');
    if (publishBtn) { publishBtn.disabled = true; publishBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...'; }

    try {
        const videoUrl = await this.uploadMedia(this.vipFile, 'video');
        if (!videoUrl) throw new Error('Upload returned empty URL');

        const dbRecord = await DB.createVipVideo({
            creator_id: Auth.getUid(),
            title,
            description: desc,
            video_url: videoUrl,
            price
        });
        if (!dbRecord) throw new Error('Database save failed');

        // Clean up
        this.vipFile = null;
        if (this._vipPreviewUrl) { URL.revokeObjectURL(this._vipPreviewUrl); this._vipPreviewUrl = null; }
        document.getElementById('vipVideoTitle').value = '';
        document.getElementById('vipVideoDesc').value = '';
        document.getElementById('vipVideoPrice').value = '';
        const c = document.getElementById('vipVideoPreview');
        if (c) { c.style.display = 'none'; const v = c.querySelector('video'); if (v) v.src = ''; }

        this.toast('VIP video published!', 'success');
        this.renderAdmin();
        if (dbRecord?.id) { try { this.notifyNewVip(Auth.getUid(), dbRecord.id); } catch (n) {} }

    } catch (e) {
        // VIP publish error handled by toast
        this.toast('Failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
        this._isPublishingVip = false;
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.innerHTML = '<i class="fas fa-crown"></i> Publish VIP Video';
        }
    }
};

// Progress bar UI helpers
App._showVipUploadProgress = function(show) {
    let container = document.getElementById('vipUploadProgressContainer');
    if (!container) {
        // Create the progress container if it doesn't exist
        const formContainer = document.getElementById('vipVideoPreview')?.parentElement;
        if (!formContainer) return;
        container = document.createElement('div');
        container.id = 'vipUploadProgressContainer';
        container.style.cssText = 'display:none;margin:12px 0;padding:12px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);';
        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span id="vipProgressLabel" style="font-size:13px;color:var(--text-secondary)">Uploading...</span>
                <span id="vipProgressPercent" style="font-size:13px;font-weight:700;color:var(--primary)">0%</span>
            </div>
            <div style="width:100%;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                <div id="vipProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:3px;transition:width 0.3s ease"></div>
            </div>`;
        const previewEl = document.getElementById('vipVideoPreview');
        if (previewEl && previewEl.nextElementSibling) {
            previewEl.parentElement.insertBefore(container, previewEl.nextElementSibling);
        }
    }
    if (container) container.style.display = show ? 'block' : 'none';
};

App._updateVipProgress = function(percent, label) {
    const bar = document.getElementById('vipProgressBar');
    const pct = document.getElementById('vipProgressPercent');
    const lbl = document.getElementById('vipProgressLabel');
    if (bar) bar.style.width = Math.min(100, Math.max(0, percent)) + '%';
    if (pct) pct.textContent = Math.min(100, Math.max(0, percent)) + '%';
    if (lbl) lbl.textContent = label || 'Uploading...';
};

App._delay = function(ms) { return new Promise(r => setTimeout(r, ms)); };
App.delVip = async function(id) {
    console.log('[DELETE] delVip called with id:', id);
    if (!id) return;
    if (!confirm('Delete this VIP video permanently? This cannot be undone.')) return;
    try {
        const videos = await DB.getVipVideos(Auth.getUid());
        const video = videos.find(v => v.id === id);
        console.log('[DELETE] Deleting VIP video:', id);
        const success = await DB.deleteVipVideo(id);
        console.log('[DELETE] deleteVipVideo result:', success);
        if (success) {
            if (video?.video_url) { try { await Storage.deleteFile(video.video_url); } catch (s) {} }
            this.toast('VIP video deleted.', 'success');
            this.renderAdmin();
        } else {
            this.toast('Delete failed.', 'error');
        }
    } catch (e) { console.error('[DELETE] delVip error:', e.message); this.toast('Delete failed: ' + e.message, 'error'); }
};
App.askDelete = function(id) {
    console.log('[DELETE] askDelete called with id:', id);
    if (!id) { console.warn('[DELETE] No ID provided'); return; }
    this.postToDelete = id;
    this.openModal('deleteModal');
};

// Event delegation for delete buttons - more reliable on mobile than onclick
// Handles: delete-post, delete-vip, remove-sub, delete-payment
App.attachDeleteListeners = function(container) {
    if (!container) return;
    const handler = function(e) {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        console.log('[DELETE] Event delegation caught:', action, btn.dataset);
        if (action === 'delete-post' && btn.dataset.id) { App.askDelete(btn.dataset.id); }
        else if (action === 'delete-vip' && btn.dataset.id) { App.delVip(btn.dataset.id); }
        else if (action === 'remove-sub' && btn.dataset.sub && btn.dataset.creator) { App.removeSubscriber(btn.dataset.sub, btn.dataset.creator); }
    };
    container.addEventListener('click', handler);
    // Touch handler for mobile
    container.addEventListener('touchend', function(e) {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        e.preventDefault();
        handler(e);
    }, { passive: false });
};
App.confirmDelete = async function() {
    console.log('[DELETE] confirmDelete called, postToDelete:', this.postToDelete);
    if (!this.postToDelete) { console.warn('[DELETE] No postToDelete set'); return; }
    try {
        const post = await DB.getPost(this.postToDelete);
        console.log('[DELETE] Deleting post:', this.postToDelete);
        const success = await DB.deletePost(this.postToDelete);
        console.log('[DELETE] deletePost result:', success);
        if (success) {
            if (post?.media_url) { try { await Storage.deleteFile(post.media_url); } catch (s) {} }
            this.toast('Post deleted.', 'success');
            this.postToDelete = null;
            this.renderAdmin();
        } else {
            this.toast('Delete failed.', 'error');
        }
    } catch (e) { console.error('[DELETE] Error:', e.message); this.toast('Delete failed: ' + e.message, 'error'); }
    this.closeModal('deleteModal');
};

// ===================== SUBSCRIBERS (with disable/enable) =====================
App._allSubs = [];
App._subFilter = 'all';

App.renderSubs = async function(status, btn) {
    if (btn) { document.querySelectorAll('#admin-subscribers .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    if (status) this._subFilter = status;
    try {
        const uid = Auth.getUid();
        const subs = await DB.getCreatorSubs(uid);
        this._allSubs = subs;
        // Update stats (uses only 'status' column)
        const cActive = document.getElementById('subCountActive');
        const cPending = document.getElementById('subCountPending');
        const cCancelled = document.getElementById('subCountCancelled');
        const cDisabled = document.getElementById('subCountDisabled');
        if (cActive) cActive.textContent = subs.filter(s => s.status === 'approved' && (!s.expires_at || new Date(s.expires_at) > new Date())).length;
        if (cPending) cPending.textContent = subs.filter(s => s.status === 'pending').length;
        if (cCancelled) cCancelled.textContent = subs.filter(s => s.status === 'cancelled').length;
        if (cDisabled) cDisabled.textContent = subs.filter(s => s.status === 'cancelled').length;
        // Apply filter (uses only 'status' column - works with base migration)
        let filtered = subs;
        if (this._subFilter === 'active') filtered = subs.filter(s => s.status === 'approved' && (!s.expires_at || new Date(s.expires_at) > new Date()));
        else if (this._subFilter === 'pending') filtered = subs.filter(s => s.status === 'pending');
        else if (this._subFilter === 'disabled') filtered = subs.filter(s => s.status === 'cancelled');
        else if (this._subFilter === 'cancelled') filtered = subs.filter(s => s.status === 'cancelled');
        else if (this._subFilter === 'expired') filtered = subs.filter(s => s.status === 'expired' || (s.status === 'approved' && s.expires_at && new Date(s.expires_at) < new Date()));
        // Apply search
        const searchQuery = (document.getElementById('subSearch')?.value || '').toLowerCase();
        if (searchQuery) filtered = filtered.filter(s => {
            const name = (s.subscriber?.display_name || s.subscriber?.username || '').toLowerCase();
            return name.includes(searchQuery);
        });
        // Render
        const list = document.getElementById('subscribersList');
        if (list) {
            list.innerHTML = filtered.length ? filtered.map(s => this.subscriberCard(s)).join('') : '<p class="no-content">No subscribers found</p>';
            this.attachDeleteListeners(list);
        }
    } catch (e) { console.error('[SUB] renderSubs:', e.message); }
};

App.subscriberCard = function(s) {
    const sub = s.subscriber || {};
    const avatar = sub.avatar || '';
    const initial = (sub.display_name || sub.username || '?').charAt(0).toUpperCase();
    const name = this.esc(sub.display_name || sub.username || 'Unknown');
    const verified = sub.verified ? '<i class="fas fa-check-circle verified-badge"></i>' : '';
    const expiry = s.expires_at ? new Date(s.expires_at).toLocaleDateString() : 'N/A';
    const isExpired = s.expires_at && new Date(s.expires_at) < new Date();
    const isCancelled = s.status === 'cancelled';
    const isPending = s.status === 'pending';
    const isActive = s.status === 'approved' && !isExpired && !isCancelled;
    let statusBadge = '';
    if (isActive) statusBadge = '<span class="status-badge status-active">Active</span>';
    else if (isPending) statusBadge = '<span class="status-badge status-pending">Pending</span>';
    else if (isCancelled) statusBadge = '<span class="status-badge status-disabled">Cancelled</span>';
    else if (isExpired) statusBadge = '<span class="status-badge status-disabled">Expired</span>';
    const avHtml = avatar ? `<div class="sub-avatar" style="background-image:url('${avatar}')"></div>` : `<div class="sub-avatar">${initial}</div>`;
    // Action buttons based on status
    let actions = '';
    if (isActive) {
        actions = `<button class="btn btn-outline btn-sm" onclick="App.cancelSubscription('${s.subscriber_id}', '${s.creator_id}')"><i class="fas fa-ban"></i> Cancel</button>`;
    } else if (isExpired) {
        actions = `<button class="btn btn-primary btn-sm" onclick="App.reactivateSubscription('${s.subscriber_id}', '${s.creator_id}')"><i class="fas fa-redo"></i> Renew</button>`;
    } else if (isCancelled) {
        actions = `<button class="btn btn-primary btn-sm" onclick="App.reactivateSubscription('${s.subscriber_id}', '${s.creator_id}')"><i class="fas fa-play"></i> Reactivate</button>`;
    } else if (isPending) {
        actions = `<button class="btn btn-primary btn-sm" onclick="App.reactivateSubscription('${s.subscriber_id}', '${s.creator_id}')"><i class="fas fa-check"></i> Approve</button>`;
    }
    actions += `<button class="btn btn-danger btn-sm delete-btn" data-action="remove-sub" data-sub="${s.subscriber_id}" data-creator="${s.creator_id}" onclick="App.removeSubscriber('${s.subscriber_id}', '${s.creator_id}')"><i class="fas fa-trash-alt"></i> Remove</button>`;
    return `<div class="sub-card"><div class="sub-header"><div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">${avHtml}<div style="min-width:0"><div class="sub-name">${name}${verified}</div><div class="sub-meta">@${this.esc(sub.username || '')} &middot; ${s.plan_type} &middot; $${s.amount}</div></div></div>${statusBadge}</div><div class="sub-details"><div class="sub-detail-row"><span>Status</span><span style="font-weight:600">${s.status}${isExpired ? ' (Expired)' : ''}</span></div><div class="sub-detail-row"><span>Expires</span><span style="font-weight:600">${expiry}${isExpired ? ' (Expired)' : ''}</span></div><div class="sub-detail-row"><span>Since</span><span style="font-weight:600">${s.created_at ? new Date(s.created_at).toLocaleDateString() : 'N/A'}</span></div></div><div class="sub-actions">${actions}</div></div>`;
};

App.filterSubs = function(status, btn) { this.renderSubs(status, btn); };
App.searchSubscribers = debounce(function(query) { this.renderSubs(); }, 300);

// Disable/Enable subscription
App.disableSub = async function(subscriberId, creatorId, disable) {
    try {
        if (disable) {
            await DB.updateSubscriptionByQuery({ subscriber_id: subscriberId, creator_id: creatorId }, { status: 'cancelled' });
            this.toast('Subscription disabled', 'info');
        } else {
            await DB.updateSubscriptionByQuery({ subscriber_id: subscriberId, creator_id: creatorId }, { status: 'approved' });
            this.toast('Subscription enabled', 'success');
        }
        this.renderSubs('all');
    } catch (e) { this.toast('Failed: ' + (e.message || ''), 'error'); }
};

// Remove subscriber permanently
App.removeSubscriber = async function(subscriberId, creatorId) {
    if (!subscriberId || !creatorId) return;
    if (!confirm('Remove this subscriber permanently? They will lose all access.')) return;
    try {
        const success = await DB.deleteSubscription(subscriberId, creatorId);
        if (success) {
            this.toast('Subscriber removed.', 'success');
            this.renderSubs('all');
        } else {
            this.toast('Remove failed.', 'error');
        }
    } catch (e) { this.toast('Remove failed: ' + e.message, 'error'); }
};

// Cancel subscription (mark as cancelled)
App.cancelSubscription = async function(subscriberId, creatorId) {
    if (!subscriberId || !creatorId || !confirm('Cancel this subscription?')) return;
    try {
        await DB.updateSubscriptionByQuery({ subscriber_id: subscriberId, creator_id: creatorId }, { status: 'cancelled' });
        this.toast('Subscription cancelled', 'info');
        this.renderSubs('all');
    } catch (e) { this.toast('Failed: ' + (e.message || ''), 'error'); }
};

// Reactivate a cancelled/expired subscription
App.reactivateSubscription = async function(subscriberId, creatorId) {
    if (!subscriberId || !creatorId) return;
    try {
        const expires = new Date(Date.now() + 30 * 864e5).toISOString();
        await DB.updateSubscriptionByQuery({ subscriber_id: subscriberId, creator_id: creatorId }, { status: 'approved', expires_at: expires });
        this.toast('Subscription reactivated!', 'success');
        this.renderSubs('all');
    } catch (e) { this.toast('Failed: ' + (e.message || ''), 'error'); }
};

App.updateSub = async function(id, status) { if (!id) return; try { await DB.updateSubscription(id, { status }); this.toast('Subscription ' + status, 'success'); this.renderSubs('all'); } catch (e) { this.toast('Failed', 'error'); } };

// ===================== PAYMENTS (creator view with full details & actions) =====================
App._creatorPayments = [];
App.renderPayments = async function(filter, btn) {
    if (btn) { document.querySelectorAll('#admin-payments .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    try {
        const payments = await DB.getCreatorPayments(Auth.getUid());
        this._creatorPayments = payments;
        let filtered = payments;
        if (filter === 'pending') filtered = payments.filter(p => p.status === 'pending');
        else if (filter === 'approved') filtered = payments.filter(p => p.status === 'approved');
        else if (filter === 'rejected') filtered = payments.filter(p => p.status === 'rejected');
        else if (filter === 'giftcard') filtered = payments.filter(p => p.method === 'giftcard');
        else if (filter === 'btc') filtered = payments.filter(p => p.method === 'btc');
        else if (filter === 'usdt') filtered = payments.filter(p => p.method === 'usdt');
        const list = document.getElementById('paymentsList');
        if (!list) return;
        list.innerHTML = filtered.length ? filtered.map(p => this.paymentCard(p)).join('') : '<p class="no-content">No payment requests yet</p>';
        this.attachDeleteListeners(list);
    } catch (e) { console.warn('[APP] Payments error:', e.message); }
};
App.filterPayments = function(filter, btn) { this.renderPayments(filter, btn); };

App.paymentCard = function(p) {
    const fanName = this.esc(p.user?.display_name || p.user?.username || 'Unknown');
    const fanEmail = this.esc(p.user?.email || '');
    const methodClass = p.method === 'giftcard' ? 'payment-method-giftcard' : p.method === 'btc' ? 'payment-method-btc' : 'payment-method-usdt';
    const methodIcon = p.method === 'giftcard' ? 'fa-gift' : p.method === 'btc' ? 'fab fa-bitcoin' : 'fa-coins';
    const methodLabel = p.method === 'giftcard' ? 'Gift Card' : p.method === 'btc' ? 'Bitcoin' : 'USDT';
    const statusClass = p.status === 'approved' ? 'status-approved' : p.status === 'rejected' ? 'status-rejected' : 'status-pending';
    const date = p.created_at ? new Date(p.created_at).toLocaleString() : 'N/A';
    let detailsHtml = '';
    if (p.method === 'giftcard') {
        detailsHtml = `<div><div class="payment-detail-label">Gift Card Type</div><div class="payment-detail-value">${this.esc(p.gc_type || 'N/A')}</div></div>
            <div><div class="payment-detail-label">Value</div><div class="payment-detail-value">${this.esc(p.gc_value || 'N/A')}</div></div>
            <div style="grid-column:1/-1"><div class="payment-detail-label">Code</div><div class="payment-detail-value" style="font-family:monospace">${this.esc(p.gc_code || 'N/A')}</div></div>
            <div><div class="payment-detail-label">Country</div><div class="payment-detail-value">${this.esc(p.gc_country || 'N/A')}</div></div>`;
        // Show gift card images if uploaded
        if (p.gc_front_url || p.gc_back_url) {
            detailsHtml += `<div style="grid-column:1/-1;margin-top:8px"><div class="payment-detail-label">Gift Card Images</div><div class="gc-payment-images">`;
            if (p.gc_front_url) detailsHtml += `<img src="${p.gc_front_url}" alt="Front" onclick="window.open('${p.gc_front_url}','_blank')">`;
            if (p.gc_back_url) detailsHtml += `<img src="${p.gc_back_url}" alt="Back" onclick="window.open('${p.gc_back_url}','_blank')">`;
            detailsHtml += `</div></div>`;
        }
    } else if (p.method === 'btc') {
        detailsHtml = `<div style="grid-column:1/-1"><div class="payment-detail-label">Transaction ID</div><div class="payment-detail-value" style="font-family:monospace;font-size:12px">${this.esc(p.crypto_txid || 'N/A')}</div></div>
            <div><div class="payment-detail-label">Amount Sent</div><div class="payment-detail-value">${this.esc(p.crypto_amount || 'N/A')} BTC</div></div>`;
    } else if (p.method === 'usdt') {
        detailsHtml = `<div style="grid-column:1/-1"><div class="payment-detail-label">Transaction Hash</div><div class="payment-detail-value" style="font-family:monospace;font-size:12px">${this.esc(p.crypto_txid || 'N/A')}</div></div>
            <div><div class="payment-detail-label">Amount Sent</div><div class="payment-detail-value">${this.esc(p.crypto_amount || 'N/A')} USDT</div></div>
            <div><div class="payment-detail-label">Network</div><div class="payment-detail-value">${this.esc(p.crypto_network || 'TRC20')}</div></div>`;
    }
    const actionButtons = p.status === 'pending'
        ? `<button class="btn btn-primary btn-sm" onclick="App.approvePayment('${p.id}')"><i class="fas fa-check"></i> Approve</button>
           <button class="btn btn-danger btn-sm" onclick="App.rejectPayment('${p.id}')"><i class="fas fa-times"></i> Reject</button>`
        : p.status === 'approved'
        ? `<button class="btn btn-outline btn-sm" onclick="App.rejectPayment('${p.id}')"><i class="fas fa-undo"></i> Reject</button>`
        : `<button class="btn btn-outline btn-sm" onclick="App.approvePayment('${p.id}')"><i class="fas fa-check"></i> Approve</button>`;
    return `<div class="payment-card">
        <div class="payment-header">
            <div><div class="payment-fan">${fanName}</div><div class="payment-meta">${fanEmail} &middot; ${date}</div></div>
            <div style="display:flex;align-items:center;gap:8px">
                <span class="payment-method-icon ${methodClass}"><i class="${methodIcon}"></i> ${methodLabel}</span>
                <span class="status-badge ${statusClass}">${p.status}</span>
            </div>
        </div>
        <div class="payment-details">
            <div><div class="payment-detail-label">Plan</div><div class="payment-detail-value">${this.esc(p.payment_type || 'N/A')}</div></div>
            <div><div class="payment-detail-label">Amount</div><div class="payment-detail-value">$${p.amount}</div></div>
            ${detailsHtml}
        </div>
        <div class="payment-actions">
            ${actionButtons}
            <button class="btn btn-danger btn-sm" onclick="App.deletePayment('${p.id}')"><i class="fas fa-trash-alt"></i> Delete</button>
        </div>
    </div>`;
};

App.approvePayment = async function(paymentId) {
    if (!paymentId) return;
    try {
        const payment = await DB.getPayment(paymentId);
        if (!payment) { this.toast('Payment not found', 'error'); return; }
        await DB.updatePaymentStatus(paymentId, 'approved');
        const planType = payment.payment_type || 'monthly';
        const durationDays = await DB.getPlanDuration(planType);
        const expires = new Date(Date.now() + durationDays * 864e5).toISOString();
        // Activate subscription (works with base migration - only uses 'status' column)
        try {
            await DB.createSubscription({
                subscriber_id: payment.user_id,
                creator_id: payment.creator_id,
                plan_type: planType,
                amount: payment.amount || 0,
                status: 'approved',
                expires_at: expires
            });
        } catch (subErr) {
            console.log('[SUB] Trying update instead of insert:', subErr.message || '');
            try {
                await DB.updateSubscriptionByQuery(
                    { subscriber_id: payment.user_id, creator_id: payment.creator_id },
                    { status: 'approved', plan_type: planType, amount: payment.amount || 0, expires_at: expires, updated_at: new Date().toISOString() }
                );
            } catch (updateErr) { console.error('[SUB] Update failed:', updateErr.message); }
        }
        // Also approve VIP purchase if applicable
        if (planType === 'vip') {
            try {
                const { data: vipPurchase } = await getSb().from('vip_purchases').select('*').eq('buyer_id', payment.user_id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
                if (vipPurchase) await getSb().from('vip_purchases').update({ status: 'approved' }).eq('id', vipPurchase.id);
            } catch (vipErr) { /* silent */ }
        }
        this.toast(`Payment approved! ${planType} subscription active for ${durationDays} days.`, 'success');
        this.renderPayments('all'); this.renderSubs('all');
        // Notify fan that payment was approved
        try { this.notifyPaymentApproved(payment.user_id, paymentId); } catch (n) {}
        // Notify creator about payment received
        try { this.notifyPaymentReceived(payment.creator_id, paymentId, payment.amount, payment.method || planType); } catch (n) {}
    } catch (e) { console.error('[PAY] Approve:', e.message); this.toast('Failed: ' + (e.message || ''), 'error'); }
};

App.rejectPayment = async function(paymentId) {
    if (!paymentId || !confirm('Decline this payment?')) return;
    try {
        const payment = await DB.getPayment(paymentId);
        await DB.updatePaymentStatus(paymentId, 'rejected');
        if (payment?.payment_type === 'vip') {
            try { await getSb().from('vip_purchases').update({ status: 'declined' }).eq('buyer_id', payment.user_id).eq('status', 'pending'); } catch (vipErr) {}
        }
        this.toast('Payment declined.', 'info');
        this.renderPayments('all');
        // Notify fan that payment was declined
        try { if (payment?.user_id) this.notifyPaymentDeclined(payment.user_id, paymentId); } catch (n) {}
    } catch (e) { this.toast('Failed: ' + (e.message || ''), 'error'); }
};

App.deletePayment = async function(paymentId) {
    if (!paymentId || !confirm('Delete this payment record permanently?')) return;
    try {
        const success = await DB.deletePayment(paymentId);
        if (success) {
            this.toast('Payment deleted.', 'success');
            this.renderPayments('all');
        } else {
            this.toast('Delete failed.', 'error');
        }
    } catch (e) { this.toast('Delete failed: ' + (e.message || ''), 'error'); }
};

App.filterAdminMessages = function() {};

// ===================== OWNER DASHBOARD =====================
App.showOwnerLogin = function() { this.openModal('ownerModal'); setTimeout(() => document.getElementById('ownerPasswordInput')?.focus(), 100); };
App.verifyOwner = function() { const input = document.getElementById('ownerPasswordInput')?.value; if (input === OWNER_ACCESS_PASSWORD) { this.closeModal('ownerModal'); document.getElementById('ownerPasswordInput').value = ''; this.go('owner'); this.toast('Owner access granted!', 'success'); } else { this.toast('Wrong password!', 'error'); document.getElementById('ownerPasswordInput').value = ''; } };
App.closeOwner = function() { this.go('landing'); };
App.renderOwner = async function() { try { const stats = await DB.getOwnerStats(); const revenue = await DB.getTotalRevenue(); if (stats) { const su = document.getElementById('ownerStatUsers'); const sc = document.getElementById('ownerStatCreators'); const sp = document.getElementById('ownerStatPosts'); const ss = document.getElementById('ownerStatSubs'); const sr = document.getElementById('ownerStatRevenue'); const sm = document.getElementById('ownerStatMsgs'); if (su) su.textContent = stats.totalUsers; if (sc) sc.textContent = stats.totalCreators; if (sp) sp.textContent = stats.totalPosts; if (ss) ss.textContent = stats.activeSubs; if (sr) sr.textContent = '$' + revenue.toFixed(2); if (sm) sm.textContent = stats.totalMessages; } } catch (e) {} try { const users = await DB.listAllUsers(); const ul = document.getElementById('ownerUsersList'); if (ul) ul.innerHTML = users.length ? users.map(u => this.ownerUserCard(u)).join('') : '<p class="no-content">No users yet</p>'; } catch (e) {} try { const creators = await DB.listAllCreators(); const cl = document.getElementById('ownerCreatorsList'); if (cl) cl.innerHTML = creators.length ? creators.map(c => this.ownerCreatorCard(c)).join('') : '<p class="no-content">No creators yet</p>'; } catch (e) {} try { const posts = await DB.getPosts(null, 50); const pl = document.getElementById('ownerPostsList'); if (pl) pl.innerHTML = posts.length ? posts.map(p => this.ownerPostCard(p)).join('') : '<p class="no-content">No posts yet</p>'; } catch (e) {} this.renderOwnerSubs('all'); this.renderOwnerTrans(); this.setupTransRealtime(); this.renderOwnerBadges('all'); this.renderBoostHistory(); };
App.ownerUserCard = function(u) { const avatar = u.avatar ? `style="background-image:url('${u.avatar}')"` : ''; const initial = u.avatar ? '' : (u.display_name || u.username).charAt(0).toUpperCase(); const joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Unknown'; return `<div class="owner-user-card"><div class="owner-avatar" ${avatar}>${initial}</div><div class="owner-info"><div class="owner-name">@${this.esc(u.display_name || u.username)}</div><div class="owner-email">${this.esc(u.email || 'No email')}</div><div class="owner-meta">Balance: $${parseFloat(u.balance || 0).toFixed(2)} &middot; Joined: ${joined}</div></div><div class="owner-actions"><span class="status-badge status-active">ACTIVE</span><button class="btn btn-danger btn-sm" onclick="App.ownerDeleteUser('${u.id}', '${this.esc(u.username)}')"><i class="fas fa-trash-alt"></i></button></div></div>`; };
App.ownerCreatorCard = function(c) { const avatar = c.avatar ? `style="background-image:url('${c.avatar}')"` : ''; const initial = c.avatar ? '' : (c.display_name || c.username).charAt(0).toUpperCase(); return `<div class="owner-user-card"><div class="owner-avatar" ${avatar}>${initial}</div><div class="owner-info"><div class="owner-name">${this.esc(c.display_name || c.username)}${c.verified ? ' <i class="fas fa-check-circle verified-badge"></i>' : ''}</div><div class="owner-email">@${c.username}</div><div class="owner-meta">$${c.monthly_price}/mo &middot; ${c.subscribers_count} subs &middot; ${c.posts_count} posts</div></div><div class="owner-actions"><span class="status-badge status-active">CREATOR</span><button class="btn btn-danger btn-sm" onclick="App.ownerDeleteUser('${c.id}', '${this.esc(c.username)}')" title="Permanently delete creator"><i class="fas fa-trash-alt"></i></button></div></div>`; };
App.ownerPostCard = function(p) { const cv = p.creator?.verified ? '<i class="fas fa-check-circle verified-badge" style="font-size:10px;margin-left:3px"></i>' : ''; return `<div class="owner-user-card"><div class="owner-avatar" style="background-image:url('${p.media_url}');border-radius:8px;width:48px;height:48px"></div><div class="owner-info"><div class="owner-name">${this.esc(p.caption || 'No caption')}</div><div class="owner-email">by ${this.esc(p.creator?.display_name || 'Unknown')}${cv}</div><div class="owner-meta">${p.type} &middot; ${p.likes_count || 0} likes &middot; ${this.timeAgo(p.created_at)}</div></div></div>`; };
// ===================== PERMANENT USER DELETION =====================
// Shows detailed confirmation then permanently deletes user + all data
App.ownerDeleteUser = async function(userId, username) {
    if (!userId) { this.toast('Error: No user ID', 'error'); return; }

    // Step 1: Preview what will be deleted
    let preview = null;
    try {
        preview = await DB.previewUserDeletion(userId);
    } catch (e) { console.warn('[DELETE] Preview failed:', e.message); }

    // Step 2: Build detailed confirmation message
    let confirmMsg = `Are you sure you want to permanently delete @${username}?\n\nThis action CANNOT be undone.\n\nThe following will be permanently removed:`;
    if (preview) {
        if (preview.posts > 0) confirmMsg += `\n  \u2022 ${preview.posts} post(s)`;
        if (preview.vip_videos > 0) confirmMsg += `\n  \u2022 ${preview.vip_videos} VIP video(s)`;
        if (preview.stories > 0) confirmMsg += `\n  \u2022 ${preview.stories} story/stories`;
        if (preview.subscriptions_as_subscriber > 0) confirmMsg += `\n  \u2022 ${preview.subscriptions_as_subscriber} subscription(s) as fan`;
        if (preview.subscriptions_as_creator > 0) confirmMsg += `\n  \u2022 ${preview.subscriptions_as_creator} subscriber(s) as creator`;
        if (preview.payments > 0) confirmMsg += `\n  \u2022 ${preview.payments} payment record(s)`;
        if (preview.messages > 0) confirmMsg += `\n  \u2022 ${preview.messages} message(s)`;
        if (preview.notifications > 0) confirmMsg += `\n  \u2022 ${preview.notifications} notification(s)`;
        if (preview.likes > 0) confirmMsg += `\n  \u2022 ${preview.likes} like(s)`;
        if (preview.storage_files > 0) confirmMsg += `\n  \u2022 ${preview.storage_files} uploaded file(s)`;
        if (preview.transactions > 0) confirmMsg += `\n  \u2022 ${preview.transactions} transaction(s)`;
        if (preview.badges > 0) confirmMsg += `\n  \u2022 ${preview.badges} verified badge(s)`;
        confirmMsg += `\n\nUser account and auth credentials will also be destroyed. The email will be free to register again.`;
    } else {
        confirmMsg += `\n  \u2022 All posts, videos, stories\n  \u2022 All subscriptions and payments\n  \u2022 All messages and notifications\n  \u2022 All uploaded media files\n  \u2022 Auth account (cannot log in again)`;
    }

    // Step 3: Show confirmation dialog
    if (!confirm(confirmMsg)) return;

    // Step 4: Show loading state
    this.toast('Deleting user and all data...', 'info', 8000);

    // Step 5: Execute permanent deletion via RPC
    try {
        const result = await DB.deleteUser(userId);
        console.log('[DELETE] Result:', result);

        if (result && result.success) {
            // Build success message with details
            let details = [];
            if (result.posts_deleted > 0) details.push(`${result.posts_deleted} posts`);
            if (result.videos_deleted > 0) details.push(`${result.videos_deleted} videos`);
            if (result.stories_deleted > 0) details.push(`${result.stories_deleted} stories`);
            if (result.subscriptions_deleted > 0) details.push(`${result.subscriptions_deleted} subscriptions`);
            if (result.payments_deleted > 0) details.push(`${result.payments_deleted} payments`);
            if (result.messages_deleted > 0) details.push(`${result.messages_deleted} messages`);
            if (result.likes_deleted > 0) details.push(`${result.likes_deleted} likes`);
            if (result.storage_files_deleted > 0) details.push(`${result.storage_files_deleted} files`);
            if (result.notifications_deleted > 0) details.push(`${result.notifications_deleted} notifications`);

            let msg = 'User permanently deleted.';
            if (details.length > 0) msg += ' Removed: ' + details.join(', ') + '.';

            this.toast(msg, 'success', 6000);

            // Step 6: Refresh entire owner dashboard with updated stats
            setTimeout(() => { this.renderOwner(); }, 500);
        } else {
            // Show the actual error message from the server
            const errMsg = result && result.message ? result.message : 'Delete failed: unknown error';
            console.error('[DELETE] Failed:', errMsg, result);
            this.toast('Delete failed: ' + errMsg, 'error', 6000);
        }
    } catch (e) {
        console.error('[DELETE] Exception:', e.message);
        this.toast('Delete failed: ' + (e.message || 'Network error'), 'error', 6000);
    }
};
App._ownerSubs = []; App.renderOwnerSubs = async function(status, btn) { if (btn) { document.querySelectorAll('#ownerTab-subs .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); } try { const subs = await DB.getAllSubscriptions(); this._ownerSubs = subs; const filtered = status === 'all' ? subs : subs.filter(s => s.status === status); const list = document.getElementById('ownerSubsList'); if (!list) return; list.innerHTML = filtered.length ? filtered.map(s => { const subName = this.esc(s.subscriber?.display_name || s.subscriber?.username || 'Unknown'); const crName = this.esc(s.creator?.display_name || s.creator?.username || 'Unknown'); const started = s.created_at ? new Date(s.created_at).toLocaleString() : 'Unknown'; const statusClass = s.status === 'approved' ? 'status-active' : s.status === 'pending' ? 'status-pending' : 'status-rejected'; return `<div class="owner-sub-card"><div class="sub-header"><div class="sub-users">@${subName} &rarr; @${crName}</div><span class="status-badge ${statusClass}">${s.status}</span></div><div class="sub-details">Plan: ${s.plan_type} &middot; $${parseFloat(s.amount || 0).toFixed(2)} &middot; ${started}</div></div>`; }).join('') : '<p class="no-content">No subscriptions yet</p>'; } catch (e) {} };
App.filterOwnerSubs = function(status, btn) { this.renderOwnerSubs(status, btn); };
// ===================== OWNER TRANSACTIONS MANAGEMENT =====================
App._ownerTrans = [];
App._transFilter = 'all';
App._transSort = 'newest';

// Load all payments and render
App.renderOwnerTrans = async function() {
    const list = document.getElementById('ownerTransList');
    if (!list) return;
    list.innerHTML = '<p class="no-content"><i class="fas fa-spinner fa-spin"></i> Loading transactions...</p>';
    try {
        const payments = await DB.getAllPayments(200);
        console.log('[TRANS] Loaded', payments.length, 'payments');
        this._ownerTrans = payments;
        this.applyTransFilter();
    } catch (e) {
        console.error('[TRANS] Load error:', e.message);
        list.innerHTML = '<p class="no-content">Failed to load transactions</p>';
    }
};

// Apply search + filter + sort
App.applyTransFilter = function() {
    const list = document.getElementById('ownerTransList');
    if (!list) return;
    let filtered = [...this._ownerTrans];
    // Search
    const query = document.getElementById('transSearch')?.value?.toLowerCase()?.trim();
    if (query) {
        filtered = filtered.filter(p => {
            const fanName = (p.fan?.username || '').toLowerCase();
            const fanDisplay = (p.fan?.display_name || '').toLowerCase();
            const crName = (p.creator?.username || '').toLowerCase();
            const crDisplay = (p.creator?.display_name || '').toLowerCase();
            const txId = (p.id || '').toLowerCase();
            return fanName.includes(query) || fanDisplay.includes(query) || crName.includes(query) || crDisplay.includes(query) || txId.includes(query);
        });
    }
    // Filter by type/status/method
    if (this._transFilter !== 'all') {
        if (['pending', 'approved', 'rejected', 'expired'].includes(this._transFilter)) {
            filtered = filtered.filter(p => p.status === this._transFilter);
        } else if (['weekly', 'monthly', 'vip'].includes(this._transFilter)) {
            filtered = filtered.filter(p => (p.payment_type || '').toLowerCase().includes(this._transFilter));
        } else if (['giftcard', 'bitcoin', 'usdt'].includes(this._transFilter)) {
            filtered = filtered.filter(p => (p.method || '').toLowerCase() === this._transFilter);
        }
    }
    // Sort
    if (this._transSort === 'newest') filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (this._transSort === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (this._transSort === 'highest') filtered.sort((a, b) => parseFloat(b.amount || 0) - parseFloat(a.amount || 0));
    else if (this._transSort === 'lowest') filtered.sort((a, b) => parseFloat(a.amount || 0) - parseFloat(b.amount || 0));
    // Update count
    const countEl = document.getElementById('transCount');
    if (countEl) countEl.textContent = `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`;
    // Render
    list.innerHTML = filtered.length ? filtered.map(p => this.transCard(p)).join('') : '<p class="no-content">No transactions match</p>';
};

App.transCard = function(p) {
    const fan = p.fan || {};
    const creator = p.creator || {};
    const fanAvatar = fan.avatar ? `<img src="${fan.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--text-secondary)">${(fan.display_name || fan.username || 'F').charAt(0).toUpperCase()}</div>`;
    const crAvatar = creator.avatar ? `<img src="${creator.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">` : `<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--text-secondary)">${(creator.display_name || creator.username || 'C').charAt(0).toUpperCase()}</div>`;
    const statusClass = p.status === 'approved' ? 'status-approved' : p.status === 'pending' ? 'status-pending' : p.status === 'rejected' ? 'status-declined' : 'status-expired';
    const typeLabel = (p.payment_type || 'Payment').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    const methodLabel = (p.method || 'Unknown').replace('_', ' ').toUpperCase();
    const date = p.created_at ? new Date(p.created_at).toLocaleString() : '';
    return `<div class="trans-card" onclick="App.showTransDetail('${p.id}')"><div class="trans-users"><div class="trans-user"><div class="trans-avatar">${fanAvatar}</div><div class="trans-user-info"><div class="trans-username">@${this.esc(fan.username || 'Unknown')}</div><div class="trans-display">${this.esc(fan.display_name || '')}</div></div></div><div class="trans-arrow"><i class="fas fa-arrow-right" style="color:var(--text-secondary);font-size:12px"></i></div><div class="trans-user"><div class="trans-avatar">${crAvatar}</div><div class="trans-user-info"><div class="trans-username">@${this.esc(creator.username || 'Unknown')}</div><div class="trans-display">${this.esc(creator.display_name || '')}</div></div></div></div><div class="trans-details-row"><span class="trans-type">${typeLabel}</span><span class="trans-method">${methodLabel}</span><span class="trans-amount">$${parseFloat(p.amount || 0).toFixed(2)}</span><span class="status-badge ${statusClass}">${p.status}</span></div><div class="trans-date">${date} &middot; ID: ${(p.id || '').slice(0, 8)}</div></div>`;
};

// Show transaction detail modal
App.showTransDetail = function(id) {
    const p = this._ownerTrans.find(t => t.id === id);
    if (!p) return;
    const fan = p.fan || {};
    const creator = p.creator || {};
    const statusClass = p.status === 'approved' ? 'status-approved' : p.status === 'pending' ? 'status-pending' : p.status === 'rejected' ? 'status-declined' : 'status-expired';
    let proofHtml = '';
    if (p.method === 'giftcard' && (p.gc_front_url || p.gc_back_url)) {
        proofHtml = `<div class="trans-detail-section"><div class="trans-detail-label">Gift Card Images</div><div style="display:flex;gap:8px;flex-wrap:wrap">${p.gc_front_url ? `<img src="${p.gc_front_url}" style="max-width:200px;border-radius:8px;border:1px solid var(--border)" onclick="window.open(this.src)">` : ''}${p.gc_back_url ? `<img src="${p.gc_back_url}" style="max-width:200px;border-radius:8px;border:1px solid var(--border)" onclick="window.open(this.src)">` : ''}</div></div>`;
    } else if ((p.method === 'bitcoin' || p.method === 'usdt') && p.crypto_txid) {
        proofHtml = `<div class="trans-detail-section"><div class="trans-detail-label">Transaction ID / Hash</div><div style="font-family:monospace;font-size:12px;background:var(--bg);padding:8px;border-radius:8px;word-break:break-all">${this.esc(p.crypto_txid)}</div></div>`;
    }
    const detailHtml = `<div style="max-width:500px"><div class="trans-detail-section"><div class="trans-detail-label">Fan</div><div style="display:flex;align-items:center;gap:10px">${fan.avatar ? `<img src="${fan.avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : ''}<div><div style="font-weight:700">${this.esc(fan.display_name || 'Unknown')}</div><div style="font-size:13px;color:var(--text-secondary)">@${this.esc(fan.username || '')} &middot; ${this.esc(fan.email || '')}</div></div></div></div><div class="trans-detail-section"><div class="trans-detail-label">Creator</div><div style="display:flex;align-items:center;gap:10px">${creator.avatar ? `<img src="${creator.avatar}" style="width:40px;height:40px;border-radius:50%;object-fit:cover">` : ''}<div><div style="font-weight:700">${this.esc(creator.display_name || 'Unknown')}</div><div style="font-size:13px;color:var(--text-secondary)">@${this.esc(creator.username || '')} &middot; ${this.esc(creator.email || '')}</div></div></div></div><div class="trans-detail-section"><div class="trans-detail-label">Payment Details</div><div class="trans-detail-grid"><div><span class="trans-detail-label">Type:</span> <span class="trans-detail-value">${this.esc(p.payment_type || 'N/A')}</span></div><div><span class="trans-detail-label">Method:</span> <span class="trans-detail-value">${this.esc(p.method || 'N/A')}</span></div><div><span class="trans-detail-label">Amount:</span> <span class="trans-detail-value" style="font-size:18px;font-weight:800;color:var(--primary)">$${parseFloat(p.amount || 0).toFixed(2)}</span></div><div><span class="trans-detail-label">Status:</span> <span class="status-badge ${statusClass}">${p.status}</span></div><div><span class="trans-detail-label">Date:</span> <span class="trans-detail-value">${p.created_at ? new Date(p.created_at).toLocaleString() : 'N/A'}</span></div><div><span class="trans-detail-label">ID:</span> <span class="trans-detail-value" style="font-family:monospace;font-size:11px">${p.id || 'N/A'}</span></div></div></div>${proofHtml}</div>`;
    this.showModal('Transaction Details', detailHtml);
};

// Filter and sort handlers
App.filterOwnerTrans = function(filter, btn) {
    this._transFilter = filter;
    if (btn) { document.querySelectorAll('#ownerTab-trans .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    this.applyTransFilter();
};
App.sortOwnerTrans = function(sort) {
    this._transSort = sort;
    this.applyTransFilter();
};
App.searchOwnerTrans = function(query) {
    this.applyTransFilter();
};

// Setup real-time for payments
App._transRealtime = null;
App.setupTransRealtime = function() {
    if (this._transRealtime) return;
    try {
        this._transRealtime = DB.subscribeToAllPayments((payload) => {
            console.log('[TRANS] Realtime update:', payload.eventType);
            // Refresh the transaction list
            this.renderOwnerTrans();
        });
    } catch (e) { console.error('[TRANS] Realtime setup failed:', e.message); }
};
App.switchOwnerTab = function(tab, btn) { document.querySelectorAll('#view-owner .filter-btn').forEach(b => b.classList.remove('active')); if (btn) btn.classList.add('active'); document.querySelectorAll('.owner-tab').forEach(t => t.style.display = 'none'); const target = document.getElementById('ownerTab-' + tab); if (target) target.style.display = 'block'; };
App.goToCreatorStudio = function() { this.closeModal('menuModal'); this.openModal('creatorStudioModal'); setTimeout(() => document.getElementById('creatorStudioPasswordInput')?.focus(), 300); };
App.verifyCreatorStudio = async function() { const input = document.getElementById('creatorStudioPasswordInput')?.value; if (!input) { this.toast('Enter password', 'error'); return; } if (!Auth.isAuth()) { this.toast('Not logged in', 'error'); return; } const storedPass = localStorage.getItem('creator_admin_' + Auth.getUid()); if (storedPass && input === storedPass) { this.closeModal('creatorStudioModal'); document.getElementById('creatorStudioPasswordInput').value = ''; this.go('admin'); this.toast('Welcome to Creator Studio!', 'success'); } else { this.toast('Wrong admin password!', 'error'); document.getElementById('creatorStudioPasswordInput').value = ''; } };
App.approveBadge = async function(id, creatorId) { if (!id || !creatorId) return; try { await DB.approveBadge(id, creatorId); this.toast('Approved!', 'success'); this.renderOwner(); } catch (e) { this.toast('Failed', 'error'); } };

// ===================== OWNER BADGE MANAGEMENT =====================
App._ownerBadges = [];
App._ownerBadgeFilter = 'all';

App.renderOwnerBadges = async function(status, btn) {
    if (btn) { document.querySelectorAll('#ownerTab-badges .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    if (status) this._ownerBadgeFilter = status;
    try {
        // Update price inputs
        const price = await DB.getBadgePrice();
        const bpu = document.getElementById('ownerBadgePriceUsd');
        const bpn = document.getElementById('ownerBadgePriceNgn');
        if (bpu && !bpu._focused) bpu.value = parseFloat(price.usd).toFixed(2);
        if (bpn && !bpn._focused) bpn.value = parseFloat(price.ngn).toFixed(0);
        // Expire badges first
        await DB.checkAndExpireBadges();
        // Load requests
        const requests = await DB.getAllBadgeRequests(this._ownerBadgeFilter);
        this._ownerBadges = requests;
        // Update counts
        try {
            const all = await DB.getAllBadgeRequests('all');
            const cA = document.getElementById('ownerBadgeCountActive'); const cP = document.getElementById('ownerBadgeCountPending');
            const cE = document.getElementById('ownerBadgeCountExpired'); const cR = document.getElementById('ownerBadgeCountRejected');
            if (cA) cA.textContent = all.filter(x => x.status === 'active').length;
            if (cP) cP.textContent = all.filter(x => x.status === 'pending').length;
            if (cE) cE.textContent = all.filter(x => x.status === 'expired').length;
            if (cR) cR.textContent = all.filter(x => x.status === 'rejected').length;
        } catch (e) {}
        const list = document.getElementById('ownerBadgeList');
        if (!list) return;
        list.innerHTML = requests.length ? requests.map(r => this.ownerBadgeCard(r)).join('') : '<p class="no-content">No badge requests found</p>';
    } catch (e) { console.error('[OWNER BADGES] Error:', e.message); }
};

App.filterOwnerBadges = function(status, btn) { this.renderOwnerBadges(status, btn); };

App.ownerBadgeCard = function(r) {
    const c = r.creator || {};
    const avatar = c.avatar ? `style="background-image:url('${c.avatar}')"` : '';
    const initial = c.avatar ? '' : (c.display_name || c.username || '?').charAt(0).toUpperCase();
    const statusClass = 'badge-status-' + r.status;
    const date = r.created_at ? new Date(r.created_at).toLocaleString() : 'N/A';
    const screenshotHtml = r.screenshot_url ? `<img src="${r.screenshot_url}" class="badge-request-screenshot" onclick="window.open('${r.screenshot_url}','_blank')" alt="Receipt">` : '';
    let actionsHtml = '';
    if (r.status === 'pending') {
        actionsHtml = `<button class="btn btn-primary btn-sm" onclick="App.approveBadgeRequest('${r.id}','${r.creator_id}')"><i class="fas fa-check"></i> Approve</button><button class="btn btn-danger btn-sm" onclick="App.rejectBadgeRequest('${r.id}')"><i class="fas fa-times"></i> Reject</button>`;
    } else if (r.status === 'active') {
        actionsHtml = `<button class="btn btn-outline btn-sm" onclick="App.suspendBadge('${r.id}','${r.creator_id}')"><i class="fas fa-pause"></i> Suspend</button><button class="btn btn-primary btn-sm" onclick="App.reactivateBadge('${r.id}','${r.creator_id}')"><i class="fas fa-redo"></i> Reactivate</button>`;
    } else if (r.status === 'suspended') {
        actionsHtml = `<button class="btn btn-primary btn-sm" onclick="App.reactivateBadge('${r.id}','${r.creator_id}')"><i class="fas fa-play"></i> Reactivate</button><button class="btn btn-outline btn-sm" onclick="App.approveBadgeRequest('${r.id}','${r.creator_id}')"><i class="fas fa-check"></i> Approve</button>`;
    } else if (r.status === 'rejected') {
        actionsHtml = `<button class="btn btn-primary btn-sm" onclick="App.approveBadgeRequest('${r.id}','${r.creator_id}')"><i class="fas fa-check"></i> Approve</button>`;
    } else if (r.status === 'expired') {
        actionsHtml = `<button class="btn btn-primary btn-sm" onclick="App.reactivateBadge('${r.id}','${r.creator_id}')"><i class="fas fa-redo"></i> Renew</button>`;
    }
    actionsHtml += `<button class="btn btn-danger btn-sm" onclick="App.deleteBadgeRequest('${r.id}')"><i class="fas fa-trash-alt"></i> Delete</button>`;
    return `<div class="badge-request-card"><div class="badge-request-header"><div class="badge-request-avatar" ${avatar}>${initial}</div><div class="badge-request-info"><div class="badge-request-name">${this.esc(c.display_name || c.username || 'Unknown')}</div><div class="badge-request-meta">@${this.esc(c.username || '')} &middot; ${this.esc(r.email || c.email || '')}</div></div><span class="badge-request-status ${statusClass}">${r.status}</span></div>${screenshotHtml}<div class="badge-request-details"><div class="badge-request-detail-item"><div class="badge-request-detail-label">Full Name</div><div class="badge-request-detail-value">${this.esc(r.full_name || 'N/A')}</div></div><div class="badge-request-detail-item"><div class="badge-request-detail-label">Amount Paid</div><div class="badge-request-detail-value">${this.esc(r.amount_paid || 'N/A')}</div></div><div class="badge-request-detail-item"><div class="badge-request-detail-label">Reference</div><div class="badge-request-detail-value" style="font-family:monospace;font-size:12px">${this.esc(r.payment_reference || 'N/A')}</div></div><div class="badge-request-detail-item"><div class="badge-request-detail-label">Date</div><div class="badge-request-detail-value">${r.date_of_payment || date}</div></div><div class="badge-request-detail-item"><div class="badge-request-detail-label">Badge Price</div><div class="badge-request-detail-value">$${r.price_usd || '8.00'} / &#8358;${parseFloat(r.price_ngn || 11200).toLocaleString()}</div></div><div class="badge-request-detail-item"><div class="badge-request-detail-label">Submitted</div><div class="badge-request-detail-value">${date}</div></div></div>${r.note ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;padding:8px;background:var(--bg-card);border-radius:8px"><strong>Note:</strong> ${this.esc(r.note)}</div>` : ''}${r.rejected_reason ? `<div style="font-size:12px;color:var(--red);margin-bottom:10px;padding:8px;background:rgba(239,68,68,0.05);border-radius:8px"><strong>Rejection Reason:</strong> ${this.esc(r.rejected_reason)}</div>` : ''}<div class="badge-request-actions">${actionsHtml}</div></div>`;
};

App.approveBadgeRequest = async function(id, creatorId) {
    if (!id || !creatorId) return;
    try { await DB.approveBadge(id, creatorId); this.toast('Badge approved!', 'success'); this.renderOwnerBadges(); } catch (e) { this.toast('Failed: ' + (e.message || ''), 'error'); }
};

App.rejectBadgeRequest = async function(id) {
    if (!id) return;
    const reason = prompt('Enter rejection reason (optional):') || '';
    try { await DB.rejectBadge(id, reason); this.toast('Badge rejected.', 'info'); this.renderOwnerBadges(); } catch (e) { this.toast('Failed', 'error'); }
};

App.deleteBadgeRequest = async function(id) {
    if (!id || !confirm('Delete this badge request permanently?')) return;
    try { await DB.deleteBadgeRequest(id); this.toast('Deleted.', 'info'); this.renderOwnerBadges(); } catch (e) { this.toast('Failed', 'error'); }
};

App.suspendBadge = async function(id, creatorId) {
    if (!id || !creatorId) return;
    try { await DB.suspendBadge(id, creatorId); this.toast('Badge suspended.', 'info'); this.renderOwnerBadges(); } catch (e) { this.toast('Failed', 'error'); }
};

App.reactivateBadge = async function(id, creatorId) {
    if (!id || !creatorId) return;
    try { await DB.reactivateBadge(id, creatorId); this.toast('Badge reactivated!', 'success'); this.renderOwnerBadges(); } catch (e) { this.toast('Failed', 'error'); }
};

// ===================== VIP SUBSCRIBERS MANAGEMENT =====================
App._vipSubs = [];
App._vipSubFilter = 'all';

App.renderVipSubscribers = async function() {
    if (!Auth.isAuth()) return;
    const uid = Auth.getUid(); // CREATOR'S ID
    console.log('[VIP RENDER] Creator ID:', uid);
    try {
        const purchases = await DB.getCreatorVipPurchases(uid);
        console.log('[VIP RENDER] Raw purchases count:', purchases?.length);
        if (purchases?.length > 0) {
            purchases.forEach((p, i) => {
                console.log(`[VIP RENDER] Purchase ${i}:`, {
                    id: p.id,
                    buyer_id: p.buyer_id,
                    buyer_username: p.buyer?.username,
                    buyer_display: p.buyer?.display_name,
                    video_title: p.video?.title,
                    status: p.status,
                    amount: p.amount
                });
            });
        }
        this._vipSubs = purchases || [];
        this.filterVipSubscribers(this._vipSubFilter);
        // Update stats
        const stats = { active: 0, pending: 0, expired: 0, declined: 0, disabled: 0 };
        this._vipSubs.forEach(p => { stats[p.status] = (stats[p.status] || 0) + 1; });
        const sA = document.getElementById('vipSubCountActive'); const sP = document.getElementById('vipSubCountPending');
        const sE = document.getElementById('vipSubCountExpired'); const sD = document.getElementById('vipSubCountDeclined');
        const sDi = document.getElementById('vipSubCountDisabled');
        if (sA) sA.textContent = stats.active; if (sP) sP.textContent = stats.pending;
        if (sE) sE.textContent = stats.expired; if (sD) sD.textContent = stats.declined;
        if (sDi) sDi.textContent = stats.disabled;
    } catch (e) { /* silent */ }
};

App.filterVipSubscribers = function(status, btn) {
    if (btn) { document.querySelectorAll('#admin-vip-subscribers .filter-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    this._vipSubFilter = status;
    const list = document.getElementById('vipSubscribersList');
    if (!list) return;
    const filtered = status === 'all' ? this._vipSubs : this._vipSubs.filter(s => s.status === status);
    list.innerHTML = filtered.length ? filtered.map(p => this.vipSubCard(p)).join('') : '<p class="no-content">No VIP subscribers found</p>';
};

App.vipSubCard = function(p) {
    // p.buyer is now reliably merged by getCreatorVipPurchases (manual profile fetch)
    const buyer = p.buyer || {};
    const video = p.video || {};
    const displayName = buyer.display_name || buyer.username || 'Unknown';
    const avatar = buyer.avatar ? `style="background-image:url('${buyer.avatar}')"` : '';
    const initial = buyer.avatar ? '' : (buyer.display_name || buyer.username || '?').charAt(0).toUpperCase();
    const statusClass = 'status-' + p.status;
    const approved = p.approved_at ? new Date(p.approved_at).toLocaleString() : 'N/A';
    const expires = p.expires_at ? new Date(p.expires_at).toLocaleString() : 'N/A';
    let remaining = '';
    if (p.status === 'approved' && p.expires_at) {
        const diff = new Date(p.expires_at) - Date.now();
        if (diff > 0) { const h = Math.floor(diff / 3600000); const m = Math.floor((diff % 3600000) / 60000); remaining = `${h}h ${m}m`; }
        else remaining = 'Expired';
    }
    let actions = '';
    if (p.status === 'pending') {
        actions = `<button class="btn btn-primary btn-sm" onclick="App.approveVipPurchase('${p.id}')"><i class="fas fa-check"></i> Approve</button><button class="btn btn-danger btn-sm" onclick="App.declineVipPurchase('${p.id}')"><i class="fas fa-times"></i> Decline</button>`;
    } else if (p.status === 'approved') {
        actions = `<button class="btn btn-outline btn-sm" onclick="App.disableVipPurchase('${p.id}')"><i class="fas fa-ban"></i> Disable</button>`;
    } else if (p.status === 'declined' || p.status === 'disabled') {
        actions = `<button class="btn btn-primary btn-sm" onclick="App.approveVipPurchase('${p.id}')"><i class="fas fa-redo"></i> Re-approve</button>`;
    }
    actions += `<button class="btn btn-danger btn-sm" onclick="App.removeVipPurchase('${p.id}')"><i class="fas fa-trash-alt"></i> Remove</button>`;
    return `<div class="vip-sub-card"><div class="vip-sub-header"><div class="vip-sub-avatar" ${avatar}>${initial}</div><div class="vip-sub-info"><div class="vip-sub-name">${this.esc(displayName)}</div><div class="vip-sub-video">${this.esc(video.title || 'VIP Video')} - $${video.price || 0}</div></div><span class="status-badge ${statusClass}">${p.status}</span></div><div class="vip-sub-details"><div class="vip-sub-detail"><span class="label">Username:</span><span class="value">${this.esc(buyer.username || 'N/A')}</span></div><div class="vip-sub-detail"><span class="label">Method:</span><span class="value">${this.esc(p.payment_method || 'N/A')}</span></div><div class="vip-sub-detail"><span class="label">Price:</span><span class="value">$${parseFloat(p.amount || 0).toFixed(2)}</span></div><div class="vip-sub-detail"><span class="label">Approved:</span><span class="value">${approved}</span></div><div class="vip-sub-detail"><span class="label">Expires:</span><span class="value">${expires}</span></div>${remaining ? `<div class="vip-sub-detail"><span class="label">Remaining:</span><span class="value" style="color:var(--gold);font-weight:700">${remaining}</span></div>` : ''}${p.decline_reason ? `<div class="vip-sub-detail"><span class="label">Reason:</span><span class="value" style="color:var(--red)">${this.esc(p.decline_reason)}</span></div>` : ''}</div><div class="vip-sub-actions">${actions}</div></div>`;
};

App.approveVipPurchase = async function(purchaseId) {
    if (!purchaseId) { return; }
    console.log('[VIP] Approving purchase:', purchaseId);
    try {
        const purchase = this._vipSubs.find(s => s.id === purchaseId);
        console.log('[VIP] Found purchase:', purchase ? { id: purchase.id, buyer_id: purchase.buyer_id, status: purchase.status } : 'NOT FOUND');
        const success = await DB.approveVipPurchase(purchaseId);
        console.log('[VIP] DB approve result:', success);
        if (success) {
            this.toast('VIP purchase approved! Access granted for 2 days.', 'success');
            await this.renderVipSubscribers();
        } else {
            this.toast('Failed to approve. Check console for details.', 'error');
        }
    } catch (e) { this.toast('Error: ' + e.message, 'error'); }
};

App.declineVipPurchase = async function(purchaseId) {
    if (!purchaseId) return;
    const reason = prompt('Enter decline reason (optional):') || '';
    console.log('[VIP] Declining purchase:', purchaseId, 'reason:', reason);
    try {
        const success = await DB.declineVipPurchase(purchaseId, reason);
        console.log('[VIP] DB decline result:', success);
        if (success) {
            this.toast('VIP purchase declined.', 'info');
            await this.renderVipSubscribers();
        } else this.toast('Failed', 'error');
    } catch (e) { this.toast('Error', 'error'); }
};

App.disableVipPurchase = async function(purchaseId) {
    if (!purchaseId || !confirm('Disable VIP access for this user?')) return;
    console.log('[VIP] Disabling purchase:', purchaseId);
    try {
        const success = await DB.disableVipAccess(purchaseId);
        console.log('[VIP] DB disable result:', success);
        if (success) { this.toast('VIP access disabled.', 'info'); await this.renderVipSubscribers(); }
        else this.toast('Failed', 'error');
    } catch (e) { this.toast('Error', 'error'); }
};

App.removeVipPurchase = async function(purchaseId) {
    if (!purchaseId || !confirm('Remove this VIP purchase permanently?')) return;
    console.log('[VIP] Removing purchase:', purchaseId);
    try {
        const success = await DB.removeVipPurchase(purchaseId);
        console.log('[VIP] DB remove result:', success);
        if (success) { this.toast('Removed.', 'info'); await this.renderVipSubscribers(); }
        else this.toast('Failed', 'error');
    } catch (e) { this.toast('Error', 'error'); }
};

App.searchVipSubscribers = function(query) {
    const list = document.getElementById('vipSubscribersList');
    if (!list) return;
    const q = query.toLowerCase();
    const filtered = this._vipSubs.filter(s => {
        const buyer = s.buyer || {};
        const video = s.video || {};
        return (buyer.username || '').toLowerCase().includes(q) || (buyer.display_name || '').toLowerCase().includes(q) || (video.title || '').toLowerCase().includes(q);
    });
    list.innerHTML = filtered.length ? filtered.map(p => this.vipSubCard(p)).join('') : '<p class="no-content">No matching subscribers</p>';
};

App.updateBadgePrice = async function() {
    const usd = parseFloat(document.getElementById('ownerBadgePriceUsd')?.value);
    const ngn = parseFloat(document.getElementById('ownerBadgePriceNgn')?.value);
    if (isNaN(usd) || isNaN(ngn) || usd < 0 || ngn < 0) { this.toast('Enter valid prices', 'error'); return; }
    try { await DB.updateBadgePrice(usd, ngn); this.toast('Badge price updated!', 'success'); } catch (e) { this.toast('Failed', 'error'); }
};

// Track focus on price inputs to prevent overwriting during typing
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const bpu = document.getElementById('ownerBadgePriceUsd');
        const bpn = document.getElementById('ownerBadgePriceNgn');
        if (bpu) { bpu.addEventListener('focus', () => { bpu._focused = true; }); bpu.addEventListener('blur', () => { bpu._focused = false; }); }
        if (bpn) { bpn.addEventListener('focus', () => { bpn._focused = true; }); bpn.addEventListener('blur', () => { bpn._focused = false; }); }
    }, 1000);
});

// ===================== VIP (Payment Approval Flow) =====================
App.vipItem = function(v) { return `<div class="vip-item" onclick="App.openVipVideo('${v.id}')"><video preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover" src="${v.video_url}"></video><div class="vip-overlay"><i class="fas fa-crown"></i><div class="vip-price">$${v.price}</div></div></div>`; };

App.openVipVideo = async function(id) {
    if (!id) return;
    try {
        const video = await DB.getVipVideo(id);
        if (!video) return;
        const purchased = await this.hasVipAccess(id);
        if (purchased) { this.playVipVideo(video); return; }
        // VIP is pay-per-view ONLY - subscriptions do NOT unlock VIP content
        if (!Auth.isAuth()) { this.showAuth('signup'); return; }
        this.vipId = id;
        this.payTarget = { type: 'vip', creatorId: video.creator_id, amount: video.price, videoId: id, videoTitle: video.title };
        const p = video.creator;
        const info = document.getElementById('paymentInfo');
        if (info) info.innerHTML = `<div style="display:flex;align-items:center;gap:12px"><div style="width:48px;height:48px;border-radius:50%;background-image:url('${p?.avatar || ''}');background-size:cover;background-color:var(--border)"></div><div><div style="font-weight:700">${this.esc(p?.display_name || p?.username || '')}</div><div style="font-size:13px;color:var(--text-secondary)">VIP Video: ${this.esc(video.title)} - $${video.price}</div></div></div>`;
        this.gcType = 'razer';
        document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
        const gcBtn = document.querySelector('[data-payment="giftcard"]');
        if (gcBtn) gcBtn.classList.add('active');
        const gcForm = document.getElementById('giftcardForm');
        const cryptoForm = document.getElementById('cryptoForm');
        if (gcForm) gcForm.style.display = 'block';
        if (cryptoForm) cryptoForm.style.display = 'none';
        // Load creator's Bitcoin/USDT payment settings for QR codes and addresses
        try {
            const settings = await DB.getPaymentSettings(video.creator_id);
            const btcDisplay = document.getElementById('btcAddressDisplay');
            const usdtDisplay = document.getElementById('usdtAddressDisplay');
            const usdtBadge = document.getElementById('usdtNetworkBadge');
            const btcQRBox = document.getElementById('btcQRBox');
            const usdtQRBox = document.getElementById('usdtQRBox');
            if (btcDisplay) btcDisplay.textContent = settings?.btc_address || 'Not configured';
            if (usdtDisplay) usdtDisplay.textContent = settings?.usdt_address || 'Not configured';
            if (usdtBadge) usdtBadge.textContent = settings?.usdt_network || 'TRC20';
            const btcQrUrl = settings?.btc_qr_url;
            const usdtQrUrl = settings?.usdt_qr_url;
            if (btcQRBox) { if (btcQrUrl) { btcQRBox.style.backgroundImage = `url('${btcQrUrl}')`; btcQRBox.style.backgroundSize = 'cover'; btcQRBox.innerHTML = ''; } else { btcQRBox.style.backgroundImage = 'none'; btcQRBox.innerHTML = 'Bitcoin QR<br>Not Set'; } }
            if (usdtQRBox) { if (usdtQrUrl) { usdtQRBox.style.backgroundImage = `url('${usdtQrUrl}')`; usdtQRBox.style.backgroundSize = 'cover'; usdtQRBox.innerHTML = ''; } else { usdtQRBox.style.backgroundImage = 'none'; usdtQRBox.innerHTML = 'USDT QR<br>Not Set'; } }
        } catch (settingsErr) { /* silent */ }
        this.resetGiftcardForm();
        this.openModal('paymentModal');
    } catch (e) { console.error('[APP] openVipVideo:', e.message); }
};

App.playVipVideo = function(video) { if (!video) return; const c = video.creator; const vvAvatar = document.getElementById('vipVvAvatar'); if (vvAvatar) vvAvatar.style.backgroundImage = c?.avatar ? `url('${c.avatar}')` : 'none'; const vvName = document.getElementById('vipVvName'); if (vvName) vvName.textContent = this.esc(c?.display_name || c?.username || 'Creator'); const vvTime = document.getElementById('vipVvTime'); if (vvTime) vvTime.textContent = this.timeAgo(video.created_at); const vvCaption = document.getElementById('vipVvCaption'); if (vvCaption) vvCaption.textContent = video.description || ''; const vvMedia = document.getElementById('vipVvMedia'); if (vvMedia) vvMedia.innerHTML = `<video controls autoplay playsinline style="width:100%;max-height:70vh;display:block"><source src="${video.video_url}"></video>`; this.openModal('vipVideoModal'); };
App.closeVipVideo = function() { this.closeModal('vipVideoModal'); const v = document.querySelector('#vipVvMedia video'); if (v) { v.pause(); v.src = ''; } };
App.unlockVip = function(id) { if (!id) return; this.openVipVideo(id); };
App.purchaseVip = async function() { if (!Auth.isAuth()) { this.showAuth('signup'); return; } if (!this.vipId) return; this.openVipVideo(this.vipId); };

// Check if fan has approved VIP access for a specific video
App.hasVipAccess = async function(videoId) {
    if (!Auth.isAuth() || !videoId) return false;
    try {
        const purchases = await DB.getVipPurchases(Auth.getUid());
        return purchases.some(p => p.video_id === videoId && p.status === 'approved');
    } catch (e) { return false; }
};

// ===================== SHARE =====================
App.openShare = async function() { if (!this.creatorId) return; try { const p = await DB.getProfile(this.creatorId); if (!p) return; const shareName = document.getElementById('shareName'); if (shareName) shareName.textContent = this.esc(p.display_name || p.username); const url = `${window.location.origin}${window.location.pathname}?u=${p.username}`; const shareUrl = document.getElementById('shareUrl'); if (shareUrl) shareUrl.textContent = url; const av = document.getElementById('shareAvatar'); if (av) { if (p.avatar) { av.style.backgroundImage = `url('${p.avatar}')`; av.innerHTML = ''; } else { av.style.backgroundImage = 'none'; av.innerHTML = (p.display_name || p.username).charAt(0).toUpperCase(); } } this.openModal('shareModal'); } catch (e) {} };
App.shareTo = function(platform) { const shareUrl = document.getElementById('shareUrl'); if (!shareUrl) return; const url = shareUrl.textContent; const text = 'Check out this profile on OnlyFans!'; const links = { whatsapp: `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` }; if (links[platform]) window.open(links[platform], '_blank'); };
App.copyProfileLink = async function() { if (!this.creatorId) return; try { const p = await DB.getProfile(this.creatorId); if (!p) return; const url = `${window.location.origin}${window.location.pathname}?u=${p.username}`; await navigator.clipboard.writeText(url); this.toast('Copied!', 'success'); } catch (e) { this.toast('Copy failed', 'error'); } };
App.nativeShare = async function() { const shareUrl = document.getElementById('shareUrl'); if (!shareUrl) return; try { await navigator.share({ title: 'OnlyFans Profile', text: 'Check this out!', url: shareUrl.textContent }); } catch (e) {} };

// ===================== UI =====================
App.openModal = function(id) { const el = document.getElementById(id); if (el) { el.classList.add('active'); document.body.style.overflow = 'hidden'; } };
App.closeModal = function(id) { const el = document.getElementById(id); if (el) { el.classList.remove('active'); } if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = ''; };
App.showUserMenu = function() { this.openModal('menuModal'); };
App.toast = function(message, type, duration) { let c = document.getElementById('toastContainer'); if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; document.body.appendChild(c); } const t = document.createElement('div'); const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' }; t.className = 'toast toast-' + (type || 'info'); t.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + this.esc(message); c.appendChild(t); setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); }, duration || 3000); };
App.toggleTheme = function() { const html = document.documentElement; const current = html.getAttribute('data-theme') || 'light'; const next = current === 'light' ? 'dark' : 'light'; html.setAttribute('data-theme', next); localStorage.setItem('theme', next); document.querySelectorAll('#themeIcon, #themeIconFeed').forEach(i => { if (i) i.className = 'fas ' + (next === 'dark' ? 'fa-sun' : 'fa-moon'); }); };

// ===================== UTILITIES =====================
App.esc = function(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };
App.fmtNum = function(n) { n = parseFloat(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return n.toString(); };
App.timeAgo = function(d) { if (!d) return 'Just now'; const s = Math.floor((Date.now() - new Date(d)) / 1e3); if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return new Date(d).toLocaleDateString(); };

// ===================== PAYMENTS UI =====================
App.switchPayTab = function(tab, btn) { document.querySelectorAll('#paymentModal .tab').forEach(t => t.classList.remove('active')); if (btn) btn.classList.add('active'); const panels = { giftcard: 'payPanelGiftcard', btc: 'payPanelBtc', usdt: 'payPanelUsdt' }; Object.values(panels).forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('active'); }); const target = panels[tab]; if (target) { const el = document.getElementById(target); if (el) el.classList.add('active'); } };
// ===================== GIFT CARD SYSTEM =====================
App._gcFrontDataUrl = null;
App._gcBackDataUrl = null;
App.gcType = 'razer';

// Complete country list
App._countries = [
    "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan",
    "Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi",
    "Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic",
    "Denmark","Djibouti","Dominica","Dominican Republic",
    "Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia",
    "Fiji","Finland","France",
    "Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
    "Haiti","Honduras","Hungary",
    "Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast",
    "Jamaica","Japan","Jordan",
    "Kazakhstan","Kenya","Kiribati","Korea North","Korea South","Kosovo","Kuwait","Kyrgyzstan",
    "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
    "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
    "Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Macedonia","Norway",
    "Oman",
    "Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal",
    "Qatar",
    "Romania","Russia","Rwanda",
    "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
    "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
    "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
    "Vanuatu","Vatican City","Venezuela","Vietnam",
    "Yemen",
    "Zambia","Zimbabwe"
];

App.selectGC = function(type) {
    console.log('[GC] Selected:', type);
    this.gcType = type;
    // Remove selected from all cards, add to clicked one
    document.querySelectorAll('.pay-card[data-gc]').forEach(b => b.classList.remove('selected'));
    const selected = document.querySelector(`.pay-card[data-gc="${type}"]`);
    if (selected) selected.classList.add('selected');
};

// Show country dropdown list
App.showCountryList = function() {
    const list = document.getElementById('gcCountryList');
    if (!list) return;
    const query = (document.getElementById('gcCountryInput')?.value || '').toLowerCase();
    const filtered = query ? this._countries.filter(c => c.toLowerCase().includes(query)) : this._countries;
    list.innerHTML = filtered.map(c => `<div class="gc-country-item" onclick="App.selectCountry('${c}')">${c}</div>`).join('');
    list.classList.add('active');
};

// Filter countries as user types
App.filterCountries = function(query) {
    const list = document.getElementById('gcCountryList');
    if (!list) return;
    const q = query.toLowerCase();
    const filtered = this._countries.filter(c => c.toLowerCase().includes(q));
    list.innerHTML = filtered.map(c => `<div class="gc-country-item" onclick="App.selectCountry('${c}')">${c}</div>`).join('');
    list.classList.add('active');
};

// Select a country
App.selectCountry = function(country) {
    const input = document.getElementById('gcCountryInput');
    const hidden = document.getElementById('gcCountry');
    if (input) input.value = country;
    if (hidden) hidden.value = country;
    document.getElementById('gcCountryList')?.classList.remove('active');
};

// Close country list when clicking outside
document.addEventListener('click', function(e) {
    const wrap = document.querySelector('.gc-country-wrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('gcCountryList')?.classList.remove('active');
    }
});

// Handle gift card front image upload
App.handleGcFrontUpload = function(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        this._gcFrontDataUrl = ev.target.result;
        const preview = document.getElementById('gcFrontPreview');
        const box = document.getElementById('gcFrontBox');
        if (preview) preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover">`;
        if (box) box.classList.add('has-image');
    };
    reader.readAsDataURL(file);
};

// Handle gift card back image upload
App.handleGcBackUpload = function(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        this._gcBackDataUrl = ev.target.result;
        const preview = document.getElementById('gcBackPreview');
        const box = document.getElementById('gcBackBox');
        if (preview) preview.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover">`;
        if (box) box.classList.add('has-image');
    };
    reader.readAsDataURL(file);
};
App.showPaymentStatus = function(type, data) { this.show('payment-status'); const title = document.getElementById('paymentStatusTitle'); const desc = document.getElementById('paymentStatusDesc'); const icon = document.getElementById('paymentStatusIcon'); const actions = document.getElementById('paymentStatusActions'); if (type === 'pending') { if (title) title.textContent = 'Payment Sent'; if (desc) desc.textContent = 'Your payment is pending confirmation. The creator will review and confirm.'; if (icon) icon.innerHTML = '<div style="width:80px;height:80px;border-radius:50%;background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center"><i class="fas fa-clock" style="font-size:36px;color:var(--gold)"></i></div>'; if (actions) actions.innerHTML = '<button class="btn btn-primary btn-block" onclick="App.go(\'feed\')"><i class="fas fa-home"></i> Back to Home</button>'; } };

// ===================== NAV =====================
App.updateNav = function() {
    const user = Auth.profile;
    const ids = ['feedNavAvatar', 'profileNavAvatar', 'messagesNavAvatar', 'userProfileNavAvatar', 'paymentStatusNavAvatar'];
    ids.forEach(id => { const el = document.getElementById(id); if (!el) return; if (user?.avatar) { el.style.backgroundImage = `url('${user.avatar}')`; el.style.backgroundColor = 'transparent'; el.textContent = ''; } else { el.style.backgroundImage = 'none'; el.style.backgroundColor = 'var(--primary)'; el.textContent = user?.display_name?.charAt(0).toUpperCase() || 'U'; } });
    const fr = document.getElementById('feedNavRight');
    if (fr) {
        if (Auth.isAuth()) {
            fr.innerHTML = `<button class="nav-icon-btn" onclick="App.renderNotificationCenter()" style="position:relative"><i class="fas fa-bell"></i><span class="nav-badge" id="notifBadge" style="display:none;position:absolute;top:-4px;right:-4px">0</span></button><button class="nav-icon-btn" onclick="App.go('messages')" style="position:relative"><i class="fas fa-comment-dots"></i><span class="nav-badge" id="msgBadge" style="display:none;position:absolute;top:-4px;right:-4px">0</span></button><div class="nav-avatar" id="feedNavAvatar" onclick="App.showUserMenu()" style="cursor:pointer">U</div>`;
        } else {
            fr.innerHTML = `<button class="nav-btn" onclick="App.showAuth('login')"><i class="fas fa-sign-in-alt"></i> Log In</button><button class="nav-btn nav-btn-primary" onclick="App.showAuth('signup')"><i class="fas fa-user-plus"></i> Sign Up</button>`;
        }
    }
    const ab = document.getElementById('navAdminBtn'); if (ab) ab.style.display = (user && user.id === this.creatorId && user.type === 'creator') ? 'inline-flex' : 'none';
    this.updateUnreadBadge();
};

// ===================== ERROR HANDLING =====================
window.onerror = function(msg, url, line) { console.error('[ERROR] ' + msg + ' at line ' + line); return true; };
window.addEventListener('unhandledrejection', e => { console.error('[PROMISE ERROR]', e.reason); e.preventDefault(); });

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => App.init());

/**
 * SUPABASE.JS - Supabase Client & Backend Helpers
 * Connected to: https://uorhtsaxthwypupujngq.supabase.co
 * PRODUCTION VERSION - Zero missing column errors
 */

const SUPABASE_URL = 'https://uorhtsaxthwypupujngq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3PtmR0zVavqlHeq7zQmbeA_i55p8VKv';

let sb = null;
let sbReady = false;

function initSupabase() {
    if (sb && sbReady) return sb;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.error('[SB] Supabase library not loaded');
        return null;
    }
    try {
        sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
            realtime: { params: { eventsPerSecond: 10 } }
        });
        sbReady = true;
        console.log('[SB] Connected');
        return sb;
    } catch (e) {
        console.error('[SB] Init failed:', e.message);
        return null;
    }
}

function getSb() {
    if (!sb || !sbReady) return initSupabase();
    return sb;
}

// ===================== AUTH =====================
const Auth = {
    user: null, profile: null, session: null,

    async init() {
        const client = getSb();
        if (!client) return false;
        try {
            const { data: { session }, error } = await client.auth.getSession();
            if (error) { console.warn('[AUTH] Session error:', error.message); return false; }
            this.session = session;
            if (session?.user) {
                this.user = session.user;
                await this.loadProfile();
                if (!this.profile) await this.ensureProfile();
            }
            client.auth.onAuthStateChange(async (event, session) => {
                this.session = session;
                this.user = session?.user || null;
                if (event === 'SIGNED_IN') {
                    await this.loadProfile();
                    if (!this.profile) await this.ensureProfile();
                    if (window.App) App.updateNav();
                } else if (event === 'SIGNED_OUT') {
                    this.profile = null; this.user = null; this.session = null;
                    if (window.App) App.updateNav();
                }
            });
            return true;
        } catch (e) { console.error('[AUTH] Init:', e.message); return false; }
    },

    async loadProfile() {
        if (!this.user) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.from('profiles').select('*').eq('id', this.user.id).maybeSingle();
            if (error) { console.warn('[AUTH] Profile load:', error.message); return null; }
            this.profile = data;
            return data;
        } catch (e) { return null; }
    },

    async ensureProfile() {
        if (!this.user) return null;
        const client = getSb(); if (!client) return null;
        try {
            const meta = this.user.user_metadata || {};
            const username = meta.username || this.user.email.split('@')[0] + '_' + this.user.id.substring(0, 6);
            const { data, error } = await client.from('profiles').insert({
                id: this.user.id, username, display_name: meta.display_name || username,
                email: this.user.email, type: meta.type || 'fan'
            }).select().maybeSingle();
            if (error) {
                if (error.code === '23505') return await this.loadProfile();
                console.warn('[AUTH] ensureProfile:', error.message); return null;
            }
            this.profile = data; return data;
        } catch (e) { return null; }
    },

    async signUp(email, password, username, displayName, type) {
        const client = getSb(); if (!client) throw new Error('Supabase not initialized');
        try {
            const { data: existing } = await client.from('profiles').select('username').eq('username', username).maybeSingle();
            if (existing) throw new Error('Username already taken');
        } catch (e) { if (e.message === 'Username already taken') throw e; }
        const { data, error } = await client.auth.signUp({
            email, password, options: { data: { username, display_name: displayName || username, type: type || 'fan' } }
        });
        if (error) throw error;
        if (data?.user) {
            try { await client.from('profiles').update({ username, display_name: displayName || username, type: type || 'fan', email }).eq('id', data.user.id); } catch (e) {}
            if (type === 'creator') {
                try { await client.from('creator_payment_settings').insert({ creator_id: data.user.id }); } catch (e) {}
            }
            // Send welcome notification (minimal payload to avoid schema cache issues)
            try {
                await client.from('notifications').insert({
                    user_id: data.user.id,
                    type: 'welcome',
                    title: 'Welcome to OnlyFans!',
                    body: 'We are excited to have you here. Explore creators and subscribe to exclusive content.'
                });
            } catch (n) { console.warn('[AUTH] Welcome notif failed:', n.message); }
        }
        return data;
    },

    async signIn(email, password) {
        const client = getSb(); if (!client) throw new Error('Supabase not initialized');
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        this.session = data.session; this.user = data.user;
        await this.loadProfile(); if (!this.profile) await this.ensureProfile();
        return data;
    },

    async signOut() {
        const client = getSb();
        if (client) try { await client.auth.signOut(); } catch (e) {}
        this.user = null; this.profile = null; this.session = null;
    },

    async resetPassword(email) {
        const client = getSb(); if (!client) throw new Error('Supabase not initialized');
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
        if (error) throw error; return true;
    },

    async updatePassword(newPassword) {
        const client = getSb(); if (!client) throw new Error('Supabase not initialized');
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw error; return true;
    },

    isAuth() { return !!this.user && !!this.session; },
    isCreator() { return this.profile?.type === 'creator'; },
    isAdmin() { return this.profile?.type === 'admin'; },
    getUid() { return this.user?.id || null; }
};

// ===================== DATABASE =====================
const DB = {
    async getProfile(id) {
        if (!id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle(); return error ? null : data; } catch (e) { return null; }
    },

    async getProfileByUsername(u) {
        if (!u) return null;
        const client = getSb(); if (!client) return null;
        try { const { data, error } = await client.from('profiles').select('*').eq('username', u).maybeSingle(); return error ? null : data; } catch (e) { return null; }
    },

    async updateProfile(id, updates) {
        if (!id || !updates) return null;
        const client = getSb(); if (!client) return null;
        try { const { data, error } = await client.from('profiles').update(updates).eq('id', id).select().maybeSingle(); return error ? null : data; } catch (e) { return null; }
    },

    async listCreators(search, limit) {
        const client = getSb(); if (!client) return [];
        try { let q = client.from('profiles').select('*').eq('type', 'creator').order('created_at', { ascending: false }).limit(limit || 50); if (search) q = q.ilike('username', `%${search}%`); const { data, error } = await q; return data || []; } catch (e) { return []; }
    },

    async listAllUsers() {
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('profiles').select('*').order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async listAllCreators() {
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('profiles').select('*').eq('type', 'creator').order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    // Posts
    async createPost(post) {
        if (!post?.creator_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('posts').insert(post).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getPosts(creatorId, limit) {
        const client = getSb(); if (!client) return [];
        try { let q = client.from('posts').select('*, creator:profiles!posts_creator_id_fkey(*)').order('created_at', { ascending: false }).limit(limit || 50); if (creatorId) q = q.eq('creator_id', creatorId); const { data } = await q; return data || []; } catch (e) { return []; }
    },

    async getPost(id) {
        if (!id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('posts').select('*, creator:profiles!posts_creator_id_fkey(*)').eq('id', id).maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async deletePost(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('posts').delete().eq('id', id); return true; } catch (e) { return false; }
    },

    // Likes
    // Likes - FULLY CONNECTED WITH PROFILES
    // Uses RPC toggle_post_like which atomically handles like/unlike
    // and updates posts.likes_count + profiles.likes_count
    async toggleLike(postId, userId) {
        if (!postId || !userId) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.rpc('toggle_post_like', {
                p_post_id: postId,
                p_user_id: userId
            });
            if (error) { console.error('[DB] toggleLike RPC:', error.message); return null; }
            return data || null;
        } catch (e) { console.error('[DB] toggleLike:', e.message); return null; }
    },

    async getLikes(postId) {
        if (!postId) return [];
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.from('post_likes').select('user_id, created_at, user:profiles!post_likes_user_id_fkey(*)').eq('post_id', postId).order('created_at', { ascending: false });
            if (error) { console.error('[DB] getLikes:', error.message); return []; }
            return data || [];
        } catch (e) { console.error('[DB] getLikes:', e.message); return []; }
    },

    async getLikeCount(postId) {
        if (!postId) return 0;
        const client = getSb(); if (!client) return 0;
        try {
            const { count, error } = await client.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
            if (error) { console.error('[DB] getLikeCount:', error.message); return 0; }
            return count || 0;
        } catch (e) { console.error('[DB] getLikeCount:', e.message); return 0; }
    },

    async isPostLiked(postId, userId) {
        if (!postId || !userId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.from('post_likes').select('id').eq('post_id', postId).eq('user_id', userId).maybeSingle();
            if (error) return false;
            return !!data;
        } catch (e) { return false; }
    },

    // Boost History
    async recordBoost(postId, ownerId, previousCount, likesAdded) {
        if (!postId || !ownerId || !likesAdded) return false;
        const client = getSb(); if (!client) return false;
        try {
            const newTotal = previousCount + likesAdded;
            // Update post boosted_likes
            const { error: e1 } = await client.from('posts').update({ boosted_likes: likesAdded }).eq('id', postId);
            if (e1) { console.error('[DB] recordBoost update post:', e1.message); return false; }
            // Record in history
            const { error: e2 } = await client.from('boost_history').insert({ post_id: postId, owner_id: ownerId, previous_count: previousCount, likes_added: likesAdded, new_total: newTotal });
            if (e2) { console.error('[DB] recordBoost insert history:', e2.message); }
            return true;
        } catch (e) { console.error('[DB] recordBoost:', e.message); return false; }
    },

    async getBoostHistory() {
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.from('boost_history').select('*, post:posts!boost_history_post_id_fkey(*), owner:profiles!boost_history_owner_id_fkey(*)').order('created_at', { ascending: false });
            if (error) { console.error('[DB] getBoostHistory:', error.message); return []; }
            return data || [];
        } catch (e) { console.error('[DB] getBoostHistory:', e.message); return []; }
    },

    async removeBoostRecord(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try {
            // Get the post_id and likes_added first
            const { data: rec } = await client.from('boost_history').select('post_id, likes_added').eq('id', id).maybeSingle();
            if (rec?.post_id) {
                // Reset boosted_likes on the post
                await client.from('posts').update({ boosted_likes: 0 }).eq('id', rec.post_id);
            }
            await client.from('boost_history').delete().eq('id', id);
            return true;
        } catch (e) { console.error('[DB] removeBoostRecord:', e.message); return false; }
    },

    async resetPostBoost(postId) {
        if (!postId) return false;
        const client = getSb(); if (!client) return false;
        try {
            await client.from('posts').update({ boosted_likes: 0 }).eq('id', postId);
            await client.from('boost_history').delete().eq('post_id', postId);
            return true;
        } catch (e) { console.error('[DB] resetPostBoost:', e.message); return false; }
    },

    // Creator Like Analytics
    async getCreatorLikeAnalytics(creatorId) {
        if (!creatorId) return { totalLikes: 0, totalBoosted: 0, mostLikedPost: null, posts: [] };
        const client = getSb(); if (!client) return { totalLikes: 0, totalBoosted: 0, mostLikedPost: null, posts: [] };
        try {
            // Get all posts for this creator
            const { data: posts, error } = await client.from('posts').select('id, caption, media_url, type, boosted_likes, created_at').eq('creator_id', creatorId).order('created_at', { ascending: false });
            if (error || !posts?.length) return { totalLikes: 0, totalBoosted: 0, mostLikedPost: null, posts: [] };
            // Get like counts for each post
            let totalRealLikes = 0;
            let totalBoosted = 0;
            let mostLiked = null;
            let maxLikes = -1;
            const postsWithLikes = [];
            for (const p of posts) {
                const { count } = await client.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', p.id);
                const realLikes = count || 0;
                const boosted = p.boosted_likes || 0;
                const total = realLikes + boosted;
                totalRealLikes += realLikes;
                totalBoosted += boosted;
                postsWithLikes.push({ ...p, real_likes: realLikes, total_likes: total });
                if (total > maxLikes) { maxLikes = total; mostLiked = { ...p, real_likes: realLikes, total_likes: total }; }
            }
            return { totalLikes: totalRealLikes + totalBoosted, totalBoosted, mostLikedPost: mostLiked, posts: postsWithLikes };
        } catch (e) { console.error('[DB] getCreatorLikeAnalytics:', e.message); return { totalLikes: 0, totalBoosted: 0, mostLikedPost: null, posts: [] }; }
    },

    // Realtime for post_likes
    subscribeToPostLikes(postId, cb) {
        if (!postId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel(`likes:${postId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes', filter: `post_id=eq.${postId}` }, cb).subscribe(); } catch (e) { return null; }
    },

    // Stories
    async createStory(story) {
        if (!story?.creator_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('stories').insert(story).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getStories(creatorId) {
        const client = getSb(); if (!client) return [];
        try { let q = client.from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }); if (creatorId) q = q.eq('creator_id', creatorId); const { data } = await q; return data || []; } catch (e) { return []; }
    },

    // Subscriptions
    async createSubscription(sub) {
        if (!sub?.subscriber_id || !sub?.creator_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('subscriptions').upsert(sub, { onConflict: 'subscriber_id,creator_id' }).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getSubscription(subId, creatorId) {
        if (!subId || !creatorId) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('subscriptions').select('*').eq('subscriber_id', subId).eq('creator_id', creatorId).maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getUserSubs(userId) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('subscriptions').select('*, creator:profiles!subscriptions_creator_id_fkey(*)').eq('subscriber_id', userId).order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async getCreatorSubs(creatorId) {
        if (!creatorId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('subscriptions').select('*, subscriber:profiles!subscriptions_subscriber_id_fkey(*)').eq('creator_id', creatorId).order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async updateSubscription(id, updates) {
        if (!id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('subscriptions').update(updates).eq('id', id).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getPayment(id) {
        if (!id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('payments').select('*').eq('id', id).maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async deleteSubscription(subscriberId, creatorId) {
        if (!subscriberId || !creatorId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('subscriptions').delete().eq('subscriber_id', subscriberId).eq('creator_id', creatorId); return true; } catch (e) { return false; }
    },

    // Subscription Plans
    async getCreatorPlans(creatorId) {
        if (!creatorId) return [];
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.from('subscription_plans').select('*').eq('creator_id', creatorId).order('sort_order', { ascending: true });
            if (error) { console.error('[DB] getCreatorPlans:', error.message); return []; }
            return data || [];
        } catch (e) { console.error('[DB] getCreatorPlans:', e.message); return []; }
    },

    async getCreatorPlan(creatorId, planType) {
        if (!creatorId || !planType) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.from('subscription_plans').select('*').eq('creator_id', creatorId).eq('plan_type', planType).maybeSingle();
            if (error) { console.error('[DB] getCreatorPlan:', error.message); return null; }
            return data;
        } catch (e) { console.error('[DB] getCreatorPlan:', e.message); return null; }
    },

    async upsertPlan(plan) {
        if (!plan?.creator_id || !plan?.plan_type) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.from('subscription_plans').upsert(plan, { onConflict: 'creator_id,plan_type' }).select().maybeSingle();
            if (error) { console.error('[DB] upsertPlan:', error.message); return null; }
            return data || null;
        } catch (e) { console.error('[DB] upsertPlan:', e.message); return null; }
    },

    async updatePlan(planId, updates) {
        if (!planId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('subscription_plans').update(updates).eq('id', planId); return true; } catch (e) { return false; }
    },

    async deletePlan(planId) {
        if (!planId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('subscription_plans').delete().eq('id', planId); return true; } catch (e) { return false; }
    },

    async getPlanDuration(planType) {
        if (planType === 'weekly') return 7;
        if (planType === 'vip') return 2;
        return 30; // monthly default
    },

    async expireOldSubscriptions() {
        const client = getSb(); if (!client) return;
        try { await client.rpc('expire_old_subscriptions'); } catch (e) {
            // Fallback if RPC not available — only use 'status' column (subscription_status does not exist)
            try {
                await client.from('subscriptions').update({ status: 'expired' }).lt('expires_at', new Date().toISOString()).eq('status', 'approved');
            } catch (e2) {}
        }
    },

    // VIP
    async createVipVideo(video) {
        if (!video?.creator_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('vip_videos').insert(video).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getVipVideos(creatorId) {
        if (!creatorId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('vip_videos').select('*').eq('creator_id', creatorId).order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async getVipVideo(id) {
        if (!id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('vip_videos').select('*, creator:profiles!vip_videos_creator_id_fkey(*)').eq('id', id).maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async deleteVipVideo(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('vip_videos').delete().eq('id', id); return true; } catch (e) { return false; }
    },

    async createVipPurchase(p) {
        if (!p?.video_id || !p?.buyer_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('vip_purchases').upsert(p, { onConflict: 'video_id,buyer_id' }).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getVipPurchases(userId) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try {
            // Fetch purchases with video data (reliable explicit FK)
            const { data: purchases } = await client.from('vip_purchases')
                .select('*, video:vip_videos!video_id(*)')
                .eq('buyer_id', userId)
                .order('created_at', { ascending: false });
            return purchases || [];
        } catch (e) { return []; }
    },

    // Messages - FULLY CONNECTED, ROBUST ERROR HANDLING
    // Use two separate queries instead of .or() for reliability
    async getChatRooms(userId) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try {
            // Query where user is participant_1
            const { data: d1, error: e1 } = await client.from('chat_rooms').select('*').eq('participant_1', userId).order('last_message_at', { ascending: false });
            if (e1) console.error('[DB] getChatRooms p1:', e1.message);
            // Query where user is participant_2
            const { data: d2, error: e2 } = await client.from('chat_rooms').select('*').eq('participant_2', userId).order('last_message_at', { ascending: false });
            if (e2) console.error('[DB] getChatRooms p2:', e2.message);
            // Merge and sort by last_message_at desc
            const rooms = [...(d1 || []), ...(d2 || [])];
            rooms.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
            return rooms;
        } catch (e) { console.error('[DB] getChatRooms:', e.message); return []; }
    },

    async getOrCreateRoom(u1, u2) {
        if (!u1 || !u2) { console.error('[DB] getOrCreateRoom: missing u1 or u2'); return null; }
        const client = getSb(); if (!client) { console.error('[DB] getOrCreateRoom: no client'); return null; }
        try {
            // Check orientation 1: u1=p1, u2=p2
            const { data: r1, error: e1 } = await client.from('chat_rooms').select('*').eq('participant_1', u1).eq('participant_2', u2).maybeSingle();
            if (e1) console.error('[DB] getOrCreateRoom r1:', e1.message);
            if (r1) return r1;
            // Check orientation 2: u2=p1, u1=p2
            const { data: r2, error: e2 } = await client.from('chat_rooms').select('*').eq('participant_1', u2).eq('participant_2', u1).maybeSingle();
            if (e2) console.error('[DB] getOrCreateRoom r2:', e2.message);
            if (r2) return r2;
            // Create new room
            const { data, error } = await client.from('chat_rooms').insert({ participant_1: u1, participant_2: u2, last_message: 'Say hi!', last_message_at: new Date().toISOString() }).select().maybeSingle();
            if (error) { console.error('[DB] getOrCreateRoom insert:', error.message); return null; }
            console.log('[DB] Created new room:', data?.id);
            return data || null;
        } catch (e) { console.error('[DB] getOrCreateRoom:', e.message); return null; }
    },

    async getMessages(roomId, limit) {
        if (!roomId) return [];
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.from('messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(limit || 100);
            if (error) { console.error('[DB] getMessages:', error.message); return []; }
            return data || [];
        } catch (e) { console.error('[DB] getMessages:', e.message); return []; }
    },

    async countUnread(roomId, userId) {
        if (!roomId || !userId) return 0;
        const client = getSb(); if (!client) return 0;
        try {
            const { count, error } = await client.from('messages').select('*', { count: 'exact', head: true }).eq('room_id', roomId).eq('is_read', false).neq('sender_id', userId);
            if (error) { console.error('[DB] countUnread:', error.message); return 0; }
            return count || 0;
        } catch (e) { console.error('[DB] countUnread:', e.message); return 0; }
    },

    async countTotalUnread(userId) {
        if (!userId) return 0;
        const client = getSb(); if (!client) return 0;
        try {
            // Get all rooms for this user (two separate queries for reliability)
            const { data: d1 } = await client.from('chat_rooms').select('id').eq('participant_1', userId);
            const { data: d2 } = await client.from('chat_rooms').select('id').eq('participant_2', userId);
            const roomIds = [...(d1 || []), ...(d2 || [])].map(r => r.id);
            if (!roomIds.length) return 0;
            let total = 0;
            for (const rid of roomIds) {
                const { count } = await client.from('messages').select('*', { count: 'exact', head: true }).eq('room_id', rid).eq('is_read', false).neq('sender_id', userId);
                total += count || 0;
            }
            return total;
        } catch (e) { console.error('[DB] countTotalUnread:', e.message); return 0; }
    },

    async sendMessage(msg) {
        if (!msg?.room_id || !msg?.sender_id) { console.error('[DB] sendMessage: missing room_id or sender_id'); return null; }
        const client = getSb(); if (!client) { console.error('[DB] sendMessage: no client'); return null; }
        try {
            const { data, error } = await client.from('messages').insert(msg).select().maybeSingle();
            if (error) { console.error('[DB] sendMessage insert error:', error.message); return null; }
            // Update room last_message
            try {
                await client.from('chat_rooms').update({ last_message: msg.content || '\uD83D\uDCF7 Media', last_message_at: new Date().toISOString() }).eq('id', msg.room_id);
            } catch (e) {}
            return data || null;
        } catch (e) { console.error('[DB] sendMessage:', e.message); return null; }
    },

    async markRead(roomId, userId) {
        if (!roomId || !userId) return;
        const client = getSb(); if (!client) return;
        try {
            // Try RPC function first (bypasses RLS for this specific operation)
            try {
                await client.rpc('mark_messages_read', { p_room_id: roomId, p_user_id: userId });
                return;
            } catch (rpcErr) {
                // Fallback: direct update (requires messages_update RLS policy)
                const { error } = await client.from('messages').update({ is_read: true }).eq('room_id', roomId).neq('sender_id', userId);
                if (error) console.error('[DB] markRead:', error.message);
            }
        } catch (e) { console.error('[DB] markRead:', e.message); }
    },

    // Transactions
    async createTx(tx) {
        if (!tx) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('transactions').insert(tx).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getTxs(userId, limit) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('transactions').select('*').or(`from_user.eq.${userId},to_user.eq.${userId}`).order('created_at', { ascending: false }).limit(limit || 50); return data || []; } catch (e) { return []; }
    },

    // Payments
    async createPayment(p) {
        if (!p?.user_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('payments').insert(p).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getPayments(userId) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async getCreatorPayments(creatorId) {
        if (!creatorId) return [];
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('payments').select('*, user:profiles!payments_user_id_fkey(*)').eq('creator_id', creatorId).order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    // Notifications
    async createNotif(n) {
        if (!n?.user_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('notifications').insert(n).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async getNotifs(userId, unread) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try { let q = client.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }); if (unread) q = q.eq('is_read', false); const { data } = await q; return data || []; } catch (e) { return []; }
    },

    async markNotifRead(id) {
        if (!id) return;
        const client = getSb(); if (!client) return;
        try { await client.from('notifications').update({ is_read: true }).eq('id', id); } catch (e) {}
    },

    // Verified Badge
    async getVerifiedBadge(creatorId) {
        if (!creatorId) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('verified_badge_subs').select('*').eq('creator_id', creatorId).maybeSingle(); return data || null; } catch (e) { return null; }
    },

    async createBadgeRequest(r) {
        if (!r?.creator_id) return null;
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('verified_badge_subs').upsert(r, { onConflict: 'creator_id' }).select().maybeSingle(); return data || null; } catch (e) { return null; }
    },

    // Payment Settings - SAFE: only uses known columns
    async getPaymentSettings(creatorId) {
        if (!creatorId) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.from('creator_payment_settings').select('*').eq('creator_id', creatorId).maybeSingle();
            if (error) return null;
            return data;
        } catch (e) { return null; }
    },

    async updatePaymentSettings(creatorId, settings) {
        if (!creatorId || !settings) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data: existing } = await client.from('creator_payment_settings').select('id').eq('creator_id', creatorId).maybeSingle();
            if (existing) {
                const { data } = await client.from('creator_payment_settings').update(settings).eq('creator_id', creatorId).select().maybeSingle();
                return data || null;
            } else {
                const { data } = await client.from('creator_payment_settings').insert({ creator_id: creatorId, ...settings }).select().maybeSingle();
                return data || null;
            }
        } catch (e) { return null; }
    },

    // Site Settings
    async getSiteSettings() {
        const client = getSb(); if (!client) return null;
        try { const { data } = await client.from('site_settings').select('*').maybeSingle(); return data || null; } catch (e) { return null; }
    },

    // Owner Stats
    async getOwnerStats() {
        const client = getSb(); if (!client) return null;
        try {
            const [r1, r2, r3, r4, r5, r6] = await Promise.all([
                client.from('profiles').select('*', { count: 'exact', head: true }),
                client.from('profiles').select('*', { count: 'exact', head: true }).eq('type', 'creator'),
                client.from('posts').select('*', { count: 'exact', head: true }),
                client.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
                client.from('messages').select('*', { count: 'exact', head: true }),
                client.from('vip_videos').select('*', { count: 'exact', head: true }),
            ]);
            return { totalUsers: r1.count || 0, totalCreators: r2.count || 0, totalPosts: r3.count || 0, activeSubs: r4.count || 0, totalMessages: r5.count || 0, totalVipVideos: r6.count || 0 };
        } catch (e) { return { totalUsers: 0, totalCreators: 0, totalPosts: 0, activeSubs: 0, totalMessages: 0, totalVipVideos: 0 }; }
    },

    async getPendingBadges() {
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('verified_badge_subs').select('*, creator:profiles!verified_badge_subs_creator_id_fkey(*)').eq('status', 'pending').order('created_at', { ascending: false }); return data || []; } catch (e) { return []; }
    },

    async approveBadge(id, creatorId) {
        if (!id || !creatorId) return;
        const client = getSb(); if (!client) return;
        try {
            const now = new Date().toISOString();
            const expires = new Date(Date.now() + 30 * 864e5).toISOString();
            await client.from('verified_badge_subs').update({ status: 'active', activated_at: now, expires_at: expires, updated_at: now }).eq('id', id);
            await client.from('profiles').update({ verified: true }).eq('id', creatorId);
        } catch (e) {}
    },

    async rejectBadge(id, reason) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data: req } = await client.from('verified_badge_subs').select('creator_id').eq('id', id).maybeSingle();
            await client.from('verified_badge_subs').update({ status: 'rejected', rejected_reason: reason || '', updated_at: new Date().toISOString() }).eq('id', id);
            if (req?.creator_id) await client.from('profiles').update({ verified: false }).eq('id', req.creator_id);
            return true;
        } catch (e) { return false; }
    },

    async suspendBadge(id, creatorId) {
        if (!id || !creatorId) return false;
        const client = getSb(); if (!client) return false;
        try {
            await client.from('verified_badge_subs').update({ status: 'suspended', updated_at: new Date().toISOString() }).eq('id', id);
            await client.from('profiles').update({ verified: false }).eq('id', creatorId);
            return true;
        } catch (e) { return false; }
    },

    async reactivateBadge(id, creatorId) {
        if (!id || !creatorId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const now = new Date().toISOString();
            const expires = new Date(Date.now() + 30 * 864e5).toISOString();
            await client.from('verified_badge_subs').update({ status: 'active', activated_at: now, expires_at: expires, updated_at: now }).eq('id', id);
            await client.from('profiles').update({ verified: true }).eq('id', creatorId);
            return true;
        } catch (e) { return false; }
    },

    async deleteBadgeRequest(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data: req } = await client.from('verified_badge_subs').select('creator_id').eq('id', id).maybeSingle();
            if (req?.creator_id) await client.from('profiles').update({ verified: false }).eq('id', req.creator_id);
            await client.from('verified_badge_subs').delete().eq('id', id);
            return true;
        } catch (e) { return false; }
    },

    async getAllBadgeRequests(status) {
        const client = getSb(); if (!client) return [];
        try {
            let q = client.from('verified_badge_subs').select('*, creator:profiles!verified_badge_subs_creator_id_fkey(*)').order('created_at', { ascending: false });
            if (status && status !== 'all') q = q.eq('status', status);
            const { data } = await q;
            return data || [];
        } catch (e) { return []; }
    },

    async getActiveBadges() {
        const client = getSb(); if (!client) return [];
        try {
            const { data } = await client.from('verified_badge_subs').select('*, creator:profiles!verified_badge_subs_creator_id_fkey(*)').eq('status', 'active').order('expires_at', { ascending: true });
            return data || [];
        } catch (e) { return []; }
    },

    async getExpiredBadges() {
        const client = getSb(); if (!client) return [];
        try {
            const { data } = await client.from('verified_badge_subs').select('*, creator:profiles!verified_badge_subs_creator_id_fkey(*)').eq('status', 'expired').order('expires_at', { ascending: false });
            return data || [];
        } catch (e) { return []; }
    },

    async checkAndExpireBadges() {
        const client = getSb(); if (!client) return;
        try {
            await client.rpc('expire_verified_badges');
        } catch (e) {
            // RPC may not be available, fallback: direct update
            try {
                const { data: expired } = await client.from('verified_badge_subs').select('creator_id').eq('status', 'active').lt('expires_at', new Date().toISOString());
                if (expired?.length) {
                    const ids = expired.map(e => e.creator_id);
                    await client.from('verified_badge_subs').update({ status: 'expired' }).eq('status', 'active').lt('expires_at', new Date().toISOString());
                    for (const cid of ids) await client.from('profiles').update({ verified: false }).eq('id', cid);
                }
            } catch (e2) {}
        }
    },

    // Badge Price Management
    async getBadgePrice() {
        const client = getSb(); if (!client) return { usd: 8.00, ngn: 11200.00 };
        try {
            const { data } = await client.from('site_settings').select('badge_price_usd, badge_price_ngn').maybeSingle();
            return { usd: data?.badge_price_usd || 8.00, ngn: data?.badge_price_ngn || 11200.00 };
        } catch (e) { return { usd: 8.00, ngn: 11200.00 }; }
    },

    async updateBadgePrice(usd, ngn) {
        const client = getSb(); if (!client) return false;
        try {
            await client.from('site_settings').update({ badge_price_usd: usd, badge_price_ngn: ngn }).eq('id', 1);
            return true;
        } catch (e) { return false; }
    },

    // Payment Management (creator actions)
    async updatePaymentStatus(paymentId, status) {
        if (!paymentId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('payments').update({ status, updated_at: new Date().toISOString() }).eq('id', paymentId); return true; } catch (e) { return false; }
    },

    async deletePayment(paymentId) {
        if (!paymentId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('payments').delete().eq('id', paymentId); return true; } catch (e) { return false; }
    },

    async updateSubscriptionByQuery(query, updates) {
        if (!query || !updates) return false;
        const client = getSb(); if (!client) return false;
        try {
            let q = client.from('subscriptions').update(updates);
            if (query.subscriber_id) q = q.eq('subscriber_id', query.subscriber_id);
            if (query.creator_id) q = q.eq('creator_id', query.creator_id);
            await q;
            return true;
        } catch (e) { return false; }
    },

    subscribeToPayments(creatorId, cb) {
        if (!creatorId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel(`payments:${creatorId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payments', filter: `creator_id=eq.${creatorId}` }, cb).subscribe(); } catch (e) { return null; }
    },

    // Owner
    // Get all payments with fan and creator profile data (for Owner Dashboard)
    async getAllPayments(limit) {
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.rpc('get_all_payments', { p_limit: limit || 200 });
            if (error) { console.error('[DB] getAllPayments:', error.message); return []; }
            const parsed = typeof data === 'string' ? JSON.parse(data) : (data || []);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { console.error('[DB] getAllPayments:', e.message); return []; }
    },

    async getAllSubscriptions(limit) {
        const client = getSb(); if (!client) return [];
        try { const { data } = await client.from('subscriptions').select('*, subscriber:profiles!subscriptions_subscriber_id_fkey(*), creator:profiles!subscriptions_creator_id_fkey(*)').order('created_at', { ascending: false }).limit(limit || 100); return data || []; } catch (e) { return []; }
    },

    async getTotalRevenue() {
        const client = getSb(); if (!client) return 0;
        try {
            const { data } = await client.from('payments').select('amount').eq('status', 'approved');
            return (data || []).reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        } catch (e) { return 0; }
    },

    async getPostsByCreatorUsername(username, limit) {
        if (!username) return [];
        const client = getSb(); if (!client) return [];
        try {
            // Use ilike for partial match on username OR display_name
            const { data: creators } = await client.from('profiles')
                .select('id')
                .or(`username.ilike.%${username}%,display_name.ilike.%${username}%`)
                .eq('type', 'creator')
                .limit(10);
            if (!creators?.length) return [];
            const creatorIds = creators.map(c => c.id);
            const { data } = await client.from('posts')
                .select('*, creator:profiles!posts_creator_id_fkey(*)')
                .in('creator_id', creatorIds)
                .order('created_at', { ascending: false })
                .limit(limit || 50);
            return data || [];
        } catch (e) { console.error('[DB] getPostsByCreatorUsername:', e.message); return []; }
    },

    // Uses RPC boost_post_likes which updates posts.boosted_likes + profiles.likes_count
    async boostPost(postId, ownerId, likeCount) {
        if (!postId || !likeCount) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('boost_post_likes', {
                p_post_id: postId,
                p_boost_amount: likeCount
            });
            if (error) { console.error('[DB] boostPost RPC:', error.message); return false; }
            return data?.success === true;
        } catch (e) { console.error('[DB] boostPost:', e.message); return false; }
    },

    // Uses RPC reset_post_boost
    async resetPostBoostRpc(postId) {
        if (!postId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('reset_post_boost', {
                p_post_id: postId
            });
            if (error) { console.error('[DB] resetPostBoost RPC:', error.message); return false; }
            return data === true;
        } catch (e) { console.error('[DB] resetPostBoost:', e.message); return false; }
    },

    // ===================== ONLINE STATUS =====================
    // State cache to avoid redundant updates and reduce network calls
    _lastOnlineState: {},
    _onlineUpdateTimer: null,

    async updateOnlineStatus(userId, isOnline) {
        if (!userId) return false;
        // Only update if state actually changed (prevents redundant calls)
        const last = this._lastOnlineState[userId];
        if (last !== undefined && last === isOnline) return true; // No change, skip
        // Debounce: if an update is already pending, cancel it
        if (this._onlineUpdateTimer) { clearTimeout(this._onlineUpdateTimer); this._onlineUpdateTimer = null; }
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('update_user_status', {
                p_user_id: userId,
                p_is_online: isOnline
            });
            if (error) {
                // Silently fail on network errors (no console spam)
                if (error.message && error.message.includes('fetch')) return false;
                return false;
            }
            // Cache the successful state
            this._lastOnlineState[userId] = isOnline;
            return data === true;
        } catch (e) {
            // Silently fail — network errors are expected during disconnects
            return false;
        }
    },

    // Queue an offline update for when page closes (fires synchronously when possible)
    queueOfflineUpdate(userId) {
        if (!userId) return;
        // Update local cache immediately so we don't try again
        this._lastOnlineState[userId] = false;
        // Use sendBeacon for synchronous delivery on page close
        try {
            const client = getSb();
            if (client && navigator.sendBeacon) {
                const url = `${client.supabaseUrl}/rest/v1/rpc/update_user_status`;
                const body = JSON.stringify({ p_user_id: userId, p_is_online: false });
                const blob = new Blob([body], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            }
        } catch (e) { /* Silently fail */ }
    },

    async getUserStatus(userId) {
        if (!userId) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.rpc('get_user_status', {
                p_user_id: userId
            });
            if (error) { console.error('[DB] getUserStatus:', error.message); return null; }
            return data || null;
        } catch (e) { console.error('[DB] getUserStatus:', e.message); return null; }
    },

    async getUsersStatus(userIds) {
        if (!userIds?.length) return {};
        const client = getSb(); if (!client) return {};
        try {
            const idsStr = userIds.join(',');
            const { data, error } = await client.rpc('get_users_status', {
                p_user_ids: idsStr
            });
            if (error) { console.error('[DB] getUsersStatus:', error.message); return {}; }
            const list = typeof data === 'string' ? JSON.parse(data) : (data || []);
            const map = {};
            (Array.isArray(list) ? list : []).forEach(u => { if (u?.id) map[u.id] = u; });
            return map;
        } catch (e) { console.error('[DB] getUsersStatus:', e.message); return {}; }
    },

    async deleteUser(userId) {
        if (!userId) return false;
        const client = getSb(); if (!client) return false;
        try { await client.from('profiles').delete().eq('id', userId); return true; } catch (e) { return false; }
    },

    // Realtime
    subscribeToMessages(roomId, cb) {
        if (!roomId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel(`msg:${roomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, cb).subscribe(); } catch (e) { return null; }
    },

    subscribeToNotifs(userId, cb) {
        if (!userId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel(`notif:${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, cb).subscribe(); } catch (e) { return null; }
    },

    subscribeToPosts(cb) {
        if (typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel('posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, cb).subscribe(); } catch (e) { return null; }
    },

    subscribeToBadgeUpdates(creatorId, cb) {
        if (!creatorId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel(`badge:${creatorId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'verified_badge_subs', filter: `creator_id=eq.${creatorId}` }, cb).subscribe(); } catch (e) { return null; }
    },

    subscribeToAllBadgeUpdates(cb) {
        if (typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try { return client.channel('badges:all').on('postgres_changes', { event: '*', schema: 'public', table: 'verified_badge_subs' }, cb).subscribe(); } catch (e) { return null; }
    },

    // Realtime: subscribe to ALL payment changes (for Owner Dashboard)
    subscribeToAllPayments(cb) {
        if (typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try {
            return client.channel('payments:all')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, cb)
                .subscribe();
        } catch (e) { return null; }
    },

    // ===================== VIP SUBSCRIBERS MANAGEMENT =====================
    // All operations use PostgreSQL RPC with SECURITY DEFINER.
    // This bypasses ALL schema cache issues, RLS, and column errors.
    async getCreatorVipPurchases(creatorId) {
        if (!creatorId) return [];
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.rpc('get_creator_vip_purchases', {
                p_creator_id: creatorId
            });
            if (error) { console.error('[DB] getCreatorVipPurchases RPC:', error.message); return []; }
            const parsed = typeof data === 'string' ? JSON.parse(data) : (data || []);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { console.error('[DB] getCreatorVipPurchases:', e.message); return []; }
    },

    async approveVipPurchase(purchaseId) {
        if (!purchaseId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('approve_vip_purchase', { p_purchase_id: purchaseId });
            if (error) { console.error('[DB] approveVipPurchase:', error.message); return false; }
            return data === true;
        } catch (e) { console.error('[DB] approveVipPurchase:', e.message); return false; }
    },

    async declineVipPurchase(purchaseId, reason) {
        if (!purchaseId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('decline_vip_purchase', {
                p_purchase_id: purchaseId,
                p_reason: reason || ''
            });
            if (error) { console.error('[DB] declineVipPurchase:', error.message); return false; }
            return data === true;
        } catch (e) { console.error('[DB] declineVipPurchase:', e.message); return false; }
    },

    async disableVipAccess(purchaseId) {
        if (!purchaseId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('disable_vip_purchase', { p_purchase_id: purchaseId });
            if (error) { console.error('[DB] disableVipAccess:', error.message); return false; }
            return data === true;
        } catch (e) { console.error('[DB] disableVipAccess:', e.message); return false; }
    },

    async removeVipPurchase(purchaseId) {
        if (!purchaseId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { data, error } = await client.rpc('remove_vip_purchase', { p_purchase_id: purchaseId });
            if (error) { console.error('[DB] removeVipPurchase:', error.message); return false; }
            return data === true;
        } catch (e) { console.error('[DB] removeVipPurchase:', e.message); return false; }
    },

    async expireOldVipPurchases() {
        const client = getSb(); if (!client) return;
        try {
            await client.rpc('expire_vip_purchases');
        } catch (e) {
            // Fallback if RPC not available - update status only (avoid schema cache issues)
            try {
                await client.from('vip_purchases')
                    .update({ status: 'expired' })
                    .eq('status', 'approved')
                    .lt('expires_at', new Date().toISOString());
            } catch (e2) {}
        }
    },

    // ===================== NOTIFICATIONS =====================
    // Uses RPC function with SECURITY DEFINER to bypass RLS
    async createNotification(notification) {
        if (!notification?.user_id) return null;
        const client = getSb(); if (!client) return null;
        try {
            const { data, error } = await client.rpc('create_notification', {
                p_user_id: notification.user_id,
                p_type: notification.type || 'general',
                p_title: notification.title || '',
                p_body: notification.body || '',
                p_related_id: notification.related_id || '',
                p_related_type: notification.related_type || ''
            });
            if (error) {
                console.error('[DB] createNotification RPC ERROR:', error.message);
                return null;
            }
            return data ? { id: data } : null;
        } catch (e) { console.error('[DB] createNotification:', e.message); return null; }
    },

    async getNotifs(userId, limit) {
        if (!userId) return [];
        const client = getSb(); if (!client) return [];
        try {
            const { data, error } = await client.from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(limit || 50);
            if (error) { console.error('[DB] getNotifs:', error.message); return []; }
            return data || [];
        } catch (e) { console.error('[DB] getNotifs:', e.message); return []; }
    },

    async getUnreadNotifCount(userId) {
        if (!userId) return 0;
        const client = getSb(); if (!client) return 0;
        try {
            const { count, error } = await client.from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('is_read', false);
            if (error) { console.error('[DB] getUnreadNotifCount:', error.message); return 0; }
            return count || 0;
        } catch (e) { console.error('[DB] getUnreadNotifCount:', e.message); return 0; }
    },

    async markNotifRead(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { error } = await client.from('notifications').update({ is_read: true }).eq('id', id);
            if (error) {
                if (error.message && error.message.includes('schema cache')) {
                    console.warn('[DB] markNotifRead: schema cache, retrying');
                    const { error: e2 } = await client.from('notifications').update({ is_read: true }).eq('id', id);
                    if (e2) { console.error('[DB] markNotifRead retry:', e2.message); return false; }
                    return true;
                }
                console.error('[DB] markNotifRead:', error.message); return false;
            }
            return true;
        } catch (e) { console.error('[DB] markNotifRead:', e.message); return false; }
    },

    async markAllNotifsRead(userId) {
        if (!userId) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { error } = await client.from('notifications')
                .update({ is_read: true })
                .eq('user_id', userId)
                .eq('is_read', false);
            if (error) { console.error('[DB] markAllNotifsRead:', error.message); return false; }
            return true;
        } catch (e) { console.error('[DB] markAllNotifsRead:', e.message); return false; }
    },

    async deleteNotification(id) {
        if (!id) return false;
        const client = getSb(); if (!client) return false;
        try {
            const { error } = await client.from('notifications').delete().eq('id', id);
            if (error) { console.error('[DB] deleteNotification:', error.message); return false; }
            return true;
        } catch (e) { console.error('[DB] deleteNotification:', e.message); return false; }
    },

    subscribeToNotifs(userId, cb) {
        if (!userId || typeof cb !== 'function') return null;
        const client = getSb(); if (!client) return null;
        try {
            return client.channel(`notifs:${userId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, cb)
                .subscribe();
        } catch (e) { return null; }
    }
};

// ===================== STORAGE =====================
const Storage = {
    async uploadFile(bucket, userId, file, prefix) {
        if (!userId || !file) { console.warn('[Storage] Missing userId or file'); return null; }
        const client = getSb(); if (!client) { console.warn('[Storage] No client'); return null; }
        try {
            const name = file.name || 'file';
            const ext = name.split('.').pop() || 'jpg';
            const path = `${userId}/${Date.now()}_${prefix || 'file'}.${ext}`;
            console.log(`[Storage] Uploading to ${bucket}:`, path, 'size:', file.size);
            const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream' });
            if (error) { console.error(`[Storage] ${bucket} upload error:`, error.message); return null; }
            const url = client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
            console.log(`[Storage] ${bucket} uploaded:`, url);
            return url;
        } catch (e) { console.error(`[Storage] ${bucket} exception:`, e.message); return null; }
    },

    async uploadAvatar(userId, file) { return this.uploadFile('avatars', userId, file, 'avatar'); },
    async uploadCover(userId, file) { return this.uploadFile('covers', userId, file, 'cover'); },
    async uploadPhoto(userId, file) { return this.uploadFile('photos', userId, file, 'photo'); },
    async uploadVideo(userId, file) { return this.uploadFile('videos', userId, file, 'video'); },
    async uploadChatFile(userId, file) { return this.uploadFile('chat-files', userId, file, 'chat'); },
    async uploadBadgeScreenshot(userId, file) { return this.uploadFile('badge-screenshots', userId, file, 'badge'); },
    async uploadGiftCardImage(userId, file) { return this.uploadFile('giftcard-images', userId, file, 'gc'); }
};

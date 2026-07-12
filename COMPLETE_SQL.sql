-- ============================================================
-- ONLYFANS CLONE - COMPLETE SUPABASE MIGRATION
-- Production-ready SQL for Supabase PostgreSQL
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PROFILES TABLE (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    email TEXT UNIQUE,
    avatar TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    type TEXT DEFAULT 'fan' CHECK (type IN ('fan', 'creator', 'admin')),
    balance DECIMAL(10,2) DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    is_online BOOLEAN DEFAULT FALSE,
    monthly_price DECIMAL(10,2) DEFAULT 20,
    weekly_price DECIMAL(10,2) DEFAULT 5,
    vip_price DECIMAL(10,2) DEFAULT 50,
    subscribers_count INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    media_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    earnings_total DECIMAL(10,2) DEFAULT 0,
    tips_today DECIMAL(10,2) DEFAULT 0,
    profile_visible BOOLEAN DEFAULT TRUE,
    require_subscription BOOLEAN DEFAULT FALSE,
    allow_tips BOOLEAN DEFAULT TRUE,
    admin_password TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles(type);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- ============================================================
-- 2. POSTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    thumbnail_url TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    type TEXT DEFAULT 'image' CHECK (type IN ('image', 'video')),
    is_locked BOOLEAN DEFAULT FALSE,
    is_premium BOOLEAN DEFAULT FALSE,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_creator ON posts(creator_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

-- ============================================================
-- 3. POST LIKES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS post_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

-- ============================================================
-- 4. STORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    type TEXT DEFAULT 'image' CHECK (type IN ('image', 'video')),
    views_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_stories_creator ON stories(creator_id);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

-- ============================================================
-- 5. STORY VIEWS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS story_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(story_id, viewer_id)
);

-- ============================================================
-- 6. SUBSCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscriber_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('weekly', 'monthly', 'vip')),
    amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(subscriber_id, creator_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subs_creator ON subscriptions(creator_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

-- ============================================================
-- 7. VIP VIDEOS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS vip_videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    video_url TEXT NOT NULL,
    thumbnail_url TEXT DEFAULT '',
    price DECIMAL(10,2) NOT NULL DEFAULT 10,
    views_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vip_creator ON vip_videos(creator_id);

-- ============================================================
-- 8. VIP PURCHASES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS vip_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID NOT NULL REFERENCES vip_videos(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(video_id, buyer_id)
);

-- ============================================================
-- 9. CHAT ROOMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_1 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_2 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_message TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(participant_1, participant_2)
);

CREATE INDEX IF NOT EXISTS idx_chat_p1 ON chat_rooms(participant_1);
CREATE INDEX IF NOT EXISTS idx_chat_p2 ON chat_rooms(participant_2);

-- ============================================================
-- 10. MESSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT,
    media_url TEXT DEFAULT '',
    is_video BOOLEAN DEFAULT FALSE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- ============================================================
-- 11. TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user UUID REFERENCES profiles(id) ON DELETE SET NULL,
    to_user UUID REFERENCES profiles(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'subscription', 'tip', 'vip_purchase')),
    description TEXT DEFAULT '',
    payment_method TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_user);
CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_user);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

-- ============================================================
-- 12. PAYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_type TEXT NOT NULL,
    method TEXT NOT NULL,
    gc_type TEXT,
    gc_value TEXT,
    gc_code TEXT,
    gc_country TEXT,
    crypto_txid TEXT,
    crypto_amount TEXT,
    crypto_network TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_creator ON payments(creator_id);

-- ============================================================
-- 13. NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'message', 'subscription', 'tip', 'follow', 'system')),
    title TEXT NOT NULL,
    body TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);

-- ============================================================
-- 14. VERIFIED BADGE SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS verified_badge_subs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) DEFAULT 7.00,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired')),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(creator_id)
);

-- ============================================================
-- 15. CREATOR PAYMENT SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_payment_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    btc_enabled BOOLEAN DEFAULT FALSE,
    btc_address TEXT DEFAULT '',
    usdt_enabled BOOLEAN DEFAULT FALSE,
    usdt_address TEXT DEFAULT '',
    usdt_network TEXT DEFAULT 'TRC20',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(creator_id)
);

-- ============================================================
-- 16. SITE SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    site_name TEXT DEFAULT 'OnlyFans',
    allow_registration BOOLEAN DEFAULT TRUE,
    default_creator_price DECIMAL(10,2) DEFAULT 20,
    platform_fee_percent DECIMAL(5,2) DEFAULT 20,
    min_withdrawal DECIMAL(10,2) DEFAULT 20,
    min_deposit DECIMAL(10,2) DEFAULT 5,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_posts_updated BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_creator_payment_settings_updated BEFORE UPDATE ON creator_payment_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$ BEGIN
    INSERT INTO public.profiles (id, username, display_name, email, type, created_at)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1) || '_' || substr(NEW.id::text, 1, 8)), COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email, COALESCE(NEW.raw_user_meta_data->>'type', 'fan'), NOW())
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_auth_user_created ON auth.users;
CREATE TRIGGER tr_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update counters
CREATE OR REPLACE FUNCTION update_post_counts()
RETURNS TRIGGER AS $$ BEGIN
    UPDATE profiles SET posts_count = (SELECT COUNT(*) FROM posts WHERE creator_id = COALESCE(NEW.creator_id, OLD.creator_id)), media_count = (SELECT COUNT(*) FROM posts WHERE creator_id = COALESCE(NEW.creator_id, OLD.creator_id) AND type = 'video') WHERE id = COALESCE(NEW.creator_id, OLD.creator_id);
    RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_posts_count ON posts;
CREATE TRIGGER tr_posts_count AFTER INSERT OR DELETE ON posts FOR EACH ROW EXECUTE FUNCTION update_post_counts();

CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS TRIGGER AS $$ BEGIN
    IF TG_OP = 'INSERT' THEN UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id; RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id; RETURN OLD;
    END IF; RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_post_likes ON post_likes;
CREATE TRIGGER tr_post_likes AFTER INSERT OR DELETE ON post_likes FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

CREATE OR REPLACE FUNCTION update_sub_counts()
RETURNS TRIGGER AS $$ BEGIN
    UPDATE profiles SET subscribers_count = (SELECT COUNT(*) FROM subscriptions WHERE creator_id = COALESCE(NEW.creator_id, OLD.creator_id) AND status = 'approved' AND (expires_at IS NULL OR expires_at > NOW())) WHERE id = COALESCE(NEW.creator_id, OLD.creator_id);
    RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_subs_count ON subscriptions;
CREATE TRIGGER tr_subs_count AFTER INSERT OR UPDATE OF status ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_sub_counts();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('covers', 'covers', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('photos', 'photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-files', 'chat-files', true) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE posts;
ALTER PUBLICATION supabase_realtime ADD TABLE post_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

SELECT 'Migration completed!' AS status;
-- ============================================================
-- ONLYFANS CLONE - ROW LEVEL SECURITY POLICIES
-- NO INFINITE RECURSION - All policies use direct auth.uid() checks
-- Run this AFTER migration.sql
-- ============================================================

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vip_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_badge_subs ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for clean re-run
DO $$ BEGIN
    -- Drop all existing policies
    DROP POLICY IF EXISTS "profiles_select" ON profiles;
    DROP POLICY IF EXISTS "profiles_insert" ON profiles;
    DROP POLICY IF EXISTS "profiles_update" ON profiles;
    DROP POLICY IF EXISTS "posts_select" ON posts;
    DROP POLICY IF EXISTS "posts_insert" ON posts;
    DROP POLICY IF EXISTS "posts_update" ON posts;
    DROP POLICY IF EXISTS "posts_delete" ON posts;
    DROP POLICY IF EXISTS "post_likes_select" ON post_likes;
    DROP POLICY IF EXISTS "post_likes_insert" ON post_likes;
    DROP POLICY IF EXISTS "post_likes_delete" ON post_likes;
    DROP POLICY IF EXISTS "stories_select" ON stories;
    DROP POLICY IF EXISTS "stories_insert" ON stories;
    DROP POLICY IF EXISTS "story_views_select" ON story_views;
    DROP POLICY IF EXISTS "story_views_insert" ON story_views;
    DROP POLICY IF EXISTS "subs_select" ON subscriptions;
    DROP POLICY IF EXISTS "subs_insert" ON subscriptions;
    DROP POLICY IF EXISTS "subs_update" ON subscriptions;
    DROP POLICY IF EXISTS "vip_videos_select" ON vip_videos;
    DROP POLICY IF EXISTS "vip_videos_insert" ON vip_videos;
    DROP POLICY IF EXISTS "vip_purchases_select" ON vip_purchases;
    DROP POLICY IF EXISTS "vip_purchases_insert" ON vip_purchases;
    DROP POLICY IF EXISTS "chat_rooms_select" ON chat_rooms;
    DROP POLICY IF EXISTS "chat_rooms_insert" ON chat_rooms;
    DROP POLICY IF EXISTS "chat_rooms_update" ON chat_rooms;
    DROP POLICY IF EXISTS "messages_select" ON messages;
    DROP POLICY IF EXISTS "messages_insert" ON messages;
    DROP POLICY IF EXISTS "tx_select" ON transactions;
    DROP POLICY IF EXISTS "tx_insert" ON transactions;
    DROP POLICY IF EXISTS "payments_select" ON payments;
    DROP POLICY IF EXISTS "payments_insert" ON payments;
    DROP POLICY IF EXISTS "notifs_select" ON notifications;
    DROP POLICY IF EXISTS "notifs_insert" ON notifications;
    DROP POLICY IF EXISTS "notifs_update" ON notifications;
    DROP POLICY IF EXISTS "badge_select" ON verified_badge_subs;
    DROP POLICY IF EXISTS "badge_insert" ON verified_badge_subs;
    DROP POLICY IF EXISTS "badge_update" ON verified_badge_subs;
    DROP POLICY IF EXISTS "creator_pay_select" ON creator_payment_settings;
    DROP POLICY IF EXISTS "creator_pay_insert" ON creator_payment_settings;
    DROP POLICY IF EXISTS "creator_pay_update" ON creator_payment_settings;
    DROP POLICY IF EXISTS "site_select" ON site_settings;
    DROP POLICY IF EXISTS "site_update" ON site_settings;
END $$;

-- PROFILES: public read, own write
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- POSTS: public read, own insert/update/delete
CREATE POLICY "posts_select" ON posts FOR SELECT USING (true);
CREATE POLICY "posts_insert" ON posts FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "posts_update" ON posts FOR UPDATE USING (auth.uid() = creator_id);
CREATE POLICY "posts_delete" ON posts FOR DELETE USING (auth.uid() = creator_id);

-- POST LIKES
CREATE POLICY "post_likes_select" ON post_likes FOR SELECT USING (true);
CREATE POLICY "post_likes_insert" ON post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "post_likes_delete" ON post_likes FOR DELETE USING (auth.uid() = user_id);

-- STORIES
CREATE POLICY "stories_select" ON stories FOR SELECT USING (expires_at > NOW());
CREATE POLICY "stories_insert" ON stories FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- STORY VIEWS
CREATE POLICY "story_views_select" ON story_views FOR SELECT USING (true);
CREATE POLICY "story_views_insert" ON story_views FOR INSERT WITH CHECK (auth.uid() = viewer_id);

-- SUBSCRIPTIONS
CREATE POLICY "subs_select" ON subscriptions FOR SELECT USING (auth.uid() = subscriber_id OR auth.uid() = creator_id);
CREATE POLICY "subs_insert" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = subscriber_id);
CREATE POLICY "subs_update" ON subscriptions FOR UPDATE USING (auth.uid() = creator_id OR auth.uid() = subscriber_id);

-- VIP VIDEOS
CREATE POLICY "vip_videos_select" ON vip_videos FOR SELECT USING (true);
CREATE POLICY "vip_videos_insert" ON vip_videos FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- VIP PURCHASES
CREATE POLICY "vip_purchases_select" ON vip_purchases FOR SELECT USING (auth.uid() = buyer_id);
CREATE POLICY "vip_purchases_insert" ON vip_purchases FOR INSERT WITH CHECK (auth.uid() = buyer_id);

-- CHAT ROOMS
CREATE POLICY "chat_rooms_select" ON chat_rooms FOR SELECT USING (auth.uid() = participant_1 OR auth.uid() = participant_2);
CREATE POLICY "chat_rooms_insert" ON chat_rooms FOR INSERT WITH CHECK (auth.uid() = participant_1 OR auth.uid() = participant_2);
CREATE POLICY "chat_rooms_update" ON chat_rooms FOR UPDATE USING (auth.uid() = participant_1 OR auth.uid() = participant_2);

-- MESSAGES
CREATE POLICY "messages_select" ON messages FOR SELECT USING (EXISTS (SELECT 1 FROM chat_rooms cr WHERE cr.id = messages.room_id AND (cr.participant_1 = auth.uid() OR cr.participant_2 = auth.uid())));
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id AND EXISTS (SELECT 1 FROM chat_rooms cr WHERE cr.id = messages.room_id AND (cr.participant_1 = auth.uid() OR cr.participant_2 = auth.uid())));

-- TRANSACTIONS
CREATE POLICY "tx_select" ON transactions FOR SELECT USING (auth.uid() = from_user OR auth.uid() = to_user);
CREATE POLICY "tx_insert" ON transactions FOR INSERT WITH CHECK (auth.uid() = from_user OR auth.uid() = to_user);

-- PAYMENTS
CREATE POLICY "payments_select" ON payments FOR SELECT USING (auth.uid() = user_id OR auth.uid() = creator_id);
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- NOTIFICATIONS
CREATE POLICY "notifs_select" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_insert" ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifs_update" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- VERIFIED BADGE
CREATE POLICY "badge_select" ON verified_badge_subs FOR SELECT USING (auth.uid() = creator_id);
CREATE POLICY "badge_insert" ON verified_badge_subs FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "badge_update" ON verified_badge_subs FOR UPDATE USING (auth.uid() = creator_id);

-- CREATOR PAYMENT SETTINGS
CREATE POLICY "creator_pay_select" ON creator_payment_settings FOR SELECT USING (true);
CREATE POLICY "creator_pay_insert" ON creator_payment_settings FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "creator_pay_update" ON creator_payment_settings FOR UPDATE USING (auth.uid() = creator_id);

-- SITE SETTINGS
CREATE POLICY "site_select" ON site_settings FOR SELECT USING (true);
CREATE POLICY "site_update" ON site_settings FOR UPDATE USING (auth.uid() IS NOT NULL);

SELECT 'RLS policies applied successfully!' AS status;
-- ============================================================
-- ONLYFANS CLONE - STORAGE POLICIES
-- Run this AFTER migration.sql and rls_policies.sql
-- Compatible with latest Supabase (handles permission constraints)
-- ============================================================

-- Step 1: Take ownership of storage.objects so we can manage policies
DO $$
BEGIN
    EXECUTE format('ALTER TABLE storage.objects OWNER TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not change ownership of storage.objects: %', SQLERRM;
END $$;

-- Step 2: Grant full access to required roles
DO $$
BEGIN
    GRANT ALL ON TABLE storage.objects TO authenticated, anon, service_role;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not grant on storage.objects: %', SQLERRM;
END $$;

-- Step 3: Enable RLS on storage.objects (idempotent)
DO $$
BEGIN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not enable RLS on storage.objects: %', SQLERRM;
END $$;

-- Step 4: Drop existing policies safely
DO $$
BEGIN
    DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
    DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
    DROP POLICY IF EXISTS "covers_select" ON storage.objects;
    DROP POLICY IF EXISTS "covers_insert" ON storage.objects;
    DROP POLICY IF EXISTS "covers_delete" ON storage.objects;
    DROP POLICY IF EXISTS "photos_select" ON storage.objects;
    DROP POLICY IF EXISTS "photos_insert" ON storage.objects;
    DROP POLICY IF EXISTS "photos_delete" ON storage.objects;
    DROP POLICY IF EXISTS "videos_select" ON storage.objects;
    DROP POLICY IF EXISTS "videos_insert" ON storage.objects;
    DROP POLICY IF EXISTS "videos_delete" ON storage.objects;
    DROP POLICY IF EXISTS "chat_select" ON storage.objects;
    DROP POLICY IF EXISTS "chat_insert" ON storage.objects;
    DROP POLICY IF EXISTS "chat_delete" ON storage.objects;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not drop some policies: %', SQLERRM;
END $$;

-- Step 5: Create policies using SECURITY DEFINER function approach
-- This bypasses the ownership issue by running with elevated privileges

CREATE OR REPLACE FUNCTION public.create_storage_policies()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
    result TEXT := '';
BEGIN
    -- AVATARS
    BEGIN
        CREATE POLICY "avatars_select" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
        result := result || 'avatars_select OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'avatars_select FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "avatars_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'avatars_insert OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'avatars_insert FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "avatars_delete" ON storage.objects FOR DELETE USING (bucket_id = 'avatars' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'avatars_delete OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'avatars_delete FAIL: ' || SQLERRM || '. '; END;

    -- COVERS
    BEGIN
        CREATE POLICY "covers_select" ON storage.objects FOR SELECT USING (bucket_id = 'covers');
        result := result || 'covers_select OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'covers_select FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "covers_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'covers' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'covers_insert OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'covers_insert FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "covers_delete" ON storage.objects FOR DELETE USING (bucket_id = 'covers' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'covers_delete OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'covers_delete FAIL: ' || SQLERRM || '. '; END;

    -- PHOTOS
    BEGIN
        CREATE POLICY "photos_select" ON storage.objects FOR SELECT USING (bucket_id = 'photos');
        result := result || 'photos_select OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'photos_select FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "photos_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'photos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'photos_insert OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'photos_insert FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "photos_delete" ON storage.objects FOR DELETE USING (bucket_id = 'photos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'photos_delete OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'photos_delete FAIL: ' || SQLERRM || '. '; END;

    -- VIDEOS
    BEGIN
        CREATE POLICY "videos_select" ON storage.objects FOR SELECT USING (bucket_id = 'videos');
        result := result || 'videos_select OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'videos_select FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "videos_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'videos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'videos_insert OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'videos_insert FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "videos_delete" ON storage.objects FOR DELETE USING (bucket_id = 'videos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'videos_delete OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'videos_delete FAIL: ' || SQLERRM || '. '; END;

    -- CHAT FILES
    BEGIN
        CREATE POLICY "chat_select" ON storage.objects FOR SELECT USING (bucket_id = 'chat-files' AND auth.uid() IS NOT NULL);
        result := result || 'chat_select OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'chat_select FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "chat_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-files' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'chat_insert OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'chat_insert FAIL: ' || SQLERRM || '. '; END;

    BEGIN
        CREATE POLICY "chat_delete" ON storage.objects FOR DELETE USING (bucket_id = 'chat-files' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text);
        result := result || 'chat_delete OK. ';
    EXCEPTION WHEN OTHERS THEN result := result || 'chat_delete FAIL: ' || SQLERRM || '. '; END;

    RETURN result;
END;
$$;

-- Execute the function to create all policies
SELECT public.create_storage_policies() AS policy_status;

-- Clean up: drop the helper function after use
DROP FUNCTION IF EXISTS public.create_storage_policies();

SELECT 'Storage policies setup complete!' AS status;
-- ============================================================
-- ONLYFANS CLONE - OWNER DASHBOARD UPDATE
-- Run this AFTER the 3 main SQL files
-- Adds: revenue tracking, post boosts, subscription monitoring
-- ============================================================

-- 1. Add is_boosted flag to posts + admin_password for creators
DO $$ BEGIN
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_boosted BOOLEAN DEFAULT FALSE;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS boost_count INTEGER DEFAULT 0;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not add boost columns: %', SQLERRM;
END $$;

DO $$ BEGIN
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS admin_password TEXT DEFAULT '';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not add admin_password: %', SQLERRM;
END $$;

-- 1b. Add QR code URLs to creator_payment_settings
DO $$ BEGIN
    ALTER TABLE creator_payment_settings ADD COLUMN IF NOT EXISTS btc_qr_url TEXT DEFAULT '';
    ALTER TABLE creator_payment_settings ADD COLUMN IF NOT EXISTS usdt_qr_url TEXT DEFAULT '';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not add QR columns: %', SQLERRM;
END $$;

-- 2. Create post_boosts table (tracks owner-added likes)
CREATE TABLE IF NOT EXISTS post_boosts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL,
    likes_added INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RLS for post_boosts
ALTER TABLE post_boosts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    DROP POLICY IF EXISTS "post_boosts_select" ON post_boosts;
    DROP POLICY IF EXISTS "post_boosts_insert" ON post_boosts;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "post_boosts_select" ON post_boosts FOR SELECT USING (true);
CREATE POLICY "post_boosts_insert" ON post_boosts FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 4. Create owner_transactions view (all payments for monitoring)
CREATE OR REPLACE VIEW owner_payments_view AS
SELECT 
    p.*,
    u.username as user_username,
    u.display_name as user_display_name,
    u.avatar as user_avatar,
    c.username as creator_username,
    c.display_name as creator_display_name
FROM payments p
LEFT JOIN profiles u ON p.user_id = u.id
LEFT JOIN profiles c ON p.creator_id = c.id
ORDER BY p.created_at DESC;

-- 5. Create owner_subscriptions view
CREATE OR REPLACE VIEW owner_subscriptions_view AS
SELECT 
    s.*,
    sub.username as subscriber_username,
    sub.display_name as subscriber_display_name,
    sub.avatar as subscriber_avatar,
    cr.username as creator_username,
    cr.display_name as creator_display_name
FROM subscriptions s
LEFT JOIN profiles sub ON s.subscriber_id = sub.id
LEFT JOIN profiles cr ON s.creator_id = cr.id
ORDER BY s.created_at DESC;

-- 6. Enable realtime for post_boosts
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE post_boosts;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: Could not add post_boosts to realtime: %', SQLERRM;
END $$;

SELECT 'Owner dashboard update complete!' AS status;
-- ============================================================
-- ONLYFANS CLONE - PAYMENT & SUBSCRIPTION SYSTEM UPDATE
-- Run this in Supabase SQL Editor AFTER the main migration
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ============================================================

-- 1. Add subscription_status to subscriptions (for disable/enable)
DO $$ BEGIN
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'disabled', 'pending'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: subscription_status: %', SQLERRM;
END $$;

-- 2. Add expires_at if missing
DO $$ BEGIN
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: expires_at: %', SQLERRM;
END $$;

-- 3. Enable realtime for payments (instant creator notifications)
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: payments realtime: %', SQLERRM;
END $$;

-- 4. Enable realtime for subscriptions
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Note: subscriptions realtime: %', SQLERRM;
END $$;

-- 5. RLS for payments - ensure creators can see payments sent to them
DO $$ BEGIN
    DROP POLICY IF EXISTS "payments_creator_select" ON payments;
END $$;
CREATE POLICY "payments_creator_select" ON payments FOR SELECT USING (auth.uid() = user_id OR auth.uid() = creator_id);

-- 6. Function to auto-create subscription on payment approval
CREATE OR REPLACE FUNCTION public.approve_payment_and_subscribe()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        INSERT INTO public.subscriptions (subscriber_id, creator_id, plan_type, amount, status, expires_at, subscription_status)
        VALUES (NEW.user_id, NEW.creator_id, NEW.payment_type, NEW.amount, 'approved', NOW() + INTERVAL '30 days', 'active')
        ON CONFLICT (subscriber_id, creator_id)
        DO UPDATE SET
            status = 'approved',
            expires_at = NOW() + INTERVAL '30 days',
            subscription_status = 'active',
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Trigger on payments table
DROP TRIGGER IF EXISTS tr_payment_approved ON payments;
CREATE TRIGGER tr_payment_approved
    AFTER UPDATE OF status ON payments
    FOR EACH ROW
    WHEN (NEW.status = 'approved' AND OLD.status = 'pending')
    EXECUTE FUNCTION public.approve_payment_and_subscribe();

-- 8. Helper function: Disable expired subscriptions
CREATE OR REPLACE FUNCTION public.disable_expired_subscriptions()
RETURNS void AS $$
BEGIN
    UPDATE subscriptions
    SET subscription_status = 'disabled'
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND subscription_status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run it once now
SELECT public.disable_expired_subscriptions();

SELECT 'Payment & Subscription system update completed!' AS status;
-- ============================================================
-- SUBSCRIPTION PLANS SYSTEM UPDATE
-- Run this AFTER migration.sql and payment_system_update.sql
-- Safe to run multiple times
-- ============================================================

-- 1. CREATE subscription_plans TABLE
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan_type TEXT NOT NULL CHECK (plan_type IN ('weekly', 'monthly', 'vip')),
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(creator_id, plan_type)
);

CREATE INDEX IF NOT EXISTS idx_sub_plans_creator ON subscription_plans(creator_id);
CREATE INDEX IF NOT EXISTS idx_sub_plans_type ON subscription_plans(plan_type);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_sub_plans_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tr_sub_plans_updated ON subscription_plans;
CREATE TRIGGER tr_sub_plans_updated BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_sub_plans_updated_at();

-- 2. MIGRATE existing prices from profiles to subscription_plans
-- Insert default plans for every creator that doesn't have them
INSERT INTO subscription_plans (creator_id, plan_type, price, enabled, sort_order)
SELECT 
    p.id,
    plan.plan_type,
    CASE plan.plan_type
        WHEN 'monthly' THEN COALESCE(p.monthly_price, 20)
        WHEN 'weekly' THEN COALESCE(p.weekly_price, 5)
        WHEN 'vip' THEN COALESCE(p.vip_price, 50)
    END,
    TRUE,
    CASE plan.plan_type
        WHEN 'weekly' THEN 1
        WHEN 'monthly' THEN 2
        WHEN 'vip' THEN 3
    END
FROM profiles p
CROSS JOIN (VALUES ('weekly'), ('monthly'), ('vip')) AS plan(plan_type)
WHERE p.type = 'creator'
ON CONFLICT (creator_id, plan_type) DO NOTHING;

-- 3. RLS POLICIES FOR subscription_plans
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_plans_select" ON subscription_plans;
DROP POLICY IF EXISTS "sub_plans_insert" ON subscription_plans;
DROP POLICY IF EXISTS "sub_plans_update" ON subscription_plans;
DROP POLICY IF EXISTS "sub_plans_delete" ON subscription_plans;

-- Public can see enabled plans
CREATE POLICY "sub_plans_select" ON subscription_plans FOR SELECT USING (enabled = TRUE OR creator_id = auth.uid());
-- Creators can manage their own plans
CREATE POLICY "sub_plans_insert" ON subscription_plans FOR INSERT WITH CHECK (creator_id = auth.uid());
CREATE POLICY "sub_plans_update" ON subscription_plans FOR UPDATE USING (creator_id = auth.uid());
CREATE POLICY "sub_plans_delete" ON subscription_plans FOR DELETE USING (creator_id = auth.uid());

-- 4. REALTIME
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE subscription_plans;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Realtime already added: %', SQLERRM;
END $$;

-- 5. HELPER FUNCTION: Get plan duration in days
CREATE OR REPLACE FUNCTION get_plan_duration(p_plan_type TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN CASE p_plan_type
        WHEN 'weekly' THEN 7
        WHEN 'monthly' THEN 30
        WHEN 'vip' THEN 2
        ELSE 30
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6. HELPER FUNCTION: Calculate expiry date based on plan type
CREATE OR REPLACE FUNCTION calculate_subscription_expiry(p_plan_type TEXT)
RETURNS TIMESTAMPTZ AS $$
BEGIN
    RETURN NOW() + (get_plan_duration(p_plan_type) || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 7. UPDATE the payment approval trigger to use plan-based expiry
DROP TRIGGER IF EXISTS tr_payment_approved ON payments;
DROP FUNCTION IF EXISTS approve_payment_and_subscribe();

CREATE OR REPLACE FUNCTION approve_payment_and_subscribe()
RETURNS TRIGGER AS $$
DECLARE
    v_plan_type TEXT;
    v_duration_days INTEGER;
BEGIN
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        v_plan_type := COALESCE(NEW.payment_type, 'monthly');
        v_duration_days := get_plan_duration(v_plan_type);
        
        INSERT INTO public.subscriptions (subscriber_id, creator_id, plan_type, amount, status, expires_at, subscription_status)
        VALUES (NEW.user_id, NEW.creator_id, v_plan_type, NEW.amount, 'approved', NOW() + (v_duration_days || ' days')::INTERVAL, 'active')
        ON CONFLICT (subscriber_id, creator_id)
        DO UPDATE SET
            status = 'approved',
            plan_type = v_plan_type,
            amount = NEW.amount,
            expires_at = NOW() + (v_duration_days || ' days')::INTERVAL,
            subscription_status = 'active',
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_payment_approved
    AFTER UPDATE OF status ON payments
    FOR EACH ROW
    WHEN (NEW.status = 'approved' AND OLD.status = 'pending')
    EXECUTE FUNCTION approve_payment_and_subscribe();

-- 8. AUTO-EXPIRY FUNCTION (runs periodically)
CREATE OR REPLACE FUNCTION expire_old_subscriptions()
RETURNS void AS $$
BEGIN
    -- Mark expired subscriptions
    UPDATE subscriptions
    SET subscription_status = 'disabled',
        status = 'expired'
    WHERE expires_at IS NOT NULL
      AND expires_at < NOW()
      AND status = 'approved'
      AND subscription_status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Subscription Plans system update completed!' AS status;
-- ============================================================
-- MESSAGING SYSTEM EMERGENCY FIX
-- Run this in Supabase SQL Editor
-- Fixes RLS policies, enables reliable message delivery
-- ============================================================

-- ============================================================
-- 1. FIX MESSAGES TABLE RLS POLICIES
-- Replace EXISTS subqueries with IN (SELECT...) for reliability
-- Add missing UPDATE policy for mark-as-read
-- ============================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_update" ON messages;

-- SELECT: Users can read messages in rooms they participate in
CREATE POLICY "messages_select" ON messages FOR SELECT USING (
    room_id IN (
        SELECT id FROM chat_rooms
        WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()
    )
);

-- INSERT: Sender must be current user AND participant in the room
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    room_id IN (
        SELECT id FROM chat_rooms
        WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()
    )
);

-- UPDATE: Participants can update messages (for mark-as-read)
CREATE POLICY "messages_update" ON messages FOR UPDATE USING (
    room_id IN (
        SELECT id FROM chat_rooms
        WHERE participant_1 = auth.uid() OR participant_2 = auth.uid()
    )
);

-- ============================================================
-- 2. FIX CHAT_ROOMS RLS POLICIES
-- Ensure both participants can always see the room
-- ============================================================

ALTER TABLE chat_rooms ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "chat_rooms_select" ON chat_rooms;
DROP POLICY IF EXISTS "chat_rooms_insert" ON chat_rooms;
DROP POLICY IF EXISTS "chat_rooms_update" ON chat_rooms;

-- SELECT: Both participants can see the room
CREATE POLICY "chat_rooms_select" ON chat_rooms FOR SELECT USING (
    auth.uid() = participant_1 OR auth.uid() = participant_2
);

-- INSERT: Either participant can create the room
CREATE POLICY "chat_rooms_insert" ON chat_rooms FOR INSERT WITH CHECK (
    auth.uid() = participant_1 OR auth.uid() = participant_2
);

-- UPDATE: Either participant can update the room (last_message, etc.)
CREATE POLICY "chat_rooms_update" ON chat_rooms FOR UPDATE USING (
    auth.uid() = participant_1 OR auth.uid() = participant_2
);

-- DELETE: Either participant can delete the room
CREATE POLICY "chat_rooms_delete" ON chat_rooms FOR DELETE USING (
    auth.uid() = participant_1 OR auth.uid() = participant_2
);

-- ============================================================
-- 3. ENSURE REALTIME IS ENABLED FOR MESSAGES
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_rooms;

-- ============================================================
-- 4. ADD HELPER FUNCTION: Get rooms for a user
-- This function bypasses RLS subquery issues
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_chat_rooms(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    participant_1 UUID,
    participant_2 UUID,
    last_message TEXT,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT cr.id, cr.participant_1, cr.participant_2, cr.last_message, cr.last_message_at, cr.created_at
    FROM chat_rooms cr
    WHERE cr.participant_1 = p_user_id OR cr.participant_2 = p_user_id
    ORDER BY cr.last_message_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. ADD HELPER FUNCTION: Get unread count for a room
-- ============================================================

CREATE OR REPLACE FUNCTION get_unread_count(p_room_id UUID, p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
    v_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM messages m
    WHERE m.room_id = p_room_id
      AND m.is_read = FALSE
      AND m.sender_id != p_user_id;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. ADD HELPER FUNCTION: Mark messages as read
-- ============================================================

CREATE OR REPLACE FUNCTION mark_messages_read(p_room_id UUID, p_user_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE messages
    SET is_read = TRUE
    WHERE room_id = p_room_id
      AND sender_id != p_user_id
      AND is_read = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Messaging system fix applied successfully!' AS status;
-- ============================================================
-- POST LIKES & OWNER BOOST SYSTEM UPDATE
-- Run this AFTER migration.sql, rls_policies.sql, storage_policies.sql
-- ============================================================

-- ============================================================
-- 1. ADD boosted_likes COLUMN TO posts TABLE
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='boosted_likes') THEN
        ALTER TABLE posts ADD COLUMN boosted_likes INTEGER DEFAULT 0;
    END IF;
END $$;

-- ============================================================
-- 2. CREATE boost_history TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS boost_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    previous_count INTEGER NOT NULL DEFAULT 0,
    likes_added INTEGER NOT NULL DEFAULT 0,
    new_total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boost_history_post ON boost_history(post_id);
CREATE INDEX IF NOT EXISTS idx_boost_history_owner ON boost_history(owner_id);
CREATE INDEX IF NOT EXISTS idx_boost_history_created ON boost_history(created_at DESC);

-- ============================================================
-- 3. RLS POLICIES FOR boost_history
-- ============================================================

ALTER TABLE boost_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boost_history_select" ON boost_history;
DROP POLICY IF EXISTS "boost_history_insert" ON boost_history;
DROP POLICY IF EXISTS "boost_history_delete" ON boost_history;

-- Only authenticated users can view boost history (owner checks in app)
CREATE POLICY "boost_history_select" ON boost_history FOR SELECT TO authenticated USING (true);

-- Only authenticated users can insert (owner checks in app)
CREATE POLICY "boost_history_insert" ON boost_history FOR INSERT TO authenticated WITH CHECK (true);

-- Only authenticated users can delete (owner checks in app)
CREATE POLICY "boost_history_delete" ON boost_history FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 4. REALTIME FOR post_likes AND boost_history
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE post_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE boost_history;

-- ============================================================
-- 5. HELPER FUNCTION: Get total like count for a post (real + boosted)
-- ============================================================

CREATE OR REPLACE FUNCTION get_post_like_count(p_post_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_real_likes INTEGER;
    v_boosted INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_real_likes FROM post_likes WHERE post_id = p_post_id;
    SELECT COALESCE(boosted_likes, 0) INTO v_boosted FROM posts WHERE id = p_post_id;
    RETURN v_real_likes + v_boosted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. HELPER FUNCTION: Get creator like analytics
-- ============================================================

CREATE OR REPLACE FUNCTION get_creator_like_analytics(p_creator_id UUID)
RETURNS TABLE (
    total_likes BIGINT,
    total_boosted BIGINT,
    most_liked_post_id UUID,
    most_liked_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM((SELECT COUNT(*) FROM post_likes WHERE post_id = p.id)), 0)::BIGINT as total_likes,
        COALESCE(SUM(p.boosted_likes), 0)::BIGINT as total_boosted,
        (SELECT p2.id FROM posts p2 WHERE p2.creator_id = p_creator_id ORDER BY ((SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p2.id) + p2.boosted_likes) DESC LIMIT 1) as most_liked_post_id,
        (SELECT COALESCE((SELECT COUNT(*) FROM post_likes WHERE post_id = (SELECT p3.id FROM posts p3 WHERE p3.creator_id = p_creator_id ORDER BY ((SELECT COUNT(*) FROM post_likes pl2 WHERE pl2.post_id = p3.id) + p3.boosted_likes) DESC LIMIT 1)), 0) + COALESCE((SELECT boosted_likes FROM posts WHERE id = (SELECT p4.id FROM posts p4 WHERE p4.creator_id = p_creator_id ORDER BY ((SELECT COUNT(*) FROM post_likes pl3 WHERE pl3.post_id = p4.id) + p4.boosted_likes) DESC LIMIT 1)), 0))::BIGINT as most_liked_count
    FROM posts p
    WHERE p.creator_id = p_creator_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Likes & Boost system update completed!' AS status;
-- ============================================================
-- VERIFIED BLUE BADGE SUBSCRIPTION SYSTEM UPDATE
-- Run this AFTER migration.sql, rls_policies.sql, storage_policies.sql
-- ============================================================

-- ============================================================
-- 1. ADD COLUMNS TO VERIFIED_BADGE_SUBS TABLE
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='full_name') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN full_name TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='username') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN username TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='email') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN email TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='payment_reference') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN payment_reference TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='screenshot_url') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN screenshot_url TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='note') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN note TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='bank_name') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN bank_name TEXT DEFAULT 'PalmPay';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='account_name') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN account_name TEXT DEFAULT 'Palm Pay';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='account_number') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN account_number TEXT DEFAULT '8061762411';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='amount_paid') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN amount_paid TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='price_usd') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN price_usd DECIMAL(10,2) DEFAULT 8.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='price_ngn') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN price_ngn DECIMAL(10,2) DEFAULT 11200.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='activated_at') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN activated_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='rejected_reason') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN rejected_reason TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='date_of_payment') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN date_of_payment TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='verified_badge_subs' AND column_name='updated_at') THEN
        ALTER TABLE verified_badge_subs ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Update status check constraint
ALTER TABLE verified_badge_subs DROP CONSTRAINT IF EXISTS verified_badge_subs_status_check;
ALTER TABLE verified_badge_subs ADD CONSTRAINT verified_badge_subs_status_check CHECK (status IN ('pending', 'active', 'expired', 'rejected', 'suspended'));

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_verified_badge_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_verified_badge_updated ON verified_badge_subs;
CREATE TRIGGER tr_verified_badge_updated BEFORE UPDATE ON verified_badge_subs FOR EACH ROW EXECUTE FUNCTION update_verified_badge_updated_at();

-- ============================================================
-- 2. ADD BADGE PRICE COLUMNS TO SITE_SETTINGS
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='site_settings' AND column_name='badge_price_usd') THEN
        ALTER TABLE site_settings ADD COLUMN badge_price_usd DECIMAL(10,2) DEFAULT 8.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='site_settings' AND column_name='badge_price_ngn') THEN
        ALTER TABLE site_settings ADD COLUMN badge_price_ngn DECIMAL(10,2) DEFAULT 11200.00;
    END IF;
END $$;

UPDATE site_settings SET badge_price_usd = COALESCE(badge_price_usd, 8.00), badge_price_ngn = COALESCE(badge_price_ngn, 11200.00) WHERE id = 1;

-- ============================================================
-- 3. STORAGE BUCKET FOR BADGE SCREENSHOTS
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('badge-screenshots', 'badge-screenshots', true) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. RLS POLICIES FOR VERIFIED_BADGE_SUBS
-- ============================================================

ALTER TABLE verified_badge_subs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vbs_select_public ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_select_own ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_insert_own ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_update_own ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_select_all ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_update_all ON verified_badge_subs;
DROP POLICY IF EXISTS vbs_delete_all ON verified_badge_subs;

CREATE POLICY vbs_select_public ON verified_badge_subs FOR SELECT USING (status = 'active');
CREATE POLICY vbs_select_own ON verified_badge_subs FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY vbs_insert_own ON verified_badge_subs FOR INSERT WITH CHECK (creator_id = auth.uid());
CREATE POLICY vbs_update_own ON verified_badge_subs FOR UPDATE USING (creator_id = auth.uid());
CREATE POLICY vbs_select_all ON verified_badge_subs FOR SELECT TO authenticated USING (true);
CREATE POLICY vbs_update_all ON verified_badge_subs FOR UPDATE TO authenticated USING (true);
CREATE POLICY vbs_delete_all ON verified_badge_subs FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 5. STORAGE POLICIES FOR BADGE-SCREENSHOTS
-- ============================================================

DROP POLICY IF EXISTS badge_screenshots_read ON storage.objects;
DROP POLICY IF EXISTS badge_screenshots_insert ON storage.objects;
DROP POLICY IF EXISTS badge_screenshots_delete ON storage.objects;

CREATE POLICY badge_screenshots_read ON storage.objects FOR SELECT USING (bucket_id = 'badge-screenshots');
CREATE POLICY badge_screenshots_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'badge-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY badge_screenshots_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'badge-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 6. REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE verified_badge_subs;

-- ============================================================
-- 7. AUTO-EXPIRY FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION expire_verified_badges()
RETURNS void AS $$
BEGIN
    UPDATE verified_badge_subs SET status = 'expired' WHERE status = 'active' AND expires_at < NOW();
    UPDATE profiles SET verified = false WHERE id IN (
        SELECT creator_id FROM verified_badge_subs WHERE status = 'expired' AND verified = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT expire_verified_badges();

SELECT 'Verified Badge System update completed!' AS status;
-- ============================================================
-- GIFT CARD PAYMENT SYSTEM UPDATE
-- Add image URL columns and storage bucket for gift card uploads
-- Safe to run multiple times
-- ============================================================

-- 1. ADD gc_front_url and gc_back_url columns to payments table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='gc_front_url') THEN
        ALTER TABLE payments ADD COLUMN gc_front_url TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='gc_back_url') THEN
        ALTER TABLE payments ADD COLUMN gc_back_url TEXT DEFAULT '';
    END IF;
END $$;

-- 2. CREATE STORAGE BUCKET FOR GIFT CARD IMAGES
INSERT INTO storage.buckets (id, name, public) VALUES ('giftcard-images', 'giftcard-images', true) ON CONFLICT (id) DO NOTHING;

-- 3. STORAGE RLS POLICIES FOR giftcard-images
DROP POLICY IF EXISTS "giftcard_images_read" ON storage.objects;
DROP POLICY IF EXISTS "giftcard_images_insert" ON storage.objects;
DROP POLICY IF EXISTS "giftcard_images_delete" ON storage.objects;

CREATE POLICY "giftcard_images_read" ON storage.objects FOR SELECT USING (bucket_id = 'giftcard-images');
CREATE POLICY "giftcard_images_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'giftcard-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "giftcard_images_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'giftcard-images' AND (storage.foldername(name))[1] = auth.uid()::text);

SELECT 'Gift Card system update completed!' AS status;
-- ============================================================
-- FEATURES UPDATE SQL
-- VIP Subscribers Management, Notifications, Likes fixes
-- Safe to run multiple times
-- ============================================================

-- 1. ADD notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL DEFAULT '',
    body TEXT DEFAULT '',
    related_id TEXT DEFAULT '',
    related_type TEXT DEFAULT '',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "notifs_select_own" ON notifications;
DROP POLICY IF EXISTS "notifs_insert_system" ON notifications;
DROP POLICY IF EXISTS "notifs_update_own" ON notifications;
DROP POLICY IF EXISTS "notifs_delete_own" ON notifications;

-- Notifications policies: users can only see their own notifications
CREATE POLICY "notifs_select_own" ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifs_insert_system" ON notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifs_update_own" ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifs_delete_own" ON notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 2. Ensure vip_purchases table has all needed columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vip_purchases' AND column_name='expires_at') THEN
        ALTER TABLE vip_purchases ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vip_purchases' AND column_name='approved_at') THEN
        ALTER TABLE vip_purchases ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vip_purchases' AND column_name='payment_method') THEN
        ALTER TABLE vip_purchases ADD COLUMN payment_method TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vip_purchases' AND column_name='declined_at') THEN
        ALTER TABLE vip_purchases ADD COLUMN declined_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vip_purchases' AND column_name='decline_reason') THEN
        ALTER TABLE vip_purchases ADD COLUMN decline_reason TEXT DEFAULT '';
    END IF;
END $$;

-- 3. Ensure posts table has boosted_likes column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='posts' AND column_name='boosted_likes') THEN
        ALTER TABLE posts ADD COLUMN boosted_likes INTEGER DEFAULT 0;
    END IF;
END $$;

-- 4. Ensure profiles table has likes_count column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='likes_count') THEN
        ALTER TABLE profiles ADD COLUMN likes_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- 5. Create function to update profile likes_count
CREATE OR REPLACE FUNCTION update_profile_likes_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = (
            SELECT creator_id FROM posts WHERE id = NEW.post_id
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE profiles SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = (
            SELECT creator_id FROM posts WHERE id = OLD.post_id
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_update_profile_likes ON post_likes;

-- Create trigger
CREATE TRIGGER trg_update_profile_likes
AFTER INSERT OR DELETE ON post_likes
FOR EACH ROW
EXECUTE FUNCTION update_profile_likes_count();

-- 6. Create function to expire VIP purchases after 2 days
CREATE OR REPLACE FUNCTION expire_vip_purchases()
RETURNS void AS $$
BEGIN
    UPDATE vip_purchases 
    SET status = 'expired', updated_at = now()
    WHERE status = 'approved' 
    AND approved_at IS NOT NULL
    AND now() > (approved_at + interval '2 days');
END;
$$ LANGUAGE plpgsql;

-- 7. Create index for faster notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_vip_purchases_buyer ON vip_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_vip_purchases_video ON vip_purchases(video_id);
CREATE INDEX IF NOT EXISTS idx_vip_purchases_status ON vip_purchases(status);

SELECT 'Features update completed successfully!' AS status;

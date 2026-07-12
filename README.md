# OnlyFans Clone

A complete, production-ready OnlyFans clone built as a Single Page Application (SPA) using only **5 files**.

## Project Files

```
onlyfans-clone/
├── index.html          # Main SPA - all views
├── style.css           # All styles + Dark/Light mode
├── app.js              # All application logic
├── supabase.js         # Supabase client & helpers
├── README.md           # This file
└── sql/                # Database setup files
    ├── migration.sql       # Create all tables
    ├── rls_policies.sql    # Security policies
    └── storage_policies.sql # File storage rules
```

## Features

- **Authentication**: Sign up, Log in, Log out, Password reset
- **Profiles**: Fan & Creator profiles, Edit profile, Avatar upload
- **Feed**: Discover creators, Search, Recent posts
- **Creator Profile**: Cover, Bio, Stats, Subscribe, Message
- **Posts**: Image/Video upload, Premium/locked posts, Like system
- **Stories**: 24-hour disappearing stories
- **VIP Videos**: Pay-per-view exclusive videos
- **Messaging**: Real-time chat with image/video sharing
- **Wallet**: Balance, Deposits, Withdrawals, Transaction history
- **Payments**: Gift Cards, Bitcoin (BTC), USDT (TRC20/ERC20/BEP20)
- **Subscriptions**: Weekly, Monthly, VIP plans
- **Creator Studio**: Dashboard, Upload, VIP videos, Subscribers, Payments, Settings
- **Owner Dashboard**: Site overview, All users/creators/posts, Badge approvals
- **Dark/Light Mode**: Toggle between themes
- **Responsive**: Mobile-first design, works on all devices

## Quick Setup

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Copy your **Project URL** and **Anon Key** from Settings > API

### 2. Configure Credentials
Open `supabase.js` and paste your credentials:

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 3. Run Database Migration
1. In Supabase Dashboard, go to **SQL Editor**
2. Open `sql/migration.sql` and run it
3. Open `sql/rls_policies.sql` and run it
4. Open `sql/storage_policies.sql` and run it

### 4. Enable Auth Provider
1. Go to **Authentication > Providers**
2. Make sure **Email** provider is enabled
3. (Optional) Enable Google, Twitter for social login

### 5. Deploy
Upload all files to GitHub Pages, Netlify, Vercel, or Cloudflare Pages. No backend server needed.

## Database Schema

- **profiles** - User profiles (extends auth.users)
- **posts** - Creator posts (images/videos)
- **post_likes** - Like tracking
- **stories** - 24h disappearing stories
- **story_views** - Story view tracking
- **subscriptions** - Fan subscriptions
- **vip_videos** - Pay-per-view videos
- **vip_purchases** - VIP purchase records
- **chat_rooms** - Message rooms
- **messages** - Chat messages
- **transactions** - Wallet transactions
- **payments** - Payment records
- **notifications** - User notifications
- **verified_badge_subs** - Verified badge subscriptions
- **creator_payment_settings** - Creator payment config
- **site_settings** - Global site settings

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **No Node.js, No Express, No PHP, No Firebase**

## Owner Access

Click the lock icon on the landing page logo. Default password: `admin123`
Change it by running `localStorage.setItem('owner_password', 'your-password')` in browser console.

## License

This is a demo project for educational purposes.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table: words
-- Stores the spelling list.
create table public.words (
  id uuid primary key default uuid_generate_v4(),
  word text not null unique,
  created_at timestamp with time zone default now()
);

-- Table: user_progress
-- Tracks how many times a user has spelled a word correctly or incorrectly.
-- This allows for spaced repetition logic.
create table public.user_progress (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null references public.words(id) on delete cascade,
  correct_count int default 0,
  incorrect_count int default 0,
  last_practiced_at timestamp with time zone default now(),
  unique(user_id, word_id)
);

-- RLS Policies (Row Level Security)

-- Words: Publicly readable, only admins can insert (simplified for now to allow authenticated users to read)
alter table public.words enable row level security;

create policy "Allow read access to all users"
  on public.words for select
  using ( true );

-- User Progress: Users can only see and modify their own progress
alter table public.user_progress enable row level security;

create policy "Users can see own progress"
  on public.user_progress for select
  using ( auth.uid() = user_id );

create policy "Users can update own progress"
  on public.user_progress for insert
  with check ( auth.uid() = user_id );

create policy "Users can update own progress records"
  on public.user_progress for update
  using ( auth.uid() = user_id );

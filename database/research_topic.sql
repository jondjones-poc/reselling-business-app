-- Research → Topics: research a category of goods (wetsuits, cameras, golf clubs…)
-- before a buying season, then keep brands, prices and personal notes in one place.
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/research_topic.sql

CREATE TABLE IF NOT EXISTS public.research_topic (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(trim(name)) <= 120),
  status TEXT NOT NULL DEFAULT 'researching'
    CHECK (status IN ('researching', 'ready', 'buying', 'parked')),
  summary TEXT,
  seasonality TEXT,
  my_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_topic_name_lower
  ON public.research_topic (lower(trim(name)));

-- Search phrases scoped to one topic. Mirrors ebay_research_feed_tag but topic-scoped,
-- so the eBay feed can show only listings relevant to the thing being researched.
CREATE TABLE IF NOT EXISTS public.research_topic_tag (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES public.research_topic(id) ON DELETE CASCADE,
  term TEXT NOT NULL CHECK (char_length(trim(term)) > 0 AND char_length(trim(term)) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_topic_tag_topic_term_lower
  ON public.research_topic_tag (topic_id, lower(trim(term)));

-- Brands worth knowing for a topic, with the resale band and the most important
-- number in the field: the most I should ever pay.
CREATE TABLE IF NOT EXISTS public.research_topic_brand (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES public.research_topic(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(trim(name)) <= 160),
  tier TEXT NOT NULL DEFAULT 'mid' CHECK (tier IN ('premium', 'mid', 'budget', 'avoid')),
  resale_low_gbp NUMERIC(10, 2),
  resale_high_gbp NUMERIC(10, 2),
  buy_max_gbp NUMERIC(10, 2),
  models JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_topic_brand_topic_name_lower
  ON public.research_topic_brand (topic_id, lower(trim(name)));

-- Specific models/variants to learn: what to look for, what to avoid, and my own
-- verdict after handling one.
CREATE TABLE IF NOT EXISTS public.research_topic_item (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES public.research_topic(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(trim(name)) <= 200),
  brand_name TEXT,
  what_to_look_for TEXT,
  red_flags TEXT,
  how_to_identify TEXT,
  value_low_gbp NUMERIC(10, 2),
  value_high_gbp NUMERIC(10, 2),
  verdict TEXT NOT NULL DEFAULT 'unknown'
    CHECK (verdict IN ('buy', 'maybe', 'avoid', 'unknown')),
  my_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_topic_item_topic
  ON public.research_topic_item (topic_id, lower(trim(name)));

-- Raw JSON kept so an import can be audited or replayed after the schema changes.
CREATE TABLE IF NOT EXISTS public.research_topic_import (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES public.research_topic(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_topic_import_topic_created
  ON public.research_topic_import (topic_id, created_at DESC);

COMMENT ON TABLE public.research_topic IS
  'A category of goods being researched before a buying season (e.g. Wetsuits, Cameras).';
COMMENT ON COLUMN public.research_topic.my_notes IS
  'Free-text personal notes; not overwritten by JSON imports.';
COMMENT ON TABLE public.research_topic_tag IS
  'Topic-scoped eBay search phrases powering the topic feed and sell-through stats.';
COMMENT ON COLUMN public.research_topic_brand.buy_max_gbp IS
  'Maximum to pay in the field to keep the target resale multiple.';
COMMENT ON COLUMN public.research_topic_item.my_notes IS
  'My own observations; never overwritten by JSON imports.';

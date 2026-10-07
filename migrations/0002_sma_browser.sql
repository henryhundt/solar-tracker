-- Widen the existing check without changing any site or reading data.
ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_scraper_type_check;
ALTER TABLE sites ADD CONSTRAINT sites_scraper_type_check
  CHECK (scraper_type IN ('solaredge_api', 'solaredge_browser', 'egauge', 'alsoenergy', 'sma_browser', 'mock'));

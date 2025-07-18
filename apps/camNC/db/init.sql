-- Schema for user settings
DROP TABLE IF EXISTS settings;
CREATE TABLE settings (
    user_id TEXT PRIMARY KEY,
    settings_json JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
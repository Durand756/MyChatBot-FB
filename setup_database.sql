-- Script de création de la base de données pour Facebook Automation Platform
-- Exécutez ce script dans MySQL pour créer la base de données et les tables

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_email (email),
    INDEX idx_created_at (created_at)
);

-- Table des pages Facebook connectées
CREATE TABLE IF NOT EXISTS facebook_pages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    page_id VARCHAR(255) NOT NULL,
    page_name VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    app_id VARCHAR(255) NOT NULL,
    app_secret VARCHAR(255) NOT NULL,
    webhook_token VARCHAR(255) NOT NULL,
    webhook_url VARCHAR(500) NULL,
    is_active BOOLEAN DEFAULT true,
    token_expires_at TIMESTAMP NULL,
    last_webhook_call TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_page (user_id, page_id),
    INDEX idx_user_id (user_id),
    INDEX idx_page_id (page_id),
    INDEX idx_is_active (is_active)
);

-- Table des réponses prédéfinies
CREATE TABLE IF NOT EXISTS predefined_responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    page_id VARCHAR(255) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    response TEXT NOT NULL,
    priority INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    match_type ENUM('contains', 'exact', 'starts_with', 'ends_with') DEFAULT 'contains',
    case_sensitive BOOLEAN DEFAULT false,
    usage_count INT DEFAULT 0,
    last_used TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_page (user_id, page_id),
    INDEX idx_keyword (keyword),
    INDEX idx_priority (priority DESC),
    INDEX idx_is_active (is_active)
);

-- Table des configurations IA
CREATE TABLE IF NOT EXISTS ai_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    page_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    api_key TEXT NOT NULL,
    model VARCHAR(100) NOT NULL,
    temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INT DEFAULT 1000,
    instructions TEXT NULL,
    fallback_only BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT false,
    usage_count INT DEFAULT 0,
    last_used TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_page_ai (user_id, page_id),
    INDEX idx_user_id (user_id),
    INDEX idx_page_id (page_id),
    INDEX idx_provider (provider),
    INDEX idx_is_active (is_active)
);

-- Table de l'historique des messages
CREATE TABLE

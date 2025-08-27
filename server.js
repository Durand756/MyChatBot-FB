const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Facebook App - À MODIFIER avec vos vraies valeurs
const FACEBOOK_CONFIG = {
    app_id: process.env.FACEBOOK_APP_ID || 'YOUR_FACEBOOK_APP_ID',
    app_secret: process.env.FACEBOOK_APP_SECRET || 'YOUR_FACEBOOK_APP_SECRET',
    redirect_uri: process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/facebook/callback`
};

// Configuration de la base de données
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'facebook_automation',
    port: process.env.DB_PORT || 3306,
    connectionLimit: 10
};

// Configuration session sécurisée
const sessionConfig = {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
};

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session(sessionConfig));

// Pool de connexions à la base de données
let dbPool;

/**
 * Initialise la connexion à la base de données MySQL
 */
async function initDB() {
    try {
        console.log('🔄 Connexion à la base de données...');
        dbPool = mysql.createPool(dbConfig);
        
        // Test de la connexion
        const connection = await dbPool.getConnection();
        console.log('✅ Connecté à MySQL');
        connection.release();
        
        await createTables();
    } catch (error) {
        console.error('❌ Erreur connexion DB:', error.message);
        
        // Fallback mode démo si pas de DB
        console.log('⚠️ Mode démo activé (sans base de données)');
        dbPool = null;
    }
}

/**
 * Crée les tables nécessaires dans la base de données
 */
async function createTables() {
    if (!dbPool) return;
    
    try {
        // Table des utilisateurs Facebook
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS facebook_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                facebook_id VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                profile_picture TEXT,
                access_token TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Table des pages Facebook connectées
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS connected_pages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                page_id VARCHAR(255) NOT NULL,
                page_name VARCHAR(255) NOT NULL,
                page_access_token TEXT NOT NULL,
                is_active BOOLEAN DEFAULT false,
                webhook_verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES facebook_users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_page (user_id, page_id)
            )
        `);

        // Table des réponses automatiques
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS auto_responses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_id VARCHAR(255) NOT NULL,
                keyword VARCHAR(255) NOT NULL,
                response TEXT NOT NULL,
                priority INT DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_page_keyword (page_id, keyword)
            )
        `);

        // Table des conversations
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                page_id VARCHAR(255) NOT NULL,
                sender_id VARCHAR(255) NOT NULL,
                message_text TEXT NOT NULL,
                response_text TEXT,
                response_type ENUM('keyword', 'ai', 'none') DEFAULT 'none',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_page_sender (page_id, sender_id),
                INDEX idx_created_at (created_at)
            )
        `);

        console.log('✅ Tables créées/vérifiées');
    } catch (error) {
        console.error('❌ Erreur création tables:', error.message);
    }
}

/**
 * Exécute une requête SQL de manière sécurisée
 */
async function executeQuery(query, params = []) {
    if (!dbPool) {
        console.log('⚠️ Mode démo - requête simulée');
        return [[], { insertId: 1, affectedRows: 1 }];
    }
    
    try {
        const [rows] = await dbPool.execute(query, params);
        return [rows, { insertId: rows.insertId, affectedRows: rows.affectedRows }];
    } catch (error) {
        console.error('❌ Erreur SQL:', error.message);
        throw error;
    }
}

/**
 * Middleware pour vérifier l'authentification utilisateur
 */
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    next();
}

// ===== ROUTES D'AUTHENTIFICATION FACEBOOK =====

/**
 * Génère l'URL de connexion Facebook avec les permissions nécessaires
 */
app.get('/auth/facebook', (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth_state = state;
    
    const scopes = [
        'email',
        'pages_show_list',
        'pages_manage_metadata',
        'pages_messaging',
        'pages_read_engagement'
    ].join(',');
    
    const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
        `client_id=${FACEBOOK_CONFIG.app_id}&` +
        `redirect_uri=${encodeURIComponent(FACEBOOK_CONFIG.redirect_uri)}&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `response_type=code&` +
        `state=${state}`;
    
    res.redirect(facebookAuthUrl);
});

/**
 * Callback après authentification Facebook
 */
app.get('/auth/facebook/callback', async (req, res) => {
    const { code, state } = req.query;
    
    // Vérification du state pour éviter les attaques CSRF
    if (state !== req.session.oauth_state) {
        return res.redirect('/?error=invalid_state');
    }
    
    if (!code) {
        return res.redirect('/?error=access_denied');
    }
    
    try {
        // Échanger le code contre un access token
        const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: FACEBOOK_CONFIG.app_id,
                client_secret: FACEBOOK_CONFIG.app_secret,
                redirect_uri: FACEBOOK_CONFIG.redirect_uri,
                code: code
            }
        });
        
        const { access_token } = tokenResponse.data;
        
        // Récupérer les informations de l'utilisateur
        const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
            params: {
                fields: 'id,name,email,picture',
                access_token: access_token
            }
        });
        
        const userData = userResponse.data;
        
        // Sauvegarder ou mettre à jour l'utilisateur dans la DB
        await saveOrUpdateUser(userData, access_token);
        
        // Créer la session utilisateur
        req.session.user = {
            facebook_id: userData.id,
            name: userData.name,
            email: userData.email,
            profile_picture: userData.picture?.data?.url,
            access_token: access_token
        };
        
        console.log(`✅ Utilisateur connecté: ${userData.name}`);
        res.redirect('/?login=success');
        
    } catch (error) {
        console.error('❌ Erreur callback Facebook:', error.message);
        res.redirect('/?error=auth_failed');
    }
});

/**
 * Sauvegarde ou met à jour un utilisateur Facebook
 */
async function saveOrUpdateUser(userData, accessToken) {
    try {
        const [existingUsers] = await executeQuery(
            'SELECT id FROM facebook_users WHERE facebook_id = ?',
            [userData.id]
        );
        
        if (existingUsers.length > 0) {
            // Mise à jour de l'utilisateur existant
            await executeQuery(
                'UPDATE facebook_users SET name = ?, email = ?, profile_picture = ?, access_token = ?, updated_at = NOW() WHERE facebook_id = ?',
                [userData.name, userData.email, userData.picture?.data?.url, accessToken, userData.id]
            );
        } else {
            // Création d'un nouvel utilisateur
            await executeQuery(
                'INSERT INTO facebook_users (facebook_id, name, email, profile_picture, access_token) VALUES (?, ?, ?, ?, ?)',
                [userData.id, userData.name, userData.email, userData.picture?.data?.url, accessToken]
            );
        }
    } catch (error) {
        console.error('❌ Erreur sauvegarde utilisateur:', error.message);
    }
}

// ===== ROUTES API =====

/**
 * Récupère les informations de l'utilisateur connecté
 */
app.get('/api/user', requireAuth, (req, res) => {
    res.json({
        success: true,
        user: {
            name: req.session.user.name,
            email: req.session.user.email,
            profile_picture: req.session.user.profile_picture
        }
    });
});

/**
 * Récupère la liste des pages Facebook de l'utilisateur
 */
app.get('/api/pages', requireAuth, async (req, res) => {
    try {
        const response = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
            params: {
                access_token: req.session.user.access_token,
                fields: 'id,name,category,tasks,access_token'
            }
        });
        
        const pages = response.data.data.filter(page => 
            page.tasks && page.tasks.includes('MANAGE')
        );
        
        // Récupérer le statut de connexion pour chaque page
        const [connectedPages] = await executeQuery(
            'SELECT page_id, is_active FROM connected_pages WHERE user_id = (SELECT id FROM facebook_users WHERE facebook_id = ?)',
            [req.session.user.facebook_id]
        );
        
        const connectedPageMap = {};
        connectedPages.forEach(page => {
            connectedPageMap[page.page_id] = page.is_active;
        });
        
        const pagesWithStatus = pages.map(page => ({
            id: page.id,
            name: page.name,
            category: page.category,
            access_token: page.access_token,
            is_connected: connectedPageMap[page.id] || false
        }));
        
        res.json({
            success: true,
            pages: pagesWithStatus
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération pages:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Impossible de récupérer les pages' 
        });
    }
});

/**
 * Connecte une page Facebook pour l'automatisation
 */
app.post('/api/pages/connect', requireAuth, async (req, res) => {
    const { pageId, pageName, pageAccessToken } = req.body;
    
    try {
        // Récupérer l'ID utilisateur depuis la DB
        const [users] = await executeQuery(
            'SELECT id FROM facebook_users WHERE facebook_id = ?',
            [req.session.user.facebook_id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Utilisateur non trouvé' 
            });
        }
        
        const userId = users[0].id;
        
        // Sauvegarder la page connectée
        await executeQuery(
            `INSERT INTO connected_pages (user_id, page_id, page_name, page_access_token, is_active) 
             VALUES (?, ?, ?, ?, true) 
             ON DUPLICATE KEY UPDATE 
             page_name = VALUES(page_name), 
             page_access_token = VALUES(page_access_token), 
             is_active = true`,
            [userId, pageId, pageName, pageAccessToken]
        );
        
        console.log(`✅ Page connectée: ${pageName} (${pageId})`);
        
        res.json({
            success: true,
            message: 'Page connectée avec succès'
        });
        
    } catch (error) {
        console.error('❌ Erreur connexion page:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la connexion de la page'
        });
    }
});

/**
 * Déconnecte une page Facebook
 */
app.post('/api/pages/disconnect', requireAuth, async (req, res) => {
    const { pageId } = req.body;
    
    try {
        await executeQuery(
            `UPDATE connected_pages 
             SET is_active = false 
             WHERE page_id = ? AND user_id = (
                 SELECT id FROM facebook_users WHERE facebook_id = ?
             )`,
            [pageId, req.session.user.facebook_id]
        );
        
        console.log(`🔌 Page déconnectée: ${pageId}`);
        
        res.json({
            success: true,
            message: 'Page déconnectée avec succès'
        });
        
    } catch (error) {
        console.error('❌ Erreur déconnexion page:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la déconnexion'
        });
    }
});

/**
 * Ajoute une réponse automatique pour une page
 */
app.post('/api/responses', requireAuth, async (req, res) => {
    const { pageId, keyword, response, priority = 1 } = req.body;
    
    try {
        await executeQuery(
            'INSERT INTO auto_responses (page_id, keyword, response, priority) VALUES (?, ?, ?, ?)',
            [pageId, keyword, response, priority]
        );
        
        res.json({
            success: true,
            message: 'Réponse automatique ajoutée'
        });
        
    } catch (error) {
        console.error('❌ Erreur ajout réponse:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'ajout de la réponse'
        });
    }
});

/**
 * Récupère les réponses automatiques d'une page
 */
app.get('/api/responses/:pageId', requireAuth, async (req, res) => {
    try {
        const [responses] = await executeQuery(
            'SELECT * FROM auto_responses WHERE page_id = ? ORDER BY priority DESC, created_at DESC',
            [req.params.pageId]
        );
        
        res.json({
            success: true,
            responses: responses
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération réponses:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération'
        });
    }
});

/**
 * Déconnexion de l'utilisateur
 */
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('❌ Erreur déconnexion:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'Erreur lors de la déconnexion' 
            });
        }
        
        res.json({
            success: true,
            message: 'Déconnecté avec succès'
        });
    });
});

// ===== WEBHOOK FACEBOOK MESSENGER =====

/**
 * Vérification du webhook Facebook
 */
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Token de vérification (à définir dans votre app Facebook)
    const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'your_webhook_verify_token';
    
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook vérifié');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

/**
 * Réception des messages via webhook
 */
app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const pageId = entry.id;
            
            if (entry.messaging) {
                entry.messaging.forEach(async (event) => {
                    if (event.message && event.message.text) {
                        await handleIncomingMessage(pageId, event);
                    }
                });
            }
        });
    }
    
    res.status(200).send('EVENT_RECEIVED');
});

/**
 * Traite un message entrant et génère une réponse automatique
 */
async function handleIncomingMessage(pageId, event) {
    try {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        
        console.log(`📨 Message reçu sur page ${pageId}: "${messageText}"`);
        
        // Récupérer le token de la page
        const [pages] = await executeQuery(
            'SELECT page_access_token FROM connected_pages WHERE page_id = ? AND is_active = true',
            [pageId]
        );
        
        if (pages.length === 0) {
            console.log(`⚠️ Page ${pageId} non trouvée ou inactive`);
            return;
        }
        
        const pageAccessToken = pages[0].page_access_token;
        
        // Chercher une réponse automatique correspondante
        const [responses] = await executeQuery(
            'SELECT response FROM auto_responses WHERE page_id = ? AND is_active = true AND LOWER(?) LIKE LOWER(CONCAT("%", keyword, "%")) ORDER BY priority DESC LIMIT 1',
            [pageId, messageText]
        );
        
        let responseText = null;
        let responseType = 'none';
        
        if (responses.length > 0) {
            responseText = responses[0].response;
            responseType = 'keyword';
            
            // Envoyer la réponse
            await sendMessage(pageAccessToken, senderId, responseText);
            console.log(`📤 Réponse automatique envoyée: "${responseText}"`);
        }
        
        // Sauvegarder la conversation
        await executeQuery(
            'INSERT INTO conversations (page_id, sender_id, message_text, response_text, response_type) VALUES (?, ?, ?, ?, ?)',
            [pageId, senderId, messageText, responseText, responseType]
        );
        
    } catch (error) {
        console.error('❌ Erreur traitement message:', error.message);
    }
}

/**
 * Envoie un message via l'API Facebook Messenger
 */
async function sendMessage(pageAccessToken, recipientId, messageText) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${pageAccessToken}`, {
            recipient: { id: recipientId },
            message: { text: messageText }
        });
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi message:', error.response?.data || error.message);
        return false;
    }
}

// ===== ROUTES GÉNÉRALES =====

/**
 * API de santé pour vérifier le statut du serveur
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbPool ? 'connected' : 'demo_mode',
        session: req.session.user ? 'authenticated' : 'anonymous'
    });
});

/**
 * Servir le fichier HTML principal
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Redirection pour toutes les autres routes vers l'index
 */
app.get('*', (req, res) => {
    res.redirect('/');
});

// ===== GESTION DES ERREURS =====

/**
 * Middleware de gestion globale des erreurs
 */
app.use((error, req, res, next) => {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
    });
});

/**
 * Fermeture propre du serveur
 */
process.on('SIGINT', async () => {
    console.log('🔄 Arrêt du serveur...');
    if (dbPool) {
        await dbPool.end();
        console.log('✅ Connexion DB fermée');
    }
    process.exit(0);
});

// ===== DÉMARRAGE DU SERVEUR =====

async function startServer() {
    // Chargement des variables d'environnement
    try {
        require('dotenv').config();
    } catch (e) {
        console.log('⚠️ dotenv non trouvé, utilisation des valeurs par défaut');
    }
    
    // Vérification de la configuration Facebook
    if (FACEBOOK_CONFIG.app_id === 'YOUR_FACEBOOK_APP_ID') {
        console.log('⚠️ ATTENTION: Configurez vos identifiants Facebook dans les variables d\'environnement');
        console.log('   FACEBOOK_APP_ID et FACEBOOK_APP_SECRET requis');
    }
    
    await initDB();
    
    app.listen(PORT, () => {
        console.log(`🚀 Serveur démarré sur le port ${PORT}`);
        console.log(`🌐 URL: http://localhost:${PORT}`);
        console.log(`📱 Facebook App ID: ${FACEBOOK_CONFIG.app_id}`);
        console.log(`💾 Base de données: ${dbPool ? '✅ Connectée' : '⚠️ Mode démo'}`);
        console.log(`🔗 Redirect URI: ${FACEBOOK_CONFIG.redirect_uri}`);
    });
}

startServer().catch(error => {
    console.error('❌ Erreur critique au démarrage:', error);
    process.exit(1);
});

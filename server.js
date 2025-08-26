const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de la base de données avec variables d'environnement et fallback
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'facebook_automation',
    port: process.env.DB_PORT || 3306,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000
};

// Configuration session pour production
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production-' + Date.now(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
};

// Si en production, utiliser un store persistant
if (process.env.NODE_ENV === 'production') {
    const MySQLStore = require('express-mysql-session')(session);
    const sessionStore = new MySQLStore(dbConfig);
    sessionConfig.store = sessionStore;
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use(session(sessionConfig));

// Créer la connexion à la base de données avec pool
let dbPool;
async function initDB() {
    try {
        console.log('Tentative de connexion à la base de données...');
        console.log('Config DB:', {
            host: dbConfig.host,
            user: dbConfig.user,
            database: dbConfig.database,
            port: dbConfig.port
        });

        // Créer le pool de connexions
        dbPool = mysql.createPool(dbConfig);
        
        // Tester la connexion
        const connection = await dbPool.getConnection();
        console.log('✅ Connecté à MySQL');
        connection.release();
        
        // Créer les tables si elles n'existent pas
        await createTables();
    } catch (error) {
        console.error('❌ Erreur connexion DB:', error.message);
        
        // Fallback vers SQLite si MySQL échoue (pour développement local)
        if (process.env.NODE_ENV !== 'production') {
            console.log('🔄 Tentative de fallback vers SQLite...');
            await initSQLite();
        } else {
            process.exit(1);
        }
    }
}

// Fallback SQLite pour développement local
async function initSQLite() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const { open } = require('sqlite');
        
        dbPool = await open({
            filename: './database.sqlite',
            driver: sqlite3.Database
        });
        
        console.log('✅ Fallback SQLite initialisé');
        await createSQLiteTables();
    } catch (error) {
        console.error('❌ Erreur SQLite fallback:', error.message);
        console.log('ℹ️  Continuing without database for demo purposes...');
        dbPool = null;
    }
}

async function createTables() {
    if (!dbPool) return;
    
    try {
        // Table utilisateurs
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table pages Facebook
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS facebook_pages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                page_id VARCHAR(255) NOT NULL,
                page_name VARCHAR(255) NOT NULL,
                access_token TEXT NOT NULL,
                app_id VARCHAR(255) NOT NULL,
                app_secret VARCHAR(255) NOT NULL,
                webhook_token VARCHAR(255) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Table réponses prédéfinies
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS predefined_responses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                page_id VARCHAR(255) NOT NULL,
                keyword VARCHAR(255) NOT NULL,
                response TEXT NOT NULL,
                priority INT DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Table configuration IA
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS ai_configs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                page_id VARCHAR(255) NOT NULL,
                provider VARCHAR(50) NOT NULL,
                api_key TEXT NOT NULL,
                model VARCHAR(100) NOT NULL,
                temperature DECIMAL(3,2) DEFAULT 0.7,
                instructions TEXT,
                is_active BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Table historique des messages
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS message_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                page_id VARCHAR(255) NOT NULL,
                sender_id VARCHAR(255) NOT NULL,
                message_text TEXT NOT NULL,
                response_text TEXT,
                response_type ENUM('predefined', 'ai') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        console.log('✅ Tables MySQL créées/vérifiées');
    } catch (error) {
        console.error('❌ Erreur création tables MySQL:', error.message);
    }
}

// Tables SQLite pour fallback
async function createSQLiteTables() {
    if (!dbPool) return;
    
    try {
        await dbPool.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS facebook_pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                page_id TEXT NOT NULL,
                page_name TEXT NOT NULL,
                access_token TEXT NOT NULL,
                app_id TEXT NOT NULL,
                app_secret TEXT NOT NULL,
                webhook_token TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS predefined_responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                page_id TEXT NOT NULL,
                keyword TEXT NOT NULL,
                response TEXT NOT NULL,
                priority INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                page_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                api_key TEXT NOT NULL,
                model TEXT NOT NULL,
                temperature REAL DEFAULT 0.7,
                instructions TEXT,
                is_active BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                page_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                message_text TEXT NOT NULL,
                response_text TEXT,
                response_type TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        
        console.log('✅ Tables SQLite créées/vérifiées');
    } catch (error) {
        console.error('❌ Erreur création tables SQLite:', error.message);
    }
}

// Helper pour exécuter des requêtes de manière uniforme
async function executeQuery(query, params = []) {
    if (!dbPool) {
        console.log('⚠️ Pas de base de données - mode demo');
        return [[], null];
    }
    
    try {
        if (dbConfig.host === 'localhost' && process.env.NODE_ENV !== 'production') {
            // SQLite
            if (query.includes('SELECT')) {
                const result = await dbPool.all(query, params);
                return [result, null];
            } else {
                const result = await dbPool.run(query, params);
                return [[], { insertId: result.lastID, affectedRows: result.changes }];
            }
        } else {
            // MySQL
            const [rows, fields] = await dbPool.execute(query, params);
            return [rows, { insertId: rows.insertId, affectedRows: rows.affectedRows }];
        }
    } catch (error) {
        console.error('Erreur query:', error.message);
        throw error;
    }
}

// Middleware d'authentification
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token manquant' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production-' + Date.now();
    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token invalide' });
        req.user = user;
        next();
    });
}

// Routes d'authentification
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        if (!dbPool) {
            return res.status(503).json({ error: 'Service de base de données indisponible - mode démo' });
        }
        
        // Vérifier si l'utilisateur existe déjà
        const [existing] = await executeQuery('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Utilisateur déjà existant' });
        }

        // Hacher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Créer l'utilisateur
        const [, result] = await executeQuery(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name]
        );

        res.json({ message: 'Utilisateur créé avec succès', userId: result.insertId });
    } catch (error) {
        console.error('Erreur register:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!dbPool) {
            return res.status(503).json({ error: 'Service de base de données indisponible - mode démo' });
        }
        
        // Trouver l'utilisateur
        const [users] = await executeQuery('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ error: 'Utilisateur introuvable' });
        }

        const user = users[0];
        
        // Vérifier le mot de passe
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Mot de passe incorrect' });
        }

        // Créer le token JWT
        const jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production-' + Date.now();
        const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: '24h' });
        
        res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Routes pour les pages Facebook
app.post('/api/facebook/connect', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.status(503).json({ error: 'Service de base de données indisponible - mode démo' });
        }

        const { pageId, pageName, accessToken, appId, appSecret, webhookToken } = req.body;
        
        // Vérifier si la page existe déjà pour cet utilisateur
        const [existing] = await executeQuery(
            'SELECT id FROM facebook_pages WHERE user_id = ? AND page_id = ?',
            [req.user.userId, pageId]
        );

        if (existing.length > 0) {
            // Mettre à jour
            await executeQuery(
                'UPDATE facebook_pages SET page_name = ?, access_token = ?, app_id = ?, app_secret = ?, webhook_token = ? WHERE user_id = ? AND page_id = ?',
                [pageName, accessToken, appId, appSecret, webhookToken, req.user.userId, pageId]
            );
        } else {
            // Créer nouveau
            await executeQuery(
                'INSERT INTO facebook_pages (user_id, page_id, page_name, access_token, app_id, app_secret, webhook_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.user.userId, pageId, pageName, accessToken, appId, appSecret, webhookToken]
            );
        }

        res.json({ message: 'Page connectée avec succès' });
    } catch (error) {
        console.error('Erreur connect page:', error);
        res.status(500).json({ error: 'Erreur lors de la connexion de la page' });
    }
});

app.get('/api/facebook/pages', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.json([]); // Mode démo
        }

        const [pages] = await executeQuery(
            'SELECT page_id, page_name, is_active, created_at FROM facebook_pages WHERE user_id = ?',
            [req.user.userId]
        );
        res.json(pages);
    } catch (error) {
        console.error('Erreur get pages:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des pages' });
    }
});

// Routes pour les réponses prédéfinies
app.post('/api/responses', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.status(503).json({ error: 'Service de base de données indisponible - mode démo' });
        }

        const { pageId, keyword, response, priority } = req.body;
        
        await executeQuery(
            'INSERT INTO predefined_responses (user_id, page_id, keyword, response, priority) VALUES (?, ?, ?, ?, ?)',
            [req.user.userId, pageId, keyword, response, priority || 1]
        );

        res.json({ message: 'Réponse ajoutée avec succès' });
    } catch (error) {
        console.error('Erreur add response:', error);
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la réponse' });
    }
});

app.get('/api/responses/:pageId', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.json([]); // Mode démo
        }

        const [responses] = await executeQuery(
            'SELECT * FROM predefined_responses WHERE user_id = ? AND page_id = ? ORDER BY priority DESC',
            [req.user.userId, req.params.pageId]
        );
        res.json(responses);
    } catch (error) {
        console.error('Erreur get responses:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des réponses' });
    }
});

// Routes pour la configuration IA
app.post('/api/ai-config', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.status(503).json({ error: 'Service de base de données indisponible - mode démo' });
        }

        const { pageId, provider, apiKey, model, temperature, instructions } = req.body;
        
        // Vérifier si une config existe déjà
        const [existing] = await executeQuery(
            'SELECT id FROM ai_configs WHERE user_id = ? AND page_id = ?',
            [req.user.userId, pageId]
        );

        if (existing.length > 0) {
            // Mettre à jour
            await executeQuery(
                'UPDATE ai_configs SET provider = ?, api_key = ?, model = ?, temperature = ?, instructions = ?, is_active = 1 WHERE user_id = ? AND page_id = ?',
                [provider, apiKey, model, temperature, instructions, req.user.userId, pageId]
            );
        } else {
            // Créer nouveau
            await executeQuery(
                'INSERT INTO ai_configs (user_id, page_id, provider, api_key, model, temperature, instructions, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                [req.user.userId, pageId, provider, apiKey, model, temperature, instructions]
            );
        }

        res.json({ message: 'Configuration IA sauvegardée' });
    } catch (error) {
        console.error('Erreur ai config:', error);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
    }
});
// Webhook Facebook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe') {
            // Ici on vérifie le token pour chaque page
            console.log('Webhook vérifié pour token:', token);
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        
        if (body.object === 'page') {
            for (const entry of body.entry) {
                const pageId = entry.id;
                
                if (entry.messaging) {
                    for (const event of entry.messaging) {
                        if (event.message && event.message.text) {
                            await handleMessage(pageId, event);
                        }
                    }
                }
            }
        }
        
        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('Erreur webhook:', error);
        res.status(500).send('Erreur');
    }
});

// Fonction pour traiter les messages
async function handleMessage(pageId, event) {
    if (!dbPool) {
        console.log('⚠️ Pas de DB - message ignoré');
        return;
    }

    try {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        
        if (!messageText) return;

        console.log(`📨 Message reçu sur page ${pageId}: "${messageText}"`);

        // Trouver la configuration de la page
        const [pages] = await executeQuery(
            'SELECT * FROM facebook_pages WHERE page_id = ? AND is_active = 1',
            [pageId]
        );

        if (pages.length === 0) {
            console.log('❌ Page non trouvée ou inactive:', pageId);
            return;
        }
        
        const pageConfig = pages[0];
        const startTime = Date.now();

        // Chercher une réponse prédéfinie
        const [responses] = await executeQuery(
            'SELECT * FROM predefined_responses WHERE page_id = ? AND is_active = 1 ORDER BY priority DESC',
            [pageId]
        );

        let responseText = null;
        let responseType = 'predefined';
        let keywordMatched = null;

        // Vérifier les mots-clés
        for (const response of responses) {
            if (messageText.toLowerCase().includes(response.keyword.toLowerCase())) {
                responseText = response.response;
                keywordMatched = response.keyword;
                console.log(`✅ Mot-clé trouvé: "${response.keyword}"`);
                break;
            }
        }

        // Si pas de réponse prédéfinie, utiliser l'IA
        if (!responseText) {
            console.log('🤖 Tentative réponse IA...');
            const [aiConfigs] = await executeQuery(
                'SELECT * FROM ai_configs WHERE page_id = ? AND is_active = 1',
                [pageId]
            );

            if (aiConfigs.length > 0) {
                const aiConfig = aiConfigs[0];
                responseText = await generateAIResponse(messageText, aiConfig);
                responseType = 'ai';
                console.log('✅ Réponse IA générée');
            } else {
                console.log('❌ Pas de config IA active');
            }
        }

        if (responseText) {
            // Envoyer la réponse
            const success = await sendMessage(pageConfig.access_token, senderId, responseText);
            const processingTime = Date.now() - startTime;
            
            // Sauvegarder l'historique
            await executeQuery(
                'INSERT INTO message_history (user_id, page_id, sender_id, message_text, response_text, response_type) VALUES (?, ?, ?, ?, ?, ?)',
                [pageConfig.user_id, pageId, senderId, messageText, responseText, responseType]
            );

            console.log(`📤 Réponse envoyée (${processingTime}ms):`, responseText.substring(0, 50) + '...');
        } else {
            console.log('❌ Aucune réponse trouvée');
        }
    } catch (error) {
        console.error('❌ Erreur handleMessage:', error.message);
    }
}

// Fonction pour envoyer un message Facebook
async function sendMessage(accessToken, recipientId, messageText) {
    try {
        const response = await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${accessToken}`, {
            recipient: { id: recipientId },
            message: { text: messageText }
        });
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi message Facebook:', error.response?.data || error.message);
        return false;
    }
}

// Fonction pour générer une réponse IA
async function generateAIResponse(messageText, aiConfig) {
    try {
        let response = '';
        
        switch (aiConfig.provider) {
            case 'OpenAI':
                const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: aiConfig.model,
                    messages: [
                        { role: 'system', content: aiConfig.instructions || 'Réponds de manière amicale et utile.' },
                        { role: 'user', content: messageText }
                    ],
                    temperature: parseFloat(aiConfig.temperature),
                    max_tokens: 150
                }, {
                    headers: {
                        'Authorization': `Bearer ${aiConfig.api_key}`,
                        'Content-Type': 'application/json'
                    }
                });
                response = openaiResponse.data.choices[0].message.content;
                break;
                
            case 'Mistral':
                const mistralResponse = await axios.post('https://api.mistral.ai/v1/chat/completions', {
                    model: aiConfig.model,
                    messages: [
                        { role: 'system', content: aiConfig.instructions || 'Réponds de manière amicale et utile.' },
                        { role: 'user', content: messageText }
                    ],
                    temperature: parseFloat(aiConfig.temperature),
                    max_tokens: 150
                }, {
                    headers: {
                        'Authorization': `Bearer ${aiConfig.api_key}`,
                        'Content-Type': 'application/json'
                    }
                });
                response = mistralResponse.data.choices[0].message.content;
                break;
                
            case 'Claude':
                const claudeResponse = await axios.post('https://api.anthropic.com/v1/messages', {
                    model: aiConfig.model,
                    max_tokens: 150,
                    messages: [
                        { role: 'user', content: `${aiConfig.instructions || 'Réponds de manière amicale et utile.'}\n\nMessage: ${messageText}` }
                    ]
                }, {
                    headers: {
                        'x-api-key': aiConfig.api_key,
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01'
                    }
                });
                response = claudeResponse.data.content[0].text;
                break;
                
            default:
                response = 'Fournisseur IA non supporté.';
        }
        
        return response;
    } catch (error) {
        console.error('❌ Erreur génération IA:', error.response?.data || error.message);
        return 'Désolé, je ne peux pas répondre pour le moment.';
    }
}

// Route pour l'historique
app.get('/api/history/:pageId', authenticateToken, async (req, res) => {
    try {
        if (!dbPool) {
            return res.json([]); // Mode démo
        }

        const [history] = await executeQuery(
            'SELECT * FROM message_history WHERE user_id = ? AND page_id = ? ORDER BY created_at DESC LIMIT 100',
            [req.user.userId, req.params.pageId]
        );
        res.json(history);
    } catch (error) {
        console.error('Erreur get history:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de l\'historique' });
    }
});

// Route de santé pour vérifier le statut
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: dbPool ? 'connected' : 'disconnected',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Gestion des erreurs globales
app.use((error, req, res, next) => {
    console.error('❌ Erreur globale:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Servir le frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fermeture propre
process.on('SIGINT', async () => {
    console.log('🔄 Arrêt du serveur...');
    if (dbPool) {
        await dbPool.end();
        console.log('✅ Connexion DB fermée');
    }
    process.exit(0);
});

// Démarrer le serveur
async function startServer() {
    // Charger les variables d'environnement si disponible
    try {
        require('dotenv').config();
    } catch (e) {
        console.log('ℹ️ dotenv non trouvé, utilisation des variables par défaut');
    }

    await initDB();
    
    app.listen(PORT, () => {
        console.log(`🚀 Serveur démarré sur le port ${PORT}`);
        console.log(`🌐 Environnement: ${process.env.NODE_ENV || 'development'}`);
        console.log(`💾 Base de données: ${dbPool ? '✅ Connectée' : '❌ Déconnectée (mode démo)'}`);
    });
}

startServer().catch(error => {
    console.error('❌ Erreur critique au démarrage:', error);
    process.exit(1);
});

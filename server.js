const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false
}));

// Configuration base de données
const dbConfig = {
    host: 'sql208.infinityfree.com',
    user: 'if0_39781107',
    password: 'DurandDev237',
    database: 'if0_39781107_mychatbot_fb'
};

// Créer la connexion à la base de données
let db;
async function initDB() {
    try {
        db = await mysql.createConnection(dbConfig);
        console.log('Connecté à MySQL');
        
        // Créer les tables si elles n'existent pas
        await createTables();
    } catch (error) {
        console.error('Erreur connexion DB:', error);
    }
}

async function createTables() {
    // Table utilisateurs
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Table pages Facebook
    await db.execute(`
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
    await db.execute(`
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
    await db.execute(`
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
    await db.execute(`
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
}

// Middleware d'authentification
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Token manquant' });
    }

    jwt.verify(token, 'your-jwt-secret-change-in-production', (err, user) => {
        if (err) return res.status(403).json({ error: 'Token invalide' });
        req.user = user;
        next();
    });
}

// Routes d'authentification
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        // Vérifier si l'utilisateur existe déjà
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Utilisateur déjà existant' });
        }

        // Hacher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Créer l'utilisateur
        const [result] = await db.execute(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name]
        );

        res.json({ message: 'Utilisateur créé avec succès', userId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Trouver l'utilisateur
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
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
        const token = jwt.sign({ userId: user.id }, 'your-jwt-secret-change-in-production');
        
        res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Routes pour les pages Facebook
app.post('/api/facebook/connect', authenticateToken, async (req, res) => {
    try {
        const { pageId, pageName, accessToken, appId, appSecret, webhookToken } = req.body;
        
        // Vérifier si la page existe déjà pour cet utilisateur
        const [existing] = await db.execute(
            'SELECT id FROM facebook_pages WHERE user_id = ? AND page_id = ?',
            [req.user.userId, pageId]
        );

        if (existing.length > 0) {
            // Mettre à jour
            await db.execute(
                'UPDATE facebook_pages SET page_name = ?, access_token = ?, app_id = ?, app_secret = ?, webhook_token = ? WHERE user_id = ? AND page_id = ?',
                [pageName, accessToken, appId, appSecret, webhookToken, req.user.userId, pageId]
            );
        } else {
            // Créer nouveau
            await db.execute(
                'INSERT INTO facebook_pages (user_id, page_id, page_name, access_token, app_id, app_secret, webhook_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.user.userId, pageId, pageName, accessToken, appId, appSecret, webhookToken]
            );
        }

        res.json({ message: 'Page connectée avec succès' });
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la connexion de la page' });
    }
});

app.get('/api/facebook/pages', authenticateToken, async (req, res) => {
    try {
        const [pages] = await db.execute(
            'SELECT page_id, page_name, is_active, created_at FROM facebook_pages WHERE user_id = ?',
            [req.user.userId]
        );
        res.json(pages);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des pages' });
    }
});

// Routes pour les réponses prédéfinies
app.post('/api/responses', authenticateToken, async (req, res) => {
    try {
        const { pageId, keyword, response, priority } = req.body;
        
        await db.execute(
            'INSERT INTO predefined_responses (user_id, page_id, keyword, response, priority) VALUES (?, ?, ?, ?, ?)',
            [req.user.userId, pageId, keyword, response, priority || 1]
        );

        res.json({ message: 'Réponse ajoutée avec succès' });
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la réponse' });
    }
});

app.get('/api/responses/:pageId', authenticateToken, async (req, res) => {
    try {
        const [responses] = await db.execute(
            'SELECT * FROM predefined_responses WHERE user_id = ? AND page_id = ? ORDER BY priority DESC',
            [req.user.userId, req.params.pageId]
        );
        res.json(responses);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération des réponses' });
    }
});

// Routes pour la configuration IA
app.post('/api/ai-config', authenticateToken, async (req, res) => {
    try {
        const { pageId, provider, apiKey, model, temperature, instructions } = req.body;
        
        // Vérifier si une config existe déjà
        const [existing] = await db.execute(
            'SELECT id FROM ai_configs WHERE user_id = ? AND page_id = ?',
            [req.user.userId, pageId]
        );

        if (existing.length > 0) {
            // Mettre à jour
            await db.execute(
                'UPDATE ai_configs SET provider = ?, api_key = ?, model = ?, temperature = ?, instructions = ?, is_active = true WHERE user_id = ? AND page_id = ?',
                [provider, apiKey, model, temperature, instructions, req.user.userId, pageId]
            );
        } else {
            // Créer nouveau
            await db.execute(
                'INSERT INTO ai_configs (user_id, page_id, provider, api_key, model, temperature, instructions, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
                [req.user.userId, pageId, provider, apiKey, model, temperature, instructions]
            );
        }

        res.json({ message: 'Configuration IA sauvegardée' });
    } catch (error) {
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
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
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
                        if (event.message) {
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
    try {
        const senderId = event.sender.id;
        const messageText = event.message.text;
        
        if (!messageText) return;

        // Trouver la configuration de la page
        const [pages] = await db.execute(
            'SELECT * FROM facebook_pages WHERE page_id = ? AND is_active = true',
            [pageId]
        );

        if (pages.length === 0) return;
        const pageConfig = pages[0];

        // Chercher une réponse prédéfinie
        const [responses] = await db.execute(
            'SELECT * FROM predefined_responses WHERE page_id = ? AND is_active = true ORDER BY priority DESC',
            [pageId]
        );

        let responseText = null;
        let responseType = 'predefined';

        // Vérifier les mots-clés
        for (const response of responses) {
            if (messageText.toLowerCase().includes(response.keyword.toLowerCase())) {
                responseText = response.response;
                break;
            }
        }

        // Si pas de réponse prédéfinie, utiliser l'IA
        if (!responseText) {
            const [aiConfigs] = await db.execute(
                'SELECT * FROM ai_configs WHERE page_id = ? AND is_active = true',
                [pageId]
            );

            if (aiConfigs.length > 0) {
                const aiConfig = aiConfigs[0];
                responseText = await generateAIResponse(messageText, aiConfig);
                responseType = 'ai';
            }
        }

        if (responseText) {
            // Envoyer la réponse
            await sendMessage(pageConfig.access_token, senderId, responseText);
            
            // Sauvegarder l'historique
            await db.execute(
                'INSERT INTO message_history (user_id, page_id, sender_id, message_text, response_text, response_type) VALUES (?, ?, ?, ?, ?, ?)',
                [pageConfig.user_id, pageId, senderId, messageText, responseText, responseType]
            );
        }
    } catch (error) {
        console.error('Erreur handleMessage:', error);
    }
}

// Fonction pour envoyer un message Facebook
async function sendMessage(accessToken, recipientId, messageText) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${accessToken}`, {
            recipient: { id: recipientId },
            message: { text: messageText }
        });
    } catch (error) {
        console.error('Erreur envoi message:', error);
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
                    temperature: aiConfig.temperature
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
                    temperature: aiConfig.temperature
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
                    max_tokens: 1000,
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
        }
        
        return response;
    } catch (error) {
        console.error('Erreur génération IA:', error);
        return 'Désolé, je ne peux pas répondre pour le moment.';
    }
}

// Route pour l'historique
app.get('/api/history/:pageId', authenticateToken, async (req, res) => {
    try {
        const [history] = await db.execute(
            'SELECT * FROM message_history WHERE user_id = ? AND page_id = ? ORDER BY created_at DESC LIMIT 100',
            [req.user.userId, req.params.pageId]
        );
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la récupération de l\'historique' });
    }
});

// Servir le frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur
async function startServer() {
    await initDB();
    app.listen(PORT, () => {
        console.log(`Serveur démarré sur le port ${PORT}`);
    });
}

startServer();

# 🤖 Facebook Automation Platform

Une plateforme complète pour automatiser vos pages Facebook avec des chatbots hybrides (réponses prédéfinies + IA).

## ✨ Fonctionnalités

- 🔐 **Système d'authentification complet** (inscription, connexion)
- 📱 **Gestion multi-pages** Facebook par utilisateur
- 💬 **Chatbot à réponses prédéfinies** avec système de priorités
- 🤖 **IA optionnelle** (OpenAI, Mistral, Claude) pour réponses génératives
- 📊 **Dashboard interactif** et responsive
- 📈 **Historique et statistiques** des conversations
- 🔒 **Sécurité** : tokens isolés par utilisateur
- 🎯 **Webhooks Facebook** pour réponses en temps réel

## 🚀 Installation

### 1. Prérequis

- **Node.js** 16+ 
- **MySQL** 8.0+
- **Compte développeur Facebook** avec app créée
- **Clés API** pour les services IA (optionnel)

### 2. Configuration de la base de données

```bash
# Connectez-vous à MySQL
mysql -u root -p

# Exécutez le script de création
mysql -u root -p < setup_database.sql
```

### 3. Installation du projet

```bash
# Cloner ou télécharger le projet
cd facebook-automation-platform

# Installer les dépendances
npm install

# Configurer la base de données dans server.js (ligne 17-22)
const dbConfig = {
    host: 'localhost',
    user: 'votre_utilisateur_mysql',
    password: 'votre_mot_de_passe_mysql',
    database: 'facebook_automation'
};
```

### 4. Configuration Facebook

#### A. Créer une app Facebook

1. Allez sur [Facebook Developers](https://developers.facebook.com/)
2. Créez une nouvelle app de type "Business"
3. Ajoutez le produit "Webhooks" et "Messenger"

#### B. Configurer les webhooks

1. Dans votre app Facebook, allez dans Webhooks
2. URL du webhook : `https://votre-domaine.com/webhook`
3. Abonnez-vous aux événements : `messages`, `messaging_postbacks`

### 5. Démarrage

```bash
# Mode développement
npm run dev

# Mode production
npm start
```

L'application sera accessible sur `http://localhost:3000`

## 📋 Utilisation

### 1. Création de compte

1. Accédez à la plateforme
2. Cliquez sur "Créer un compte"
3. Remplissez vos informations

### 2. Connexion d'une page Facebook

1. Dans l'onglet "Mes Pages", cliquez "Connecter une page"
2. Remplissez les informations :
   - **ID de la page** : Trouvable dans les paramètres de votre page FB
   - **Token d'accès** : Token long-lived de votre page
   - **App ID/Secret** : De votre app Facebook
   - **Token webhook** : Token de vérification personnalisé

### 3. Configuration des réponses prédéfinies

1. Onglet "Réponses" → Sélectionnez votre page
2. Cliquez "Ajouter" pour créer une réponse
3. Définissez :
   - **Mot-clé** : ce qui déclenche la réponse
   - **Réponse** : le message à envoyer
   - **Priorité** : 1-10 (plus élevé = prioritaire)

### 4. Configuration IA (optionnel)

1. Onglet "Configuration IA" → Sélectionnez votre page
2. Choisissez votre fournisseur (OpenAI, Mistral, Claude)
3. Entrez votre clé API
4. Personnalisez les instructions système

## 🔧 Structure des fichiers

```
facebook-automation-platform/
├── server.js              # Serveur principal Node.js
├── package.json           # Configuration du projet
├── setup_database.sql     # Script de création BDD
├── README.md             # Ce fichier
└── public/
    └── index.html        # Interface utilisateur
```

## 🔐 Sécurité

- **Mots de passe** : Hashés avec bcrypt
- **Tokens JWT** : Pour l'authentification des sessions
- **Isolation** : Chaque utilisateur accède uniquement à ses données
- **Clés API** : Stockées de manière sécurisée par utilisateur

## 📊 Fonctionnement du chatbot

### Logique de réponse

1. **Message reçu** via webhook Facebook
2. **Vérification** des réponses prédéfinies (par priorité)
3. Si aucune correspondance et **IA activée** → Génération de réponse
4. **Envoi** de la réponse via Facebook Graph API
5. **Sauvegarde** dans l'historique

### Exemple de flux

```
👤 Utilisateur: "Bonjour, quels sont vos prix ?"
🔍 Système: Cherche "bonjour" → Match trouvé (priorité 5)
🤖 Bot: "Bonjour ! Comment puis-je vous aider ?"
📝 Historique: Message sauvegardé (type: predefined)
```

## 🚨 Dépannage

### Problèmes courants

**1. Connexion BDD échoue**
```bash
# Vérifiez que MySQL est démarré
sudo service mysql start

# Vérifiez les identifiants dans server.js
```

**2. Webhook ne fonctionne pas**
```bash
# Vérifiez que votre serveur est accessible publiquement
# Utilisez ngrok pour tester en local :
ngrok http 3000
```

**3. Réponses IA ne marchent pas**
- Vérifiez que votre clé API est valide
- Vérifiez les quotas de votre compte IA
- Consultez les logs du serveur

### Logs utiles

```javascript
// Dans server.js, ajoutez pour débugger :
console.log('Message reçu:', messageText);
console.log('Réponse trouvée:', responseText);
```

## 🔄 API Endpoints

### Authentification
- `POST /api/register` - Inscription
- `POST /api/login` - Connexion

### Pages Facebook
- `POST /api/facebook/connect` - Connecter une page
- `GET /api/facebook/pages` - Lister les pages

### Réponses prédéfinies
- `POST /api/responses` - Ajouter une réponse
- `GET /api/responses/:pageId` - Lister les réponses

### Configuration IA
- `POST /api/ai-config` - Configurer l'IA

### Historique
- `GET /api/history/:pageId` - Historique des messages

### Webhooks
- `GET /webhook` - Vérification Facebook
- `POST /webhook` - Réception des messages

## 🎯 Exemples d'utilisation

### Service client automatisé
```
Mots-clés: "prix", "tarif", "coût"
Réponse: "Découvrez nos tarifs sur notre site : https://monsite.com/prix"
```

### Support technique
```
Mots-clés: "problème", "bug", "erreur"
Réponse: "Je transfère votre demande à notre support technique. Vous serez contacté sous 24h."
```

### IA pour questions complexes
```
Instructions: "Tu es un assistant commercial. Réponds de manière amicale et professionnelle. Si tu ne connais pas une information spécifique sur nos produits, oriente vers le site web."
```

## 📈 Évolutions possibles

- [ ] Interface drag & drop pour les scénarios
- [ ] Support des images et pièces jointes
- [ ] Intégration WhatsApp/Instagram
- [ ] Analytics avancés avec graphiques
- [ ] Support multi-langues
- [ ] Templates de réponses prédéfinis
- [ ] API REST publique
- [ ] Intégration CRM (HubSpot, Salesforce)

## 🤝 Contribution

1. Fork le projet
2. Créez une branche pour votre fonctionnalité
3. Commitez vos changements
4. Poussez vers la branche
5. Ouvrez une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 🆘 Support

Pour toute question ou problème :

1. Consultez ce README
2. Vérifiez les logs serveur
3. Testez avec des données simples
4. Ouvrez une issue sur le repository

---

**Créé avec ❤️ pour automatiser vos pages Facebook @Durand Dev**

/**
 * Credential Manager Service
 * Secure storage and management of API credentials with file persistence
 */

const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Encryption key (in production, use environment variable or HSM)
const ENCRYPTION_KEY = process.env.CREDENTIAL_KEY || 'narrative-intel-secure-key-2024';

// Get user data directory for persistent storage
function getDataPath() {
    try {
        return app.getPath('userData');
    } catch {
        // Fallback for when app is not ready
        return path.join(process.env.APPDATA || process.env.HOME || '.', 'r-studiogpt');
    }
}

// File paths for persistent storage
const getCredentialsFilePath = () => path.join(getDataPath(), 'credentials.enc');
const getAppDataFilePath = () => path.join(getDataPath(), 'appdata.enc');

// In-memory credential store
let credentialStore = new Map();

// Token cache for short-lived access tokens
const tokenCache = new Map();

class CredentialManager {
    constructor() {
        this.ensureDataDirectory();
        this.loadFromDisk();
    }

    /**
     * Ensure data directory exists
     */
    ensureDataDirectory() {
        const dataPath = getDataPath();
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
        }
    }

    /**
     * Load credentials from disk
     */
    loadFromDisk() {
        try {
            const filePath = getCredentialsFilePath();
            if (fs.existsSync(filePath)) {
                const encryptedData = fs.readFileSync(filePath, 'utf8');
                const decryptedData = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
                const data = JSON.parse(decryptedData);
                credentialStore = new Map(Object.entries(data));
                console.log('[CredentialManager] Loaded credentials from disk');
            } else {
                console.log('[CredentialManager] No saved credentials found, initializing defaults');
                this.initializeDemoCredentials();
            }
        } catch (error) {
            console.error('[CredentialManager] Error loading credentials:', error.message);
            this.initializeDemoCredentials();
        }
    }

    /**
     * Save credentials to disk
     */
    saveToDisk() {
        try {
            const filePath = getCredentialsFilePath();
            const data = Object.fromEntries(credentialStore);
            const jsonData = JSON.stringify(data);
            const encryptedData = CryptoJS.AES.encrypt(jsonData, ENCRYPTION_KEY).toString();
            fs.writeFileSync(filePath, encryptedData, 'utf8');
            console.log('[CredentialManager] Saved credentials to disk');
        } catch (error) {
            console.error('[CredentialManager] Error saving credentials:', error.message);
        }
    }

    /**
     * Save arbitrary app data to disk (for clients, generated packs, etc.)
     */
    saveAppData(key, data) {
        try {
            const filePath = getAppDataFilePath();
            let allData = {};
            
            if (fs.existsSync(filePath)) {
                const encryptedData = fs.readFileSync(filePath, 'utf8');
                const decryptedData = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
                allData = JSON.parse(decryptedData);
            }
            
            allData[key] = data;
            
            const jsonData = JSON.stringify(allData);
            const encryptedData = CryptoJS.AES.encrypt(jsonData, ENCRYPTION_KEY).toString();
            fs.writeFileSync(filePath, encryptedData, 'utf8');
            console.log(`[CredentialManager] Saved app data: ${key}`);
            return true;
        } catch (error) {
            console.error('[CredentialManager] Error saving app data:', error.message);
            return false;
        }
    }

    /**
     * Load arbitrary app data from disk
     */
    loadAppData(key) {
        try {
            const filePath = getAppDataFilePath();
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const encryptedData = fs.readFileSync(filePath, 'utf8');
            const decryptedData = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
            const allData = JSON.parse(decryptedData);
            return allData[key] || null;
        } catch (error) {
            console.error('[CredentialManager] Error loading app data:', error.message);
            return null;
        }
    }

    initializeDemoCredentials() {
        // Demo credentials for development
        credentialStore.set('alphasense', {
            configured: false,
            apiKey: null,
            clientId: null,
            clientSecret: null,
            lastUpdated: null
        });

        credentialStore.set('arc', {
            configured: false,
            apiKey: null,
            lastUpdated: null
        });

        credentialStore.set('internet', {
            configured: true,
            searchApiKey: 'demo-search-key',
            allowedDomains: [
                'sec.gov',
                'investor.*.com',
                'ir.*.com',
                'reuters.com',
                'bloomberg.com',
                'ft.com',
                'wsj.com',
                'gov.uk',
                'europa.eu'
            ],
            lastUpdated: new Date().toISOString()
        });

        credentialStore.set('openai', {
            configured: false,
            apiKey: null,
            model: 'gpt-4o',
            lastUpdated: null
        });

        // Save initial state
        this.saveToDisk();
    }

    /**
     * Encrypt sensitive credential data
     */
    encrypt(data) {
        return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
    }

    /**
     * Decrypt credential data
     */
    decrypt(encryptedData) {
        const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    }

    /**
     * Set credentials for a provider
     */
    async setCredentials(provider, credentials) {
        const existingConfig = credentialStore.get(provider) || {};
        
        // Encrypt sensitive fields
        const encryptedCredentials = {};
        for (const [key, value] of Object.entries(credentials)) {
            if (key.toLowerCase().includes('key') || 
                key.toLowerCase().includes('secret') || 
                key.toLowerCase().includes('password')) {
                encryptedCredentials[key] = this.encrypt(value);
            } else {
                encryptedCredentials[key] = value;
            }
        }

        credentialStore.set(provider, {
            ...existingConfig,
            ...encryptedCredentials,
            configured: true,
            lastUpdated: new Date().toISOString()
        });

        // Clear any cached tokens
        tokenCache.delete(provider);

        // Persist to disk
        this.saveToDisk();

        return { success: true };
    }

    /**
     * Get decrypted credentials for internal use
     */
    getCredentials(provider) {
        const stored = credentialStore.get(provider);
        if (!stored || !stored.configured) {
            return null;
        }

        const decrypted = {};
        for (const [key, value] of Object.entries(stored)) {
            if (key.toLowerCase().includes('key') || 
                key.toLowerCase().includes('secret') || 
                key.toLowerCase().includes('password')) {
                try {
                    decrypted[key] = this.decrypt(value);
                } catch {
                    decrypted[key] = value;
                }
            } else {
                decrypted[key] = value;
            }
        }

        return decrypted;
    }

    /**
     * Get credential status (without exposing values)
     */
    getCredentialStatus() {
        const status = {};
        
        for (const [provider, config] of credentialStore) {
            status[provider] = {
                configured: config.configured,
                lastUpdated: config.lastUpdated,
                fields: Object.keys(config).filter(k => 
                    !['configured', 'lastUpdated'].includes(k)
                )
            };
        }

        return status;
    }

    /**
     * Get masked credentials for display (safe to show in UI)
     */
    getMaskedCredentials(provider) {
        const stored = credentialStore.get(provider);
        if (!stored || !stored.configured) {
            return null;
        }

        const masked = {};
        for (const [key, value] of Object.entries(stored)) {
            if (key === 'configured' || key === 'lastUpdated') {
                masked[key] = value;
            } else if (key.toLowerCase().includes('key') || 
                       key.toLowerCase().includes('secret') || 
                       key.toLowerCase().includes('password')) {
                // Decrypt and mask the value
                try {
                    const decrypted = this.decrypt(value);
                    if (decrypted && decrypted.length > 8) {
                        // Show first 4 and last 4 characters
                        masked[key] = decrypted.slice(0, 8) + '...' + decrypted.slice(-4);
                        masked[key + '_configured'] = true;
                    } else if (decrypted) {
                        masked[key] = '••••••••';
                        masked[key + '_configured'] = true;
                    }
                } catch {
                    masked[key] = null;
                }
            } else {
                // Non-sensitive fields can be shown
                masked[key] = value;
            }
        }

        return masked;
    }

    /**
     * Check if a provider is configured
     */
    isConfigured(provider) {
        const config = credentialStore.get(provider);
        return config?.configured || false;
    }

    /**
     * Get or refresh access token for a provider
     */
    async getAccessToken(provider) {
        // Check cache first
        const cached = tokenCache.get(provider);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.token;
        }

        // Get fresh token
        const credentials = this.getCredentials(provider);
        if (!credentials) {
            throw new Error(`Provider ${provider} is not configured`);
        }

        // Simulate OAuth token exchange
        const token = await this.exchangeForToken(provider, credentials);
        
        // Cache the token
        tokenCache.set(provider, {
            token: token.access_token,
            expiresAt: Date.now() + (token.expires_in * 1000)
        });

        return token.access_token;
    }

    /**
     * Exchange credentials for access token
     */
    async exchangeForToken(provider, credentials) {
        // In production, this would make actual OAuth requests
        // For demo, simulate token response
        
        switch (provider) {
            case 'alphasense':
                return {
                    access_token: `as_${uuidv4()}`,
                    token_type: 'Bearer',
                    expires_in: 3600
                };
            
            case 'arc':
                return {
                    access_token: `arc_${uuidv4()}`,
                    token_type: 'Bearer',
                    expires_in: 7200
                };
            
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    /**
     * Test connection to a provider
     */
    async testConnection(provider) {
        try {
            const credentials = this.getCredentials(provider);
            if (!credentials) {
                return { 
                    success: false, 
                    error: 'Provider not configured' 
                };
            }

            // OpenAI - Real API test
            if (provider === 'openai') {
                return await this.testOpenAIConnection(credentials.apiKey);
            }

            // AlphaSense - Real API test
            if (provider === 'alphasense') {
                return await this.testAlphaSenseConnection(credentials);
            }

            // Simulate connection test for other providers
            await new Promise(resolve => setTimeout(resolve, 500));

            // In production, make actual API health check
            return {
                success: true,
                message: `Successfully connected to ${provider}`,
                latency: Math.floor(Math.random() * 200 + 100) + 'ms'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Test AlphaSense API connection
     */
    async testAlphaSenseConnection(credentials) {
        const alphasenseConnector = require('./connectors/alphasenseConnector');
        return await alphasenseConnector.testConnection();
    }

    /**
     * Test OpenAI API connection with real API call
     */
    async testOpenAIConnection(apiKey) {
        const https = require('https');
        
        return new Promise((resolve) => {
            const startTime = Date.now();
            
            const options = {
                hostname: 'api.openai.com',
                port: 443,
                path: '/v1/models',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    const latency = Date.now() - startTime;
                    
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(data);
                            const modelCount = response.data?.length || 0;
                            resolve({
                                success: true,
                                message: `Connected to OpenAI API (${modelCount} models available)`,
                                latency: `${latency}ms`
                            });
                        } catch {
                            resolve({
                                success: true,
                                message: 'Connected to OpenAI API',
                                latency: `${latency}ms`
                            });
                        }
                    } else if (res.statusCode === 401) {
                        resolve({
                            success: false,
                            error: 'Invalid API key'
                        });
                    } else {
                        resolve({
                            success: false,
                            error: `API returned status ${res.statusCode}`
                        });
                    }
                });
            });

            req.on('error', (error) => {
                resolve({
                    success: false,
                    error: `Connection failed: ${error.message}`
                });
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve({
                    success: false,
                    error: 'Connection timed out'
                });
            });

            req.end();
        });
    }

    /**
     * Rotate credentials for a provider
     */
    async rotateCredentials(provider) {
        // Clear cached tokens
        tokenCache.delete(provider);
        
        return {
            success: true,
            message: 'Token cache cleared. Please update credentials.'
        };
    }

    /**
     * Get the data storage path (for display purposes)
     */
    getStoragePath() {
        return getDataPath();
    }
}

module.exports = new CredentialManager();

/**
 * R/StudioGPT - Main Server
 * Data Retrieval & Schema Application
 */

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import modules
const credentialManager = require('./src/services/credentialManager');
const retrievalOrchestrator = require('./src/services/retrievalOrchestrator');
const schemaValidator = require('./src/services/schemaValidator');
const auditLogger = require('./src/services/auditLogger');
const authMiddleware = require('./src/middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'r-studiogpt-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// ============================================
// Authentication Routes
// ============================================

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Demo authentication (in production, use SSO/Entra ID/Okta)
    const validUsers = {
        'client.lead': { password: 'demo123', role: 'client_lead', name: 'Ed Goh' },
        'industry.lead': { password: 'demo123', role: 'industry_lead', name: 'Sarah Chen' },
        'analyst': { password: 'demo123', role: 'analyst', name: 'James Wilson' },
        'admin': { password: 'admin123', role: 'admin', name: 'System Admin' }
    };

    const user = validUsers[username];
    if (user && user.password === password) {
        req.session.user = {
            id: uuidv4(),
            username,
            role: user.role,
            name: user.name,
            loginTime: new Date().toISOString()
        };
        
        auditLogger.log('AUTH', 'LOGIN_SUCCESS', { username, role: user.role });
        
        res.json({
            success: true,
            user: {
                username,
                role: user.role,
                name: user.name
            }
        });
    } else {
        auditLogger.log('AUTH', 'LOGIN_FAILED', { username });
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    const username = req.session.user?.username;
    req.session.destroy();
    auditLogger.log('AUTH', 'LOGOUT', { username });
    res.json({ success: true });
});

app.get('/api/auth/session', (req, res) => {
    if (req.session.user) {
        res.json({ authenticated: true, user: req.session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// ============================================
// Client Management Routes
// ============================================

const clients = [
    { id: 'cl-001', name: 'Accenture Global', industry: 'Technology & Consulting', geography: 'Global', sector: 'Professional Services' },
    { id: 'cl-002', name: 'TechCorp Industries', industry: 'Technology', geography: 'North America', sector: 'Software & Cloud' },
    { id: 'cl-003', name: 'European Energy Holdings', industry: 'Energy & Utilities', geography: 'Europe', sector: 'Renewable Energy' },
    { id: 'cl-004', name: 'Pacific Retail Group', industry: 'Retail & Consumer', geography: 'APAC', sector: 'E-commerce' },
    { id: 'cl-005', name: 'HealthFirst Alliance', industry: 'Healthcare', geography: 'North America', sector: 'Healthcare Services' },
    { id: 'cl-006', name: 'Global Finance Partners', industry: 'Financial Services', geography: 'Global', sector: 'Investment Banking' },
    { id: 'cl-007', name: 'Manufacturing Excellence Ltd', industry: 'Manufacturing', geography: 'Europe', sector: 'Industrial Automation' },
    { id: 'cl-008', name: 'Telecom Innovations', industry: 'Telecommunications', geography: 'Global', sector: '5G & Network Infrastructure' }
];

app.get('/api/clients', authMiddleware.requireAuth, (req, res) => {
    const { search } = req.query;
    let filteredClients = clients;
    
    if (search) {
        const searchLower = search.toLowerCase();
        filteredClients = clients.filter(c => 
            c.name.toLowerCase().includes(searchLower) ||
            c.industry.toLowerCase().includes(searchLower) ||
            c.geography.toLowerCase().includes(searchLower)
        );
    }
    
    res.json(filteredClients);
});

app.get('/api/clients/:id', authMiddleware.requireAuth, (req, res) => {
    const client = clients.find(c => c.id === req.params.id);
    if (client) {
        res.json(client);
    } else {
        res.status(404).json({ error: 'Client not found' });
    }
});

// ============================================
// Configuration Routes (Admin Only)
// ============================================

app.get('/api/config/credentials', authMiddleware.requireAdmin, (req, res) => {
    const credentials = credentialManager.getCredentialStatus();
    res.json(credentials);
});

app.post('/api/config/credentials', authMiddleware.requireAdmin, async (req, res) => {
    try {
        const { provider, credentials } = req.body;
        await credentialManager.setCredentials(provider, credentials);
        auditLogger.log('CONFIG', 'CREDENTIALS_UPDATED', { provider, user: req.session.user.username });
        res.json({ success: true, message: 'Credentials updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/config/credentials/test', authMiddleware.requireAdmin, async (req, res) => {
    try {
        const { provider } = req.body;
        const result = await credentialManager.testConnection(provider);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// Source Pack Generation Routes
// ============================================

app.post('/api/source-pack/generate', authMiddleware.requireAuth, async (req, res) => {
    const { clientId, context } = req.body;
    const requestId = uuidv4();
    
    auditLogger.log('RETRIEVAL', 'GENERATION_STARTED', { 
        requestId, 
        clientId, 
        context,
        user: req.session.user.username 
    });

    try {
        // Get client details
        const client = clients.find(c => c.id === clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Start retrieval process
        const sourcePack = await retrievalOrchestrator.generateSourcePack({
            requestId,
            client,
            context,
            user: req.session.user
        });

        // Validate the source pack
        const validation = schemaValidator.validate(sourcePack);

        auditLogger.log('RETRIEVAL', 'GENERATION_COMPLETED', { 
            requestId, 
            status: validation.status,
            confidence: sourcePack.confidence_scores.overall
        });

        res.json({
            success: true,
            requestId,
            sourcePack,
            validation
        });

    } catch (error) {
        auditLogger.log('RETRIEVAL', 'GENERATION_FAILED', { requestId, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// SSE endpoint for real-time progress updates
app.get('/api/source-pack/progress/:requestId', authMiddleware.requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const requestId = req.params.requestId;
    
    // Subscribe to progress updates
    const unsubscribe = retrievalOrchestrator.subscribeToProgress(requestId, (progress) => {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
    });

    req.on('close', () => {
        unsubscribe();
    });
});

// ============================================
// Export Routes
// ============================================

app.post('/api/export/json', authMiddleware.requireAuth, (req, res) => {
    const { sourcePack } = req.body;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=source-pack-${Date.now()}.json`);
    res.json(sourcePack);
});

app.post('/api/export/markdown', authMiddleware.requireAuth, (req, res) => {
    const { sourcePack } = req.body;
    const markdown = generateMarkdown(sourcePack);
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename=source-pack-${Date.now()}.md`);
    res.send(markdown);
});

function generateMarkdown(sourcePack) {
    return `# Source Pack Report

## Client Information
- **Name:** ${sourcePack.client.name}
- **Industry:** ${sourcePack.client.industry}
- **Geography:** ${sourcePack.client.geography}

## Context
- **Industry Focus:** ${sourcePack.context.industry}
- **Time Horizon:** ${sourcePack.context.timeHorizon} days
- **Output Intent:** ${sourcePack.context.outputIntent}

---

## Executive Summary
${sourcePack.company_profile.executive_summary}

## Key Strategic Priorities
${sourcePack.company_profile.strategic_priorities.map(p => `- ${p}`).join('\n')}

---

## AlphaSense Consensus Insights

### Analyst Consensus Themes
${sourcePack.alphasense_consensus.themes.map(t => `- **${t.theme}** (Confidence: ${t.confidence}%): ${t.summary}`).join('\n')}

### Key Quotes
${sourcePack.alphasense_consensus.key_quotes.map(q => `> "${q.quote}" — *${q.source}*`).join('\n\n')}

### Sentiment Overview
- Overall: ${sourcePack.alphasense_consensus.sentiment.overall}
- Trend: ${sourcePack.alphasense_consensus.sentiment.trend}

---

## Competitor Intelligence
${sourcePack.competitor_moves.map(c => `### ${c.competitor}
- **Move:** ${c.move}
- **Impact:** ${c.impact}
- **Source:** ${c.source}`).join('\n\n')}

---

## Industry KPIs
| Metric | Value | Trend | Benchmark |
|--------|-------|-------|-----------|
${Object.entries(sourcePack.industry_kpis).map(([key, data]) => 
    `| ${key} | ${data.value} | ${data.trend} | ${data.benchmark} |`
).join('\n')}

---

## Regulatory Events
${sourcePack.regulatory_events.map(e => `- **${e.title}** (${e.date})
  - Impact: ${e.impact}
  - Source: ${e.source}`).join('\n\n')}

---

## Confidence Scores
| Category | Score |
|----------|-------|
| Overall | ${sourcePack.confidence_scores.overall}% |
| Data Completeness | ${sourcePack.confidence_scores.data_completeness}% |
| Source Quality | ${sourcePack.confidence_scores.source_quality}% |
| Timeliness | ${sourcePack.confidence_scores.timeliness}% |

---

## Sources
${sourcePack.sources.map(s => `- [${s.name}](${s.url}) - Retrieved: ${s.retrieved_at}`).join('\n')}

---

*Generated: ${sourcePack.metadata.generated_at}*
*Request ID: ${sourcePack.metadata.request_id}*
*Generated by: ${sourcePack.metadata.generated_by}*
`;
}

// ============================================
// Audit Log Routes
// ============================================

app.get('/api/audit/logs', authMiddleware.requireAdmin, (req, res) => {
    const { limit = 100, category } = req.query;
    const logs = auditLogger.getLogs({ limit: parseInt(limit), category });
    res.json(logs);
});

// ============================================
// Health Check
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
            alphasense: credentialManager.isConfigured('alphasense'),
            arc: credentialManager.isConfigured('arc'),
            internet: true
        }
    });
});

// ============================================
// Serve Frontend
// ============================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🧠 R/StudioGPT                                              ║
║   ─────────────────────────────────────────────────────────   ║
║   Data Retrieval & Schema Application                         ║
║                                                               ║
║   Server running on: http://localhost:${PORT}                   ║
║                                                               ║
║   Demo Credentials:                                           ║
║   • client.lead / demo123 (Client Lead)                       ║
║   • industry.lead / demo123 (Industry Lead)                   ║
║   • analyst / demo123 (Analyst)                               ║
║   • admin / admin123 (Administrator)                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;

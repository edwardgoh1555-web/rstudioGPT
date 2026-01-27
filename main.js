/**
 * R/StudioGPT
 * Electron Main Process - Standalone Desktop Application
 */

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
const PptxGenJS = require('pptxgenjs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
// Note: pdf-parse, mammoth, xlsx are loaded lazily in extractDocumentText() 
// to avoid DOMMatrix errors in Electron main process

// ============================================
// Document Text Extraction Utility
// ============================================
/**
 * Extract readable text from various document formats
 * @param {Buffer|string} content - File content
 * @param {string} fileName - Original filename (used to detect type)
 * @returns {Promise<{text: string, converted: boolean, newFileName: string}>}
 */
async function extractDocumentText(content, fileName) {
    const ext = path.extname(fileName).toLowerCase();
    let buffer = content;
    
    // Ensure we have a Buffer
    if (typeof buffer === 'string') {
        buffer = Buffer.from(buffer, 'utf-8');
    } else if (buffer && typeof buffer === 'object' && buffer.data) {
        buffer = Buffer.from(buffer.data);
    }
    
    // Text files - no conversion needed
    if (['.txt', '.md', '.csv', '.json'].includes(ext)) {
        return {
            text: buffer.toString('utf-8'),
            converted: false,
            newFileName: fileName
        };
    }
    
    // PDF extraction using pdfjs-dist (Mozilla's PDF.js for Node.js)
    if (ext === '.pdf') {
        try {
            // Use pdfjs-dist legacy build which works in Node.js without canvas
            const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
            
            // Disable worker for Node.js environment
            pdfjsLib.GlobalWorkerOptions.workerSrc = '';
            
            // Load the PDF from buffer
            const uint8Array = new Uint8Array(buffer);
            const loadingTask = pdfjsLib.getDocument({
                data: uint8Array,
                useSystemFonts: true,
                disableFontFace: true,
                verbosity: 0 // Suppress warnings
            });
            
            const pdf = await loadingTask.promise;
            console.log(`[DocParser] PDF loaded: ${fileName}, ${pdf.numPages} pages`);
            
            let fullText = '';
            
            // Extract text from each page
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                
                // Build text with proper spacing
                let lastY = null;
                let pageText = '';
                
                for (const item of textContent.items) {
                    if (item.str) {
                        // Check if we need a newline (new Y position)
                        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                            pageText += '\n';
                        } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
                            pageText += ' ';
                        }
                        pageText += item.str;
                        lastY = item.transform[5];
                    }
                }
                
                fullText += pageText + '\n\n';
            }
            
            // Clean up the text
            fullText = fullText
                .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
                .replace(/[ \t]+/g, ' ')     // Normalize spaces
                .trim();
            
            if (fullText.length === 0) {
                return {
                    text: `# Content from ${fileName}\n\n*Note: PDF appears to be image-based or empty. Text could not be extracted.*`,
                    converted: true,
                    newFileName: fileName.replace(/\.pdf$/i, '.md')
                };
            }
            
            console.log(`[DocParser] PDF extracted successfully: ${fileName} (${fullText.length} chars)`);
            return {
                text: `# Content from ${fileName}\n\n${fullText}`,
                converted: true,
                newFileName: fileName.replace(/\.pdf$/i, '.md')
            };
        } catch (err) {
            console.error('[DocParser] PDF extraction error:', err.message);
            return {
                text: `# Content from ${fileName}\n\n*Error extracting PDF: ${err.message}*`,
                converted: true,
                newFileName: fileName.replace(/\.pdf$/i, '_error.md')
            };
        }
    }
    
    // Word document extraction (.docx)
    if (ext === '.docx') {
        try {
            // Lazy load mammoth
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            const text = result.value || '';
            if (text.trim().length === 0) {
                return {
                    text: `# Content from ${fileName}\n\n*Note: Document appears to be empty.*`,
                    converted: true,
                    newFileName: fileName.replace(/\.docx$/i, '.md')
                };
            }
            return {
                text: `# Content from ${fileName}\n\n${text}`,
                converted: true,
                newFileName: fileName.replace(/\.docx$/i, '.md')
            };
        } catch (err) {
            console.error('[DocParser] DOCX extraction error:', err.message);
            return {
                text: `# Content from ${fileName}\n\n*Error extracting DOCX: ${err.message}*`,
                converted: true,
                newFileName: fileName.replace(/\.docx$/i, '_error.md')
            };
        }
    }
    
    // Legacy Word document (.doc) - limited support
    if (ext === '.doc') {
        // .doc format is complex binary, mammoth doesn't support it well
        // Return a note suggesting conversion
        return {
            text: `# Content from ${fileName}\n\n*Note: Legacy .doc format has limited support. Please convert to .docx for full text extraction.*`,
            converted: true,
            newFileName: fileName.replace(/\.doc$/i, '.md')
        };
    }
    
    // Excel extraction (.xlsx, .xls)
    if (['.xlsx', '.xls'].includes(ext)) {
        try {
            // Lazy load xlsx
            const XLSX = require('xlsx');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let allText = `# Content from ${fileName}\n\n`;
            
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const csvText = XLSX.utils.sheet_to_csv(sheet);
                allText += `## Sheet: ${sheetName}\n\n\`\`\`\n${csvText}\n\`\`\`\n\n`;
            }
            
            return {
                text: allText,
                converted: true,
                newFileName: fileName.replace(/\.xlsx?$/i, '.md')
            };
        } catch (err) {
            console.error('[DocParser] Excel extraction error:', err.message);
            return {
                text: `# Content from ${fileName}\n\n*Error extracting Excel: ${err.message}*`,
                converted: true,
                newFileName: fileName.replace(/\.xlsx?$/i, '_error.md')
            };
        }
    }
    
    // PowerPoint extraction (.pptx)
    if (ext === '.pptx') {
        try {
            const zip = new PizZip(buffer);
            let allText = `# Content from ${fileName}\n\n`;
            let slideNum = 1;
            
            // PPTX stores slides in ppt/slides/slide*.xml
            const slideFiles = Object.keys(zip.files)
                .filter(name => name.match(/ppt\/slides\/slide\d+\.xml$/))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/slide(\d+)/)[1]);
                    const numB = parseInt(b.match(/slide(\d+)/)[1]);
                    return numA - numB;
                });
            
            for (const slideFile of slideFiles) {
                const slideXml = zip.file(slideFile).asText();
                // Extract text from XML (simple regex approach)
                const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
                const slideTexts = textMatches.map(m => m.replace(/<\/?a:t>/g, '')).filter(t => t.trim());
                
                if (slideTexts.length > 0) {
                    allText += `## Slide ${slideNum}\n\n${slideTexts.join('\n')}\n\n`;
                }
                slideNum++;
            }
            
            if (slideNum === 1) {
                allText += '*No text content found in presentation.*\n';
            }
            
            return {
                text: allText,
                converted: true,
                newFileName: fileName.replace(/\.pptx$/i, '.md')
            };
        } catch (err) {
            console.error('[DocParser] PPTX extraction error:', err.message);
            return {
                text: `# Content from ${fileName}\n\n*Error extracting PowerPoint: ${err.message}*`,
                converted: true,
                newFileName: fileName.replace(/\.pptx$/i, '_error.md')
            };
        }
    }
    
    // Legacy PowerPoint (.ppt) - not supported
    if (ext === '.ppt') {
        return {
            text: `# Content from ${fileName}\n\n*Note: Legacy .ppt format is not supported. Please convert to .pptx for text extraction.*`,
            converted: true,
            newFileName: fileName.replace(/\.ppt$/i, '.md')
        };
    }
    
    // Unknown format - return as-is (binary)
    return {
        text: null,
        converted: false,
        newFileName: fileName
    };
}

// Clear GPU cache to prevent "Access is denied" errors on startup
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Get the correct base path for packaged vs development
const getBasePath = () => {
    // In packaged app, use app.getAppPath()
    // In development, use __dirname
    if (app.isPackaged) {
        return app.getAppPath();
    }
    return __dirname;
};

// Clear stale cache locks on startup
function clearStaleCacheLocks() {
    try {
        const userDataPath = app.getPath('userData');
        const gpuCachePath = path.join(userDataPath, 'GPUCache');
        const shaderCachePath = path.join(userDataPath, 'ShaderCache');
        
        // Remove GPU cache directory if it exists
        if (fs.existsSync(gpuCachePath)) {
            fs.rmSync(gpuCachePath, { recursive: true, force: true });
        }
        if (fs.existsSync(shaderCachePath)) {
            fs.rmSync(shaderCachePath, { recursive: true, force: true });
        }
    } catch (e) {
        // Ignore errors - cache will be recreated
    }
}

// Clear cache before app is ready
clearStaleCacheLocks();

// Import services
const credentialManager = require('./src/services/credentialManager');
const retrievalOrchestrator = require('./src/services/retrievalOrchestrator');
const schemaValidator = require('./src/services/schemaValidator');
const auditLogger = require('./src/services/auditLogger');
const alphasenseConnector = require('./src/services/connectors/alphasenseConnector');
const arcConnector = require('./src/services/connectors/arcConnector');

// Keep a global reference of the window object
let mainWindow;

// Helper function to emit AI console logs to the frontend
function emitAiConsoleLog(agent, message, type = 'info') {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
        mainWindow.webContents.send('ai-console-log', {
            timestamp,
            agent,
            message,
            type // 'info', 'thinking', 'success', 'error'
        });
    }
}

// Default clients (used if no saved data) - Real Accenture blue chip clients
const defaultClients = [
    { id: 'cl-001', name: 'Vodafone Group PLC', industry: 'Telecommunications', geography: 'Europe', sector: 'Mobile & Fixed Communications' },
    { id: 'cl-002', name: 'Unilever PLC', industry: 'Consumer Goods', geography: 'Europe', sector: 'FMCG & Personal Care' },
    { id: 'cl-003', name: 'BP PLC', industry: 'Energy', geography: 'Europe', sector: 'Oil & Gas, Low Carbon Energy' },
    { id: 'cl-004', name: 'Lloyds Banking Group PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Retail & Commercial Banking' },
    { id: 'cl-005', name: 'GlaxoSmithKline PLC', industry: 'Healthcare', geography: 'Europe', sector: 'Pharmaceuticals & Consumer Health' },
    { id: 'cl-006', name: 'Rio Tinto Group', industry: 'Mining & Metals', geography: 'Global', sector: 'Mining & Natural Resources' },
    { id: 'cl-007', name: 'Schneider Electric SE', industry: 'Industrial', geography: 'Europe', sector: 'Energy Management & Automation' },
    { id: 'cl-008', name: 'Marriott International', industry: 'Hospitality', geography: 'North America', sector: 'Hotels & Lodging' },
    { id: 'cl-009', name: 'Philips N.V.', industry: 'Healthcare Technology', geography: 'Europe', sector: 'Health Technology & Consumer Electronics' },
    { id: 'cl-010', name: 'Deutsche Telekom AG', industry: 'Telecommunications', geography: 'Europe', sector: 'Integrated Telecommunications' }
];

// Application state - load persisted data
const appState = {
    user: credentialManager.loadAppData('userSession') || null, // Persist login session
    clients: credentialManager.loadAppData('clients') || [...defaultClients],
    workshopTemplates: credentialManager.loadAppData('workshopTemplates') || {
        pptx: null,  // { filename, content (base64), uploadedAt }
        docx: null
    },
    placeholders: credentialManager.loadAppData('placeholders') || [],
    narrativeCancelled: false,  // Flag for cancelling narrative generation
    // Each placeholder: { id, name, prompt, createdAt }
    
    // Learnings system - stores user preferences inferred from behavior
    learnings: credentialManager.loadAppData('narrativeLearnings') || getDefaultLearnings()
};

// ============================================
// Narrative Learning System
// ============================================

/**
 * Returns the default learnings structure
 */
function getDefaultLearnings() {
    return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        lastInferenceRun: null,
        
        // Aggregate preferences learned from behavior
        preferences: {
            tone: {
                preferred: [],
                avoid: [],
                confidence: 0.0,
                evidenceCount: 0
            },
            structure: {
                preferredLength: null,
                useBulletPoints: null,
                preferredSections: [],
                weakSections: [],
                confidence: 0.0,
                evidenceCount: 0
            },
            content: {
                emphasize: [],
                avoid: [],
                confidence: 0.0,
                evidenceCount: 0
            },
            vocabulary: {
                preferred: [],
                avoid: [],
                replacements: {},
                confidence: 0.0,
                evidenceCount: 0
            }
        },
        
        // Section-specific learnings
        sectionPatterns: {},
        
        // Client/Industry specific learnings
        contextual: {
            byIndustry: {},
            byClient: {}
        },
        
        // Raw evidence log (for reprocessing/auditing)
        evidenceLog: [],
        
        // Statistics
        stats: {
            totalIterations: 0,
            totalAcceptances: 0,
            totalNarrativesGenerated: 0,
            avgIterationsPerNarrative: 0
        }
    };
}

/**
 * Save learnings to persistent storage (debounced to prevent excessive disk writes)
 */
let saveLearningsTimeout = null;
function saveLearnings() {
    // Debounce: wait 2 seconds after last call before actually saving
    if (saveLearningsTimeout) {
        clearTimeout(saveLearningsTimeout);
    }
    saveLearningsTimeout = setTimeout(() => {
        appState.learnings.lastUpdated = new Date().toISOString();
        credentialManager.saveAppData('narrativeLearnings', appState.learnings);
        console.log('[Learnings] Saved to disk');
        saveLearningsTimeout = null;
    }, 2000);
}

/**
 * Force immediate save (for shutdown or critical operations)
 */
function saveLearningsImmediate() {
    if (saveLearningsTimeout) {
        clearTimeout(saveLearningsTimeout);
        saveLearningsTimeout = null;
    }
    appState.learnings.lastUpdated = new Date().toISOString();
    credentialManager.saveAppData('narrativeLearnings', appState.learnings);
    console.log('[Learnings] Saved to disk (immediate)');
}

/**
 * Capture a behavioral signal from user interaction
 */
function captureSignal(signal) {
    // Add timestamp if not present
    if (!signal.timestamp) {
        signal.timestamp = new Date().toISOString();
    }
    
    // Add to evidence log
    appState.learnings.evidenceLog.push(signal);
    
    // Keep only last 500 signals to prevent unbounded growth
    if (appState.learnings.evidenceLog.length > 500) {
        appState.learnings.evidenceLog = appState.learnings.evidenceLog.slice(-500);
    }
    
    // Update statistics
    if (signal.type === 'iteration') {
        appState.learnings.stats.totalIterations++;
    } else if (signal.type === 'acceptance') {
        appState.learnings.stats.totalAcceptances++;
    } else if (signal.type === 'generation') {
        appState.learnings.stats.totalNarrativesGenerated++;
    }
    
    // Calculate average iterations per narrative
    if (appState.learnings.stats.totalNarrativesGenerated > 0) {
        appState.learnings.stats.avgIterationsPerNarrative = 
            appState.learnings.stats.totalIterations / appState.learnings.stats.totalNarrativesGenerated;
    }
    
    // Save after each signal
    saveLearnings();
    
    console.log(`[Learnings] Captured signal: ${signal.type}`, signal.section || '');
    
    return signal;
}

// Source chat history (for Step 5 Q&A)
let sourceChatHistory = [];

// Demo users
const validUsers = {
    'client.lead': { password: 'demo123', role: 'client_lead', name: 'Ed Goh' },
    'industry.lead': { password: 'demo123', role: 'industry_lead', name: 'Sarah Chen' },
    'analyst': { password: 'demo123', role: 'analyst', name: 'James Wilson' },
    'admin': { password: 'admin123', role: 'admin', name: 'System Admin' }
};

function createWindow() {
    const basePath = getBasePath();
    
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'R/StudioGPT',
        icon: path.join(basePath, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(basePath, 'preload.js')
        },
        backgroundColor: '#0f0f23',
        show: false, // Don't show until ready
        titleBarStyle: 'default',
        autoHideMenuBar: false
    });

    // Load the app
    mainWindow.loadFile(path.join(basePath, 'public', 'index.html'));

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Show splash message in console
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   � R/StudioGPT                                               ║
║   ─────────────────────────────────────────────────────────   ║
║   Desktop Application v1.0.0                                  ║
║                                                               ║
║   Demo Credentials:                                           ║
║   • client.lead / demo123                                     ║
║   • admin / admin123                                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);
    });

    // Handle window closed
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Create application menu
    createMenu();
}

function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Source Pack',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'new-source-pack');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Export as JSON',
                    accelerator: 'CmdOrCtrl+E',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'export-json');
                    }
                },
                {
                    label: 'Export as Markdown',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'export-markdown');
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Dashboard',
                    accelerator: 'CmdOrCtrl+1',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'view-dashboard');
                    }
                },
                {
                    label: 'Generate',
                    accelerator: 'CmdOrCtrl+2',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'view-generate');
                    }
                },
                {
                    label: 'History',
                    accelerator: 'CmdOrCtrl+3',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'view-history');
                    }
                },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About R/StudioGPT',
                            message: 'R/StudioGPT',
                            detail: 'Version 1.0.0\n\nA governed intelligence assembly tool for generating schema-validated Source Packs from strategic data sources.\n\n© 2026 R/StudioGPT Team'
                        });
                    }
                },
                {
                    label: 'View Schema Documentation',
                    click: () => {
                        mainWindow.webContents.send('menu-action', 'view-schema');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://github.com/r-studiogpt');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ============================================
// IPC Handlers - Communication with Renderer
// ============================================

// Authentication
ipcMain.handle('auth:login', async (event, { username, password }) => {
    const user = validUsers[username];
    if (user && user.password === password) {
        appState.user = {
            id: uuidv4(),
            username,
            role: user.role,
            name: user.name,
            loginTime: new Date().toISOString()
        };
        
        // Persist session to disk so it survives app restart
        credentialManager.saveAppData('userSession', appState.user);
        
        auditLogger.log('AUTH', 'LOGIN_SUCCESS', { username, role: user.role });
        
        return {
            success: true,
            user: {
                username,
                role: user.role,
                name: user.name
            }
        };
    } else {
        auditLogger.log('AUTH', 'LOGIN_FAILED', { username });
        return { success: false, message: 'Invalid credentials' };
    }
});

ipcMain.handle('auth:logout', async () => {
    const username = appState.user?.username;
    appState.user = null;
    
    // Clear persisted session from disk
    credentialManager.saveAppData('userSession', null);
    
    auditLogger.log('AUTH', 'LOGOUT', { username });
    return { success: true };
});

ipcMain.handle('auth:session', async () => {
    if (appState.user) {
        return { authenticated: true, user: appState.user };
    }
    return { authenticated: false };
});

// Clients
ipcMain.handle('clients:list', async (event, { search } = {}) => {
    let filteredClients = appState.clients;
    
    if (search) {
        const searchLower = search.toLowerCase();
        filteredClients = appState.clients.filter(c => 
            c.name.toLowerCase().includes(searchLower) ||
            c.industry.toLowerCase().includes(searchLower) ||
            c.geography.toLowerCase().includes(searchLower)
        );
    }
    
    return filteredClients;
});

ipcMain.handle('clients:get', async (event, { id }) => {
    return appState.clients.find(c => c.id === id);
});

// Delete a client
ipcMain.handle('clients:delete', async (event, { id }) => {
    const clientIndex = appState.clients.findIndex(c => c.id === id);
    if (clientIndex === -1) {
        return { success: false, error: 'Client not found' };
    }
    
    const deletedClient = appState.clients[clientIndex];
    appState.clients.splice(clientIndex, 1);
    
    // Persist the updated clients list
    credentialManager.saveAppData('clients', appState.clients);
    
    auditLogger.log('CLIENT', 'DELETED', { 
        clientId: id,
        clientName: deletedClient.name,
        user: appState.user?.username 
    });
    
    return { success: true, clientName: deletedClient.name };
});

// AI-powered client creation
ipcMain.handle('clients:aiCreate', async (event, { companyName }) => {
    const requestId = uuidv4();
    
    auditLogger.log('CLIENT', 'AI_CREATE_STARTED', { 
        requestId, 
        companyName,
        user: appState.user?.username 
    });
    
    try {
        // Check if OpenAI is configured
        const openaiCreds = credentialManager.getCredentials('openai');
        let aiResult;
        
        if (openaiCreds && openaiCreds.configured && openaiCreds.apiKey) {
            // Use real OpenAI API
            auditLogger.log('CLIENT', 'AI_USING_OPENAI', { requestId, model: openaiCreds.model || 'gpt-5.2' });
            aiResult = await analyzeCompanyWithOpenAI(companyName, openaiCreds.apiKey, openaiCreds.model || 'gpt-5.2');
        } else {
            // Fall back to simulated analysis
            auditLogger.log('CLIENT', 'AI_USING_SIMULATION', { requestId });
            aiResult = await simulateAIClientAnalysis(companyName);
        }
        
        // Create new client object
        const newClient = {
            id: `cl-${Date.now()}`,
            name: aiResult.officialName || companyName,
            industry: aiResult.industry,
            geography: aiResult.geography,
            headquartersCountry: aiResult.headquartersCountry,
            sector: aiResult.sector,
            isGovernment: aiResult.isGovernment || false,
            aiGenerated: true,
            createdAt: new Date().toISOString()
        };
        
        // Add to clients list (at the beginning)
        appState.clients.unshift(newClient);
        
        // Persist clients to disk
        credentialManager.saveAppData('clients', appState.clients);
        
        auditLogger.log('CLIENT', 'AI_CREATE_COMPLETED', { 
            requestId, 
            clientId: newClient.id,
            companyName,
            detectedIndustry: aiResult.industry,
            user: appState.user?.username 
        });
        
        return {
            success: true,
            client: newClient,
            aiAnalysis: aiResult
        };
    } catch (error) {
        auditLogger.log('CLIENT', 'AI_CREATE_FAILED', { 
            requestId, 
            companyName,
            error: error.message,
            user: appState.user?.username 
        });
        
        return {
            success: false,
            error: error.message
        };
    }
});

// Research C-suite contacts for a company using web search
ipcMain.handle('clients:researchContacts', async (event, { client, type }) => {
    // Extract client details for context
    const companyName = client.name || client;
    const geography = client.geography || '';
    const industry = client.industry || '';
    const parentCompany = client.parentCompany || '';
    const headquarters = client.headquarters || '';
    const headquartersCountry = client.headquartersCountry || '';
    const isGovernment = client.isGovernment || false;
    
    console.log(`[Contacts] Researching ${type} contacts for ${companyName} (${headquartersCountry || geography}) via web search...`);
    
    try {
        const openaiCreds = credentialManager.getCredentials('openai');
        
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured', contacts: [] };
        }
        
        // Use headquartersCountry for more specific location context
        const locationContext = headquartersCountry || geography || 'unknown location';
        emitAiConsoleLog('researcher', `Searching web for ${type === 'current' ? 'current C-suite' : 'recently exited leaders'} at ${companyName} (${locationContext})...`, 'info');
        
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        // Build context string for disambiguation - prioritize headquartersCountry for specificity
        let contextString = `"${companyName}"`;
        if (headquartersCountry) {
            contextString += ` in ${headquartersCountry}`;
        } else if (headquarters) {
            contextString += ` headquartered in ${headquarters}`;
        }
        if (geography && !headquartersCountry) {
            contextString += ` (${geography} region)`;
        }
        if (parentCompany) {
            contextString += `, subsidiary of ${parentCompany}`;
        }
        if (industry) {
            contextString += ` in the ${industry} industry`;
        }
        
        // Build government-specific context if applicable
        const govContext = isGovernment ? `
THIS IS A GOVERNMENT ENTITY belonging to ${headquartersCountry || 'a specific country'}.
- Search for "${companyName}" ${headquartersCountry || ''} government officials
- This is NOT the US Department of Defense unless headquartersCountry is "United States"
- This is NOT the UK Ministry of Defence unless headquartersCountry is "United Kingdom"
- Search for the EXACT country's government officials only` : '';
        
        let searchQuery;
        if (type === 'current') {
            searchQuery = `Search the web for the current C-suite executives and senior leadership team at ${contextString}. Today is ${today}.

CRITICAL DISAMBIGUATION - YOU MUST READ THIS:
- The organization is: ${companyName}
${headquartersCountry ? `- COUNTRY: ${headquartersCountry} - THIS IS THE KEY IDENTIFIER. Search ONLY for this country's organization.` : ''}
${isGovernment ? `- TYPE: Government entity of ${headquartersCountry || geography}` : ''}
${geography ? `- Region: ${geography}` : ''}
${headquarters ? `- Headquarters: ${headquarters}` : ''}
${industry ? `- Industry: ${industry}` : ''}
${parentCompany ? `- Parent company: ${parentCompany}` : ''}
${govContext}

DISAMBIGUATION EXAMPLES:
- "Ministry of Defence" + "United Kingdom" = UK MOD (Secretary of State for Defence, Permanent Secretary, etc.)
- "Department of Defense" + "United States" = US DoD (Secretary of Defense, Deputy Secretary, etc.)
- These are COMPLETELY DIFFERENT organizations. Do NOT mix them up.

I need you to find the CURRENT top executives/officials:
${isGovernment ? '- Ministers, Secretaries of State, Permanent Secretaries, Chiefs of Staff, Directors General' : '- CEO, CFO, COO, CTO, CMO, CHRO, CIO, and other C-level or senior positions'}

CRITICAL REQUIREMENTS:
1. You MUST use web search to find current, up-to-date information
2. ONLY include people who are CURRENTLY in these roles (not former officials)
3. DO NOT make up or guess any names - if you can't find someone, don't include them
4. Verify from ${isGovernment ? 'official government websites, gov.uk, parliament records, news sources' : 'company website, LinkedIn, Bloomberg, Reuters, press releases'}
5. For each person, find their name, current title, and a brief background
6. DOUBLE-CHECK: You are searching for ${companyName} in ${headquartersCountry || geography || 'the specified country'} - NOT any other country

Return ONLY a JSON array in this exact format (no other text):
[
  {
    "name": "Full Name",
    "title": "Current Title",
    "bio": "Brief bio - previous role, education, or notable achievement"
  }
]

If you cannot find verified current officials, return: []`;
        } else {
            searchQuery = `Search the web for senior officials who have RECENTLY LEFT or DEPARTED from ${contextString} within the last 2 years. Today is ${today}.

CRITICAL DISAMBIGUATION - YOU MUST READ THIS:
- The organization is: ${companyName}
${headquartersCountry ? `- COUNTRY: ${headquartersCountry} - THIS IS THE KEY IDENTIFIER. Search ONLY for this country's organization.` : ''}
${isGovernment ? `- TYPE: Government entity of ${headquartersCountry || geography}` : ''}
${geography ? `- Region: ${geography}` : ''}
${headquarters ? `- Headquarters: ${headquarters}` : ''}
${industry ? `- Industry: ${industry}` : ''}
${parentCompany ? `- Parent company: ${parentCompany}` : ''}
${govContext}

DISAMBIGUATION EXAMPLES:
- "Ministry of Defence" + "United Kingdom" = UK MOD departures only
- "Department of Defense" + "United States" = US DoD departures only
- These are COMPLETELY DIFFERENT organizations. Do NOT mix them up.

I need to find senior leadership DEPARTURES - people who have stepped down, resigned, retired, or been replaced.
${isGovernment ? 'Look for: Ministers, Secretaries of State, Permanent Secretaries, Chiefs of Staff, Directors General who have left' : 'Look for: CEO, CFO, COO, CTO, and other C-level departures'}

CRITICAL REQUIREMENTS:
1. You MUST use web search to find actual news about departures from ${headquartersCountry || geography || 'this specific'} organization
2. ONLY include people who have ACTUALLY left (not rumors or speculation)
3. DO NOT make up or guess any names or dates - if you can't verify, don't include them
4. Look for ${isGovernment ? 'official government announcements, parliament records, news sources' : 'news articles, press releases, official announcements'} about departures
5. Find when they left and where they went (if known)
6. DOUBLE-CHECK: You are searching for ${companyName} in ${headquartersCountry || geography || 'the specified country'} - NOT any other country

Return ONLY a JSON array in this exact format (no other text):
[
  {
    "name": "Full Name",
    "title": "Former Title at Organization",
    "departureDate": "Month Year they left",
    "bio": "Brief context - reason for leaving or where they went"
  }
]

If you cannot find verified recent departures, return: []`;
        }
        
        // Use the Responses API with web search tool
        const contacts = await callOpenAIWithWebSearch(openaiCreds.apiKey, searchQuery);
        
        if (!contacts) {
            emitAiConsoleLog('researcher', `Web search returned no results for ${type} contacts`, 'warning');
            return { success: false, error: 'No results from web search', contacts: [] };
        }
        
        const count = contacts.length;
        emitAiConsoleLog('researcher', `Found ${count} ${type === 'current' ? 'current executives' : 'departed leaders'} for ${companyName}`, count > 0 ? 'success' : 'warning');
        
        return { success: true, contacts };
        
    } catch (error) {
        console.error('[Contacts] Research error:', error);
        emitAiConsoleLog('researcher', `Error researching contacts: ${error.message}`, 'error');
        return { success: false, error: error.message, contacts: [] };
    }
});

// Extract contacts from POC file using AI
ipcMain.handle('clients:extractContactsFromPOC', async (event, { pocFile, client }) => {
    const companyName = client?.name || 'the organization';
    const fileName = pocFile?.name || pocFile?.originalName || 'poc_file.txt';
    const filePath = pocFile?.path;
    
    console.log(`[Contacts] Extracting contacts from POC file "${fileName}" for ${companyName}...`);
    console.log(`[Contacts] File path: ${filePath}`);
    
    try {
        const openaiCreds = credentialManager.getCredentials('openai');
        
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured', currentContacts: [] };
        }
        
        emitAiConsoleLog('researcher', `Extracting key contacts from POC file for ${companyName}...`, 'info');
        
        // FIRST: Try to get EXTRACTED POC text from the source pack (properly parsed from PDF/DOCX)
        // This is the same approach used by Intel Pack
        let pocText = '';
        
        if (appState.pendingSourcePack?.documents) {
            const allKeys = Object.keys(appState.pendingSourcePack.documents);
            console.log(`[Contacts] Source pack has ${allKeys.length} documents`);
            
            const pocKeys = allKeys.filter(key => 
                key.includes('Client_Point_of_Contact_Info') || key.includes('poc_info')
            );
            console.log(`[Contacts] Found ${pocKeys.length} POC-related keys:`, pocKeys);
            
            if (pocKeys.length > 0) {
                // Combine all POC-related documents (skip index files)
                pocText = pocKeys.map(key => {
                    const content = appState.pendingSourcePack.documents[key];
                    if (key.endsWith('_INDEX.md')) return '';
                    console.log(`[Contacts] POC key "${key}" has ${content?.length || 0} chars`);
                    return content;
                }).filter(c => c).join('\n\n---\n\n');
                
                console.log(`[Contacts] Using extracted POC text from source pack (${pocText.length} chars)`);
            }
        } else {
            console.log('[Contacts] Source pack not available yet (will read file directly)');
        }
        
        // FALLBACK: If no extracted text in source pack, read file directly from disk
        if (!pocText || pocText.length < 100) {
            console.log('[Contacts] No extracted POC in source pack, reading file directly...');
            
            if (filePath && fs.existsSync(filePath)) {
                console.log(`[Contacts] Reading file from: ${filePath}`);
                try {
                    const contentBuffer = fs.readFileSync(filePath);
                    console.log(`[Contacts] Read ${contentBuffer.length} bytes from disk`);
                    
                    // Extract text using the document extractor
                    const extracted = await extractDocumentText(contentBuffer, fileName);
                    console.log(`[Contacts] Extraction result: converted=${extracted.converted}, textLength=${extracted.text?.length || 0}`);
                    
                    if (extracted.text && extracted.text.length > 50) {
                        pocText = extracted.text;
                        console.log(`[Contacts] Successfully extracted ${pocText.length} chars from document`);
                    }
                } catch (readError) {
                    console.error(`[Contacts] Error reading file:`, readError.message);
                }
            } else {
                console.log(`[Contacts] File path not available or file doesn't exist: ${filePath}`);
            }
        }
        
        // Log preview
        if (pocText && pocText.length > 0) {
            console.log(`[Contacts] POC text preview: ${pocText.substring(0, 300)}...`);
        } else {
            console.log('[Contacts] POC text is empty after all extraction attempts');
        }
        
        if (!pocText || pocText.length < 50) {
            emitAiConsoleLog('researcher', 'POC document appears empty or unreadable', 'warning');
            return { success: false, error: 'Could not read POC document', currentContacts: [] };
        }
        
        // Truncate if too long (keep first 15000 chars for context)
        if (pocText.length > 15000) {
            pocText = pocText.substring(0, 15000) + '\n\n[... document truncated for processing ...]';
        }
        
        const prompt = `Analyze this POC (Point of Contact) document and extract the key stakeholders and contacts mentioned.

DOCUMENT CONTENT:
${pocText}

YOUR TASK:
Extract all people mentioned in this document who appear to be key stakeholders, decision-makers, or important contacts at ${companyName}. 

For each person, provide:
1. Their full name (EXACT name as written in the document)
2. Their title/role
3. A brief bio or context (what is mentioned about them in the document)

Return ONLY a valid JSON object in this exact format (no other text):
{
  "currentContacts": [
    {
      "name": "Full Name",
      "title": "Their Role/Title",
      "bio": "Brief context from the document about this person"
    }
  ]
}

CRITICAL RULES:
- ONLY include people whose names are EXPLICITLY mentioned in the document
- Do NOT make up or invent any names
- Do NOT use placeholder names like "John Smith" or "Jane Doe"
- Maximum 5 contacts (prioritize the most senior/important ones)
- If no real names are found, return: {"currentContacts": []}`;

        const messages = [
            {
                role: 'system',
                content: 'You are an expert at extracting contact information from business documents. Extract only information that is explicitly stated in the document. Never invent or fabricate names.'
            },
            {
                role: 'user',
                content: prompt
            }
        ];
        
        const model = openaiCreds.model || 'gpt-4o';
        const content = await callOpenAI(openaiCreds.apiKey, model, messages, 2000);
        
        if (!content) {
            emitAiConsoleLog('researcher', 'Failed to extract contacts from POC', 'error');
            return { success: false, error: 'No response from AI', currentContacts: [], exitedContacts: [] };
        }
        
        // Parse JSON response
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        
        const result = JSON.parse(jsonStr);
        
        const currentCount = result.currentContacts?.length || 0;
        
        emitAiConsoleLog('researcher', `✓ Extracted ${currentCount} stakeholder${currentCount !== 1 ? 's' : ''} from POC`, 'success');
        
        return {
            success: true,
            currentContacts: result.currentContacts || [],
            source: 'poc'
        };
        
    } catch (error) {
        console.error('[Contacts] POC extraction error:', error);
        emitAiConsoleLog('researcher', `Error extracting contacts from POC: ${error.message}`, 'error');
        return { success: false, error: error.message, currentContacts: [] };
    }
});

// Call OpenAI Responses API with web search tool enabled
async function callOpenAIWithWebSearch(apiKey, query) {
    const https = require('https');
    
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            model: 'gpt-4o',  // Use gpt-4o for web search
            input: query,
            tools: [{ type: 'web_search_preview' }],  // Enable web search
            tool_choice: 'auto',
            max_output_tokens: 3000
        });
        
        console.log('[WebSearch] Making request to Responses API with web_search tool...');
        
        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/responses',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 120000  // 2 minute timeout for web search
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.error) {
                        console.error('[WebSearch] API Error:', response.error);
                        emitAiConsoleLog('researcher', `Web search error: ${response.error.message || 'Unknown error'}`, 'error');
                        resolve([]);
                        return;
                    }
                    
                    // Log the response structure for debugging
                    console.log('[WebSearch] Response structure:', JSON.stringify({
                        hasOutput: !!response.output,
                        outputLength: response.output?.length,
                        outputTypes: response.output?.map(o => o.type),
                        hasOutputText: !!response.output_text
                    }));
                    
                    // Extract text content from Responses API format
                    let textContent = '';
                    
                    if (response.output_text) {
                        textContent = response.output_text;
                    } else if (response.output && Array.isArray(response.output)) {
                        for (const item of response.output) {
                            if (item.type === 'message' && item.content) {
                                for (const part of item.content) {
                                    if ((part.type === 'output_text' || part.type === 'text') && part.text) {
                                        textContent += part.text;
                                    }
                                }
                            }
                        }
                    }
                    
                    if (!textContent) {
                        console.log('[WebSearch] No text content found in response');
                        console.log('[WebSearch] Full response:', JSON.stringify(response).substring(0, 2000));
                        resolve([]);
                        return;
                    }
                    
                    console.log('[WebSearch] Extracted text:', textContent.substring(0, 500) + '...');
                    
                    // Parse the JSON from the response
                    let contacts = [];
                    try {
                        // Clean the response - remove markdown code blocks if present
                        let cleanResponse = textContent.trim();
                        
                        // Find JSON array in the response
                        const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            cleanResponse = jsonMatch[0];
                        } else if (cleanResponse.startsWith('```')) {
                            cleanResponse = cleanResponse.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
                        }
                        
                        contacts = JSON.parse(cleanResponse);
                        
                        if (!Array.isArray(contacts)) {
                            contacts = [];
                        }
                        
                        // Limit to 5 contacts
                        contacts = contacts.slice(0, 5);
                        
                    } catch (parseError) {
                        console.error('[WebSearch] Failed to parse JSON:', parseError.message);
                        console.error('[WebSearch] Raw text:', textContent.substring(0, 1000));
                        resolve([]);
                        return;
                    }
                    
                    console.log(`[WebSearch] Successfully parsed ${contacts.length} contacts`);
                    resolve(contacts);
                    
                } catch (parseError) {
                    console.error('[WebSearch] Response parse error:', parseError);
                    resolve([]);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('[WebSearch] Request error:', error);
            resolve([]);
        });
        
        req.setTimeout(120000, () => {
            console.error('[WebSearch] Request timed out');
            req.destroy();
            resolve([]);
        });
        
        req.write(requestBody);
        req.end();
    });
}

// Real OpenAI API integration for company analysis (uses rate limiter)
async function analyzeCompanyWithOpenAI(companyName, apiKey, model = 'gpt-5.2') {
    const isO1Model = model.startsWith('o1');
    
    const prompt = `Analyze this company/organization name and provide ACCURATE information about it. You must identify the SPECIFIC organization being referenced.

Organization Name: "${companyName}"

CRITICAL DISAMBIGUATION RULES:

1. GOVERNMENT ENTITIES & MINISTRIES:
   - Many countries have similarly named government departments. You MUST identify which country's entity this is.
   - "Ministry of Defence" (with 'c') = UNITED KINGDOM's defence ministry (headquartersCountry: "United Kingdom")
   - "Ministry of Defense" (with 's') = Could be multiple countries - if ambiguous, look for context clues
   - "Department of Defense" / "DoD" = UNITED STATES (headquartersCountry: "United States")
   - "Ministry of Finance", "Ministry of Health", etc. - ALWAYS identify the specific country
   - For ANY government entity, the headquartersCountry is the country whose government it belongs to

2. SPELLING CLUES FOR UK vs US:
   - British spelling: Defence, Colour, Organisation, Centre = likely UK
   - American spelling: Defense, Color, Organization, Center = likely US
   - "Ministry of..." is typically UK/Commonwealth terminology
   - "Department of..." is typically US terminology

3. COMPANIES WITH SIMILAR NAMES IN MULTIPLE COUNTRIES:
   - "Nationwide" = Nationwide Building Society, UK (Europe), NOT Nationwide Insurance US
   - "Santander" = Spanish bank (Europe)
   - "HSBC" = British bank (Europe)
   - Always verify the actual headquarters country

4. GEOGRAPHY must be based on HEADQUARTERS location:
   - North America: USA, Canada, Mexico
   - Europe: UK, EU countries, Switzerland, Norway
   - APAC: Japan, China, Korea, Australia, India, Southeast Asia
   - LATAM: South America, Central America, Caribbean
   - MEA: Middle East, Africa
   - Global: ONLY for truly multinational HQ structures (very rare)

5. NEVER use "Global" for government entities - they always belong to ONE specific country.

6. If the organization name is ambiguous and could refer to multiple entities in different countries, make your BEST determination based on:
   - Spelling conventions (Defence vs Defense)
   - Terminology (Ministry vs Department)
   - Common usage and prominence
   - Set confidence lower (0.7-0.8) if ambiguous

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
    "officialName": "Full official name of the organization",
    "industry": "Primary industry (Government, Technology, Healthcare, Financial Services, etc.)",
    "geography": "Region based on HEADQUARTERS (North America, Europe, APAC, LATAM, MEA)",
    "headquartersCountry": "SPECIFIC country (e.g., United Kingdom, United States, France, Germany)",
    "sector": "Specific sector (e.g., Defence & National Security, Central Banking, Retail Banking)",
    "isGovernment": true/false,
    "confidence": 0.95
}

IMPORTANT: headquartersCountry must ALWAYS be filled in with a specific country name. Never leave it empty or use a region.`;

    // Build messages array - o1 models don't support system messages
    const messages = isO1Model ? [
        {
            role: 'user',
            content: 'You are a business intelligence assistant that provides accurate company and organization information. You are especially careful to correctly identify government entities and distinguish between similarly-named organizations in different countries. Always respond with valid JSON only, no markdown formatting.\n\n' + prompt
        }
    ] : [
        {
            role: 'system',
            content: 'You are a business intelligence assistant that provides accurate company and organization information. You are especially careful to correctly identify government entities and distinguish between similarly-named organizations in different countries. Always respond with valid JSON only, no markdown formatting.'
        },
        {
            role: 'user',
            content: prompt
        }
    ];

    try {
        emitAiConsoleLog('system', `Analyzing company "${companyName}" with ${model}...`, 'info');
        
        const content = await callOpenAI(apiKey, model, messages, 500);
        
        if (!content) {
            emitAiConsoleLog('system', `Failed to get response for company "${companyName}"`, 'error');
            throw new Error('No response from OpenAI');
        }
        
        // Parse the JSON response (handle potential markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        }
        
        const result = JSON.parse(jsonStr);
        emitAiConsoleLog('system', `✓ Successfully analyzed "${result.officialName || companyName}" (${result.headquartersCountry || result.geography})`, 'success');
        
        return {
            officialName: result.officialName || companyName,
            industry: result.industry || 'Technology',
            geography: result.geography || 'Global',
            headquartersCountry: result.headquartersCountry || '',
            sector: result.sector || 'General Business',
            isGovernment: result.isGovernment || false,
            confidence: result.confidence || 0.8,
            source: 'openai'
        };
    } catch (error) {
        console.error('OpenAI company analysis error:', error);
        emitAiConsoleLog('system', `Error analyzing company: ${error.message}`, 'error');
        throw error;
    }
}

// Simulated AI analysis for company profile generation
async function simulateAIClientAnalysis(companyName) {
    // Company database with known mappings
    const knownCompanies = {
        // Technology
        'apple': { officialName: 'Apple Inc.', industry: 'Technology', geography: 'North America', sector: 'Consumer Electronics & Software' },
        'microsoft': { officialName: 'Microsoft Corporation', industry: 'Technology', geography: 'North America', sector: 'Enterprise Software & Cloud' },
        'google': { officialName: 'Alphabet Inc. (Google)', industry: 'Technology', geography: 'North America', sector: 'Search & Digital Advertising' },
        'alphabet': { officialName: 'Alphabet Inc.', industry: 'Technology', geography: 'North America', sector: 'Search & Digital Advertising' },
        'amazon': { officialName: 'Amazon.com Inc.', industry: 'Technology', geography: 'North America', sector: 'E-Commerce & Cloud Services' },
        'meta': { officialName: 'Meta Platforms Inc.', industry: 'Technology', geography: 'North America', sector: 'Social Media & Metaverse' },
        'facebook': { officialName: 'Meta Platforms Inc.', industry: 'Technology', geography: 'North America', sector: 'Social Media & Metaverse' },
        'nvidia': { officialName: 'NVIDIA Corporation', industry: 'Technology', geography: 'North America', sector: 'Semiconductors & AI Computing' },
        'tesla': { officialName: 'Tesla Inc.', industry: 'Automotive', geography: 'North America', sector: 'Electric Vehicles & Energy Storage' },
        'netflix': { officialName: 'Netflix Inc.', industry: 'Media & Entertainment', geography: 'North America', sector: 'Streaming Services' },
        'salesforce': { officialName: 'Salesforce Inc.', industry: 'Technology', geography: 'North America', sector: 'CRM & Enterprise Cloud' },
        'adobe': { officialName: 'Adobe Inc.', industry: 'Technology', geography: 'North America', sector: 'Creative Software & Digital Media' },
        'oracle': { officialName: 'Oracle Corporation', industry: 'Technology', geography: 'North America', sector: 'Enterprise Software & Database' },
        'ibm': { officialName: 'IBM Corporation', industry: 'Technology', geography: 'North America', sector: 'Enterprise IT & Consulting' },
        'intel': { officialName: 'Intel Corporation', industry: 'Technology', geography: 'North America', sector: 'Semiconductors & Processors' },
        'amd': { officialName: 'Advanced Micro Devices Inc.', industry: 'Technology', geography: 'North America', sector: 'Semiconductors & Processors' },
        'cisco': { officialName: 'Cisco Systems Inc.', industry: 'Technology', geography: 'North America', sector: 'Networking & Communications' },
        'uber': { officialName: 'Uber Technologies Inc.', industry: 'Technology', geography: 'North America', sector: 'Ride-Sharing & Mobility' },
        'airbnb': { officialName: 'Airbnb Inc.', industry: 'Technology', geography: 'North America', sector: 'Travel & Hospitality Platform' },
        'spotify': { officialName: 'Spotify Technology S.A.', industry: 'Media & Entertainment', geography: 'Europe', sector: 'Music Streaming' },
        'shopify': { officialName: 'Shopify Inc.', industry: 'Technology', geography: 'North America', sector: 'E-Commerce Platform' },
        'zoom': { officialName: 'Zoom Video Communications', industry: 'Technology', geography: 'North America', sector: 'Video Communications' },
        'slack': { officialName: 'Slack Technologies (Salesforce)', industry: 'Technology', geography: 'North America', sector: 'Business Communications' },
        'twitter': { officialName: 'X Corp (Twitter)', industry: 'Technology', geography: 'North America', sector: 'Social Media Platform' },
        'x': { officialName: 'X Corp', industry: 'Technology', geography: 'North America', sector: 'Social Media Platform' },
        'linkedin': { officialName: 'LinkedIn (Microsoft)', industry: 'Technology', geography: 'North America', sector: 'Professional Networking' },
        'paypal': { officialName: 'PayPal Holdings Inc.', industry: 'Financial Services', geography: 'North America', sector: 'Digital Payments' },
        'stripe': { officialName: 'Stripe Inc.', industry: 'Financial Services', geography: 'North America', sector: 'Payment Infrastructure' },
        'square': { officialName: 'Block Inc. (Square)', industry: 'Financial Services', geography: 'North America', sector: 'Payment Solutions' },
        'block': { officialName: 'Block Inc.', industry: 'Financial Services', geography: 'North America', sector: 'Payment Solutions & Crypto' },
        'coinbase': { officialName: 'Coinbase Global Inc.', industry: 'Financial Services', geography: 'North America', sector: 'Cryptocurrency Exchange' },
        
        // Automotive
        'ford': { officialName: 'Ford Motor Company', industry: 'Automotive', geography: 'North America', sector: 'Vehicle Manufacturing' },
        'gm': { officialName: 'General Motors Company', industry: 'Automotive', geography: 'North America', sector: 'Vehicle Manufacturing' },
        'general motors': { officialName: 'General Motors Company', industry: 'Automotive', geography: 'North America', sector: 'Vehicle Manufacturing' },
        'toyota': { officialName: 'Toyota Motor Corporation', industry: 'Automotive', geography: 'APAC', sector: 'Vehicle Manufacturing' },
        'honda': { officialName: 'Honda Motor Co., Ltd.', industry: 'Automotive', geography: 'APAC', sector: 'Vehicle Manufacturing' },
        'bmw': { officialName: 'Bayerische Motoren Werke AG', industry: 'Automotive', geography: 'Europe', sector: 'Luxury Vehicles' },
        'mercedes': { officialName: 'Mercedes-Benz Group AG', industry: 'Automotive', geography: 'Europe', sector: 'Luxury Vehicles' },
        'volkswagen': { officialName: 'Volkswagen AG', industry: 'Automotive', geography: 'Europe', sector: 'Vehicle Manufacturing' },
        'rivian': { officialName: 'Rivian Automotive Inc.', industry: 'Automotive', geography: 'North America', sector: 'Electric Vehicles' },
        'lucid': { officialName: 'Lucid Group Inc.', industry: 'Automotive', geography: 'North America', sector: 'Electric Vehicles' },
        
        // Healthcare & Pharma
        'pfizer': { officialName: 'Pfizer Inc.', industry: 'Healthcare', geography: 'North America', sector: 'Pharmaceuticals' },
        'johnson & johnson': { officialName: 'Johnson & Johnson', industry: 'Healthcare', geography: 'North America', sector: 'Pharmaceuticals & Medical Devices' },
        'jnj': { officialName: 'Johnson & Johnson', industry: 'Healthcare', geography: 'North America', sector: 'Pharmaceuticals & Medical Devices' },
        'moderna': { officialName: 'Moderna Inc.', industry: 'Healthcare', geography: 'North America', sector: 'Biotechnology & mRNA' },
        'unitedhealth': { officialName: 'UnitedHealth Group Inc.', industry: 'Healthcare', geography: 'North America', sector: 'Health Insurance' },
        'cvs': { officialName: 'CVS Health Corporation', industry: 'Healthcare', geography: 'North America', sector: 'Pharmacy & Health Services' },
        'abbvie': { officialName: 'AbbVie Inc.', industry: 'Healthcare', geography: 'North America', sector: 'Pharmaceuticals' },
        'merck': { officialName: 'Merck & Co. Inc.', industry: 'Healthcare', geography: 'North America', sector: 'Pharmaceuticals' },
        
        // Finance & Banking - UK
        'nationwide': { officialName: 'Nationwide Building Society', industry: 'Financial Services', geography: 'Europe', sector: 'Building Society & Retail Banking', headquartersCountry: 'United Kingdom' },
        'nationwide building society': { officialName: 'Nationwide Building Society', industry: 'Financial Services', geography: 'Europe', sector: 'Building Society & Retail Banking', headquartersCountry: 'United Kingdom' },
        'lloyds': { officialName: 'Lloyds Banking Group PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Retail & Commercial Banking', headquartersCountry: 'United Kingdom' },
        'barclays': { officialName: 'Barclays PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Investment & Retail Banking', headquartersCountry: 'United Kingdom' },
        'hsbc': { officialName: 'HSBC Holdings PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Global Banking', headquartersCountry: 'United Kingdom' },
        'natwest': { officialName: 'NatWest Group PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Retail & Commercial Banking', headquartersCountry: 'United Kingdom' },
        'santander uk': { officialName: 'Santander UK PLC', industry: 'Financial Services', geography: 'Europe', sector: 'Retail Banking', headquartersCountry: 'United Kingdom' },
        'halifax': { officialName: 'Halifax (Lloyds Banking Group)', industry: 'Financial Services', geography: 'Europe', sector: 'Retail Banking', headquartersCountry: 'United Kingdom' },
        'rbs': { officialName: 'NatWest Group PLC (formerly RBS)', industry: 'Financial Services', geography: 'Europe', sector: 'Retail & Commercial Banking', headquartersCountry: 'United Kingdom' },
        'standard chartered': { officialName: 'Standard Chartered PLC', industry: 'Financial Services', geography: 'Europe', sector: 'International Banking', headquartersCountry: 'United Kingdom' },
        
        // Finance & Banking - US
        'jpmorgan': { officialName: 'JPMorgan Chase & Co.', industry: 'Financial Services', geography: 'North America', sector: 'Investment Banking', headquartersCountry: 'United States' },
        'chase': { officialName: 'JPMorgan Chase & Co.', industry: 'Financial Services', geography: 'North America', sector: 'Investment Banking', headquartersCountry: 'United States' },
        'goldman sachs': { officialName: 'Goldman Sachs Group Inc.', industry: 'Financial Services', geography: 'North America', sector: 'Investment Banking', headquartersCountry: 'United States' },
        'morgan stanley': { officialName: 'Morgan Stanley', industry: 'Financial Services', geography: 'North America', sector: 'Investment Banking' },
        'bank of america': { officialName: 'Bank of America Corporation', industry: 'Financial Services', geography: 'North America', sector: 'Commercial Banking' },
        'wells fargo': { officialName: 'Wells Fargo & Company', industry: 'Financial Services', geography: 'North America', sector: 'Commercial Banking' },
        'citigroup': { officialName: 'Citigroup Inc.', industry: 'Financial Services', geography: 'Global', sector: 'Investment Banking' },
        'visa': { officialName: 'Visa Inc.', industry: 'Financial Services', geography: 'Global', sector: 'Payment Networks' },
        'mastercard': { officialName: 'Mastercard Incorporated', industry: 'Financial Services', geography: 'Global', sector: 'Payment Networks' },
        'blackrock': { officialName: 'BlackRock Inc.', industry: 'Financial Services', geography: 'Global', sector: 'Asset Management' },
        
        // Retail & Consumer
        'walmart': { officialName: 'Walmart Inc.', industry: 'Retail', geography: 'North America', sector: 'Mass Retail' },
        'target': { officialName: 'Target Corporation', industry: 'Retail', geography: 'North America', sector: 'Mass Retail' },
        'costco': { officialName: 'Costco Wholesale Corporation', industry: 'Retail', geography: 'North America', sector: 'Warehouse Retail' },
        'home depot': { officialName: 'The Home Depot Inc.', industry: 'Retail', geography: 'North America', sector: 'Home Improvement' },
        'nike': { officialName: 'Nike Inc.', industry: 'Consumer Goods', geography: 'Global', sector: 'Sportswear & Apparel' },
        'starbucks': { officialName: 'Starbucks Corporation', industry: 'Consumer Goods', geography: 'Global', sector: 'Coffee & Quick Service' },
        'mcdonalds': { officialName: 'McDonald\'s Corporation', industry: 'Consumer Goods', geography: 'Global', sector: 'Quick Service Restaurants' },
        'coca cola': { officialName: 'The Coca-Cola Company', industry: 'Consumer Goods', geography: 'Global', sector: 'Beverages' },
        'pepsi': { officialName: 'PepsiCo Inc.', industry: 'Consumer Goods', geography: 'Global', sector: 'Beverages & Snacks' },
        'pepsico': { officialName: 'PepsiCo Inc.', industry: 'Consumer Goods', geography: 'Global', sector: 'Beverages & Snacks' },
        'procter': { officialName: 'Procter & Gamble Co.', industry: 'Consumer Goods', geography: 'Global', sector: 'Consumer Products' },
        'pg': { officialName: 'Procter & Gamble Co.', industry: 'Consumer Goods', geography: 'Global', sector: 'Consumer Products' },
        'unilever': { officialName: 'Unilever PLC', industry: 'Consumer Goods', geography: 'Europe', sector: 'Consumer Products' },
        
        // Energy
        'exxon': { officialName: 'Exxon Mobil Corporation', industry: 'Energy', geography: 'North America', sector: 'Oil & Gas' },
        'chevron': { officialName: 'Chevron Corporation', industry: 'Energy', geography: 'North America', sector: 'Oil & Gas' },
        'shell': { officialName: 'Shell PLC', industry: 'Energy', geography: 'Europe', sector: 'Oil & Gas' },
        'bp': { officialName: 'BP PLC', industry: 'Energy', geography: 'Europe', sector: 'Oil & Gas' },
        'nextera': { officialName: 'NextEra Energy Inc.', industry: 'Energy', geography: 'North America', sector: 'Renewable Energy' },
        
        // Telecom
        'att': { officialName: 'AT&T Inc.', industry: 'Telecommunications', geography: 'North America', sector: 'Telecom Services' },
        'verizon': { officialName: 'Verizon Communications Inc.', industry: 'Telecommunications', geography: 'North America', sector: 'Telecom Services' },
        't-mobile': { officialName: 'T-Mobile US Inc.', industry: 'Telecommunications', geography: 'North America', sector: 'Wireless Services' },
        
        // Aerospace & Defense
        'boeing': { officialName: 'The Boeing Company', industry: 'Aerospace & Defense', geography: 'North America', sector: 'Aircraft Manufacturing' },
        'lockheed': { officialName: 'Lockheed Martin Corporation', industry: 'Aerospace & Defense', geography: 'North America', sector: 'Defense Contractor' },
        'spacex': { officialName: 'Space Exploration Technologies Corp.', industry: 'Aerospace & Defense', geography: 'North America', sector: 'Space Launch Services' },
        
        // Consulting
        'accenture': { officialName: 'Accenture PLC', industry: 'Professional Services', geography: 'Global', sector: 'Management Consulting & Technology' },
        'mckinsey': { officialName: 'McKinsey & Company', industry: 'Professional Services', geography: 'Global', sector: 'Management Consulting' },
        'deloitte': { officialName: 'Deloitte Touche Tohmatsu Ltd.', industry: 'Professional Services', geography: 'Global', sector: 'Consulting & Audit' },
        'pwc': { officialName: 'PricewaterhouseCoopers', industry: 'Professional Services', geography: 'Global', sector: 'Consulting & Audit' },
        'kpmg': { officialName: 'KPMG International', industry: 'Professional Services', geography: 'Global', sector: 'Consulting & Audit' },
        'ey': { officialName: 'Ernst & Young Global Ltd.', industry: 'Professional Services', geography: 'Global', sector: 'Consulting & Audit' },
        'bain': { officialName: 'Bain & Company', industry: 'Professional Services', geography: 'Global', sector: 'Management Consulting' },
        'bcg': { officialName: 'Boston Consulting Group', industry: 'Professional Services', geography: 'Global', sector: 'Management Consulting' },
    };
    
    // Normalize the company name for lookup
    const normalizedName = companyName.toLowerCase().trim()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+inc$/i, '')
        .replace(/\s+corp$/i, '')
        .replace(/\s+corporation$/i, '')
        .replace(/\s+ltd$/i, '')
        .replace(/\s+llc$/i, '')
        .replace(/\s+plc$/i, '');
    
    // Check if we have a known company
    const knownCompany = knownCompanies[normalizedName];
    
    if (knownCompany) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 2500));
        return { ...knownCompany, confidence: 0.95 };
    }
    
    // For unknown companies, generate intelligent defaults based on keywords
    const industryKeywords = {
        'tech|software|app|digital|ai|cloud|data|cyber|saas': { industry: 'Technology', sector: 'Software & Digital Services' },
        'bank|finance|invest|capital|fund|asset|wealth': { industry: 'Financial Services', sector: 'Banking & Investment' },
        'health|medical|pharma|bio|care|hospital|clinic': { industry: 'Healthcare', sector: 'Health Services' },
        'energy|oil|gas|solar|wind|power|electric|utility': { industry: 'Energy', sector: 'Energy Services' },
        'retail|shop|store|mart|market|commerce': { industry: 'Retail', sector: 'Retail Operations' },
        'food|beverage|restaurant|cafe|dining': { industry: 'Consumer Goods', sector: 'Food & Beverage' },
        'auto|motor|vehicle|car|truck|ev': { industry: 'Automotive', sector: 'Vehicle Manufacturing' },
        'media|entertainment|stream|content|studio|game': { industry: 'Media & Entertainment', sector: 'Content & Media' },
        'telecom|wireless|network|mobile|5g': { industry: 'Telecommunications', sector: 'Telecom Services' },
        'consult|advisory|strategy|management': { industry: 'Professional Services', sector: 'Consulting' },
        'manufacturing|industrial|factory|production': { industry: 'Manufacturing', sector: 'Industrial Manufacturing' },
        'real estate|property|housing|construction|build': { industry: 'Real Estate', sector: 'Property Development' },
        'transport|logistics|shipping|freight|delivery': { industry: 'Transportation', sector: 'Logistics & Delivery' },
        'insurance|underwrite|risk|policy': { industry: 'Insurance', sector: 'Insurance Services' },
        'aerospace|defense|military|space|aviation': { industry: 'Aerospace & Defense', sector: 'Defense & Aviation' },
    };
    
    let detectedIndustry = 'Technology';
    let detectedSector = 'General Business';
    
    for (const [pattern, info] of Object.entries(industryKeywords)) {
        if (new RegExp(pattern, 'i').test(normalizedName)) {
            detectedIndustry = info.industry;
            detectedSector = info.sector;
            break;
        }
    }
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Capitalize the company name properly
    const capitalizedName = companyName.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    
    return {
        officialName: capitalizedName,
        industry: detectedIndustry,
        geography: 'Global',
        sector: detectedSector,
        confidence: 0.7
    };
}

// Credential management
ipcMain.handle('config:getCredentials', async () => {
    return credentialManager.getCredentialStatus();
});

ipcMain.handle('config:getMaskedCredentials', async (event, { provider }) => {
    return credentialManager.getMaskedCredentials(provider);
});

ipcMain.handle('config:setCredentials', async (event, { provider, credentials }) => {
    await credentialManager.setCredentials(provider, credentials);
    auditLogger.log('CONFIG', 'CREDENTIALS_UPDATED', { provider, user: appState.user?.username });
    return { success: true };
});

ipcMain.handle('config:testConnection', async (event, { provider }) => {
    return await credentialManager.testConnection(provider);
});

// Source Pack Generation
ipcMain.handle('sourcePack:generate', async (event, { clientId, context }) => {
    const requestId = uuidv4();
    
    const client = appState.clients.find(c => c.id === clientId);
    if (!client) {
        return { success: false, error: 'Client not found' };
    }

    auditLogger.log('RETRIEVAL', 'GENERATION_STARTED', { 
        requestId, 
        clientId, 
        context,
        user: appState.user?.username 
    });

    try {
        // Generate source pack
        const sourcePack = await retrievalOrchestrator.generateSourcePack({
            requestId,
            client,
            context,
            user: appState.user
        });

        // Validate
        const validation = schemaValidator.validate(sourcePack);

        auditLogger.log('RETRIEVAL', 'GENERATION_COMPLETED', { 
            requestId, 
            status: validation.status,
            confidence: sourcePack.confidence_scores.overall
        });

        return {
            success: true,
            requestId,
            sourcePack,
            validation
        };

    } catch (error) {
        auditLogger.log('RETRIEVAL', 'GENERATION_FAILED', { requestId, error: error.message });
        return { success: false, error: error.message };
    }
});

// Export
ipcMain.handle('export:markdown', async (event, { sourcePack }) => {
    return generateMarkdown(sourcePack);
});

ipcMain.handle('export:saveFile', async (event, { content, defaultName, filters }) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: filters
        });
        
        if (!result.canceled && result.filePath) {
            const fsPromises = require('fs').promises;
            await fsPromises.writeFile(result.filePath, content);
            return { success: true, filePath: result.filePath };
        }
        return { success: false, canceled: true };
    } catch (error) {
        console.error('[Export] Save file error:', error);
        return { success: false, error: error.message };
    }
});

// Source Pack ZIP Generation with DeepResearch
ipcMain.handle('sourcePack:generateZip', async (event, { clientId, context }) => {
    const requestId = uuidv4();
    const fs = require('fs');
    
    // Reset source chat history for new generation
    sourceChatHistory = [];
    
    const client = appState.clients.find(c => c.id === clientId);
    if (!client) {
        return { success: false, error: 'Client not found' };
    }

    // Check API configurations
    const openaiCreds = credentialManager.getCredentials('openai');
    const hasOpenAI = openaiCreds && openaiCreds.configured && openaiCreds.apiKey;
    const hasAlphaSense = alphasenseConnector.isConfigured();
    const hasARC = arcConnector.isConfigured();
    
    // Load source prompts from admin settings
    const sourcePrompts = credentialManager.loadAppData('sourcePrompts') || {
        chatgpt: 'Generate a comprehensive research report on {clientName} including company overview, recent news, market position, competitors, and strategic initiatives.',
        arc: 'Research Accenture assets and solutions relevant to {clientName} in the {industry} industry, focusing on transformation capabilities and case studies.',
        alphasense: 'Provide market intelligence and analyst insights on {clientName}, including financial performance, industry trends, and competitive landscape.'
    };

    console.log(`[Source Pack] OpenAI configured: ${hasOpenAI}`);
    console.log(`[Source Pack] AlphaSense configured: ${hasAlphaSense}`);
    console.log(`[Source Pack] ARC configured: ${hasARC}`);

    auditLogger.log('RETRIEVAL', 'SOURCE_PACK_STARTED', { 
        requestId, 
        clientId, 
        context,
        hasOpenAI,
        hasAlphaSense,
        hasARC,
        user: appState.user?.username 
    });

    try {
        // Send progress updates via webContents
        const sendProgress = (stage, message, percent, stageProgress = null) => {
            mainWindow.webContents.send('generation-progress', { stage, message, percent, stageProgress });
        };

        sendProgress('init', 'Initialising Source Pack generation...', 5);

        // Track source results
        const documents = {};
        const sourceResults = {
            chatgpt: { success: false, error: null, fileName: '1.0_ChatGPT_Research_Report.md' },
            arc: { success: false, error: null, fileName: '2.0_ARC_Assets_Report.md' },
            alphasense: { success: false, error: null, fileName: '3.0_AlphaSense_Market_Report.md' }
        };
        const timestamp = new Date().toISOString().split('T')[0];

        // Helper to substitute variables in prompts
        const substitutePromptVars = (prompt) => {
            return prompt
                .replace(/\{clientName\}/g, client.name)
                .replace(/\{industry\}/g, client.industry || 'General')
                .replace(/\{geography\}/g, client.geography || 'Global')
                .replace(/\{sector\}/g, client.sector || 'General');
        };

        // =====================================
        // Source 1: ChatGPT Research Report
        // =====================================
        sendProgress('chatgpt', 'Generating ChatGPT research report...', 15, 10);
        
        if (hasOpenAI) {
            emitAiConsoleLog('researcher', 'ChatGPT: Starting comprehensive research...', 'thinking');
            try {
                const chatgptPrompt = substitutePromptVars(sourcePrompts.chatgpt);
                const model = context.fastGenerate ? 'gpt-4o-mini' : (openaiCreds.model || 'gpt-4o');
                
                const response = await callOpenAI(openaiCreds.apiKey, model, [
                    { role: 'system', content: 'You are a senior business researcher providing comprehensive analysis for executive-level decision making. Format your response in clear markdown with headers and bullet points.' },
                    { role: 'user', content: chatgptPrompt }
                ]);
                
                documents[sourceResults.chatgpt.fileName] = `# ChatGPT Research Report\n\n**Client:** ${client.name}  \n**Generated:** ${timestamp}  \n**Model:** ${model}\n\n---\n\n${response}`;
                sourceResults.chatgpt.success = true;
                emitAiConsoleLog('researcher', '✓ ChatGPT research report complete', 'success');
                sendProgress('chatgpt', 'ChatGPT research complete', 30, 100);
            } catch (e) {
                console.error('[ChatGPT Error]', e);
                sourceResults.chatgpt.error = e.message;
                emitAiConsoleLog('researcher', `⚠ ChatGPT error: ${e.message}`, 'error');
                documents[sourceResults.chatgpt.fileName] = generateSourcePlaceholder('ChatGPT', client, e.message);
            }
        } else {
            sourceResults.chatgpt.error = 'OpenAI API not configured';
            documents[sourceResults.chatgpt.fileName] = generateSourcePlaceholder('ChatGPT', client, 'OpenAI API not configured');
            sendProgress('chatgpt', 'ChatGPT report [PLACEHOLDER - API not configured]', 30);
        }

        // =====================================
        // Source 2: ARC Assets Report
        // =====================================
        sendProgress('arc', 'Generating ARC assets report...', 40, 10);
        
        if (hasARC && arcConnector.isConfigured()) {
            emitAiConsoleLog('researcher', 'ARC: Searching for relevant assets and solutions...', 'thinking');
            try {
                const arcResults = await arcConnector.runComprehensiveSearch(client, context, (msg) => {
                    emitAiConsoleLog('researcher', `ARC: ${msg}`, 'thinking');
                });
                
                documents[sourceResults.arc.fileName] = arcConnector.formatComprehensiveReport(client, context, arcResults);
                sourceResults.arc.success = true;
                emitAiConsoleLog('researcher', `✓ ARC report: ${arcResults?.assets?.length || 0} assets found`, 'success');
                sendProgress('arc', 'ARC assets report complete', 55, 100);
            } catch (e) {
                console.error('[ARC Error]', e);
                sourceResults.arc.error = e.message;
                emitAiConsoleLog('researcher', `⚠ ARC error: ${e.message}`, 'error');
                documents[sourceResults.arc.fileName] = generateSourcePlaceholder('ARC', client, e.message);
            }
        } else {
            sourceResults.arc.error = 'ARC API not configured';
            documents[sourceResults.arc.fileName] = generateSourcePlaceholder('ARC', client, 'ARC API not configured');
            sendProgress('arc', 'ARC report [PLACEHOLDER - API not configured]', 55);
        }

        // =====================================
        // Source 3: AlphaSense Market Report
        // =====================================
        sendProgress('alphasense', 'Generating AlphaSense market report...', 65, 10);
        
        if (hasAlphaSense) {
            emitAiConsoleLog('researcher', 'AlphaSense: Searching for market intelligence...', 'thinking');
            try {
                const alphaResults = await alphasenseConnector.runComprehensiveSearch(client, context, (msg) => {
                    emitAiConsoleLog('researcher', `AlphaSense: ${msg}`, 'thinking');
                });
                
                documents[sourceResults.alphasense.fileName] = alphasenseConnector.formatComprehensiveReport(client, context, alphaResults);
                sourceResults.alphasense.success = true;
                emitAiConsoleLog('researcher', `✓ AlphaSense: ${alphaResults?.documents?.length || 0} documents analysed`, 'success');
                sendProgress('alphasense', 'AlphaSense market report complete', 80, 100);
            } catch (e) {
                console.error('[AlphaSense Error]', e);
                sourceResults.alphasense.error = e.message;
                emitAiConsoleLog('researcher', `⚠ AlphaSense error: ${e.message}`, 'error');
                documents[sourceResults.alphasense.fileName] = generateSourcePlaceholder('AlphaSense', client, e.message);
            }
        } else {
            sourceResults.alphasense.error = 'AlphaSense API not configured';
            documents[sourceResults.alphasense.fileName] = generateSourcePlaceholder('AlphaSense', client, 'AlphaSense API not configured');
            sendProgress('alphasense', 'AlphaSense report [PLACEHOLDER - API not configured]', 80);
        }

        sendProgress('normalize', 'Validating generated sources...', 90, 50);

        // Build list of failed sources for frontend (also used as placeholderSections)
        const failedSources = [];
        for (const [source, result] of Object.entries(sourceResults)) {
            if (!result.success) {
                failedSources.push({
                    id: source,
                    name: source === 'chatgpt' ? 'ChatGPT Research Report' : 
                          source === 'arc' ? 'ARC Assets Report' : 
                          'AlphaSense Market Report',
                    fileName: result.fileName,
                    source: source.charAt(0).toUpperCase() + source.slice(1),
                    error: result.error
                });
            }
        }
        
        // Store generated documents in appState for later finalization
        // Include placeholderSections for replacement functionality
        appState.pendingSourcePack = {
            requestId,
            client,
            context,
            documents,
            timestamp,
            sourceResults,
            failedSources,
            placeholderSections: failedSources // Use failedSources as placeholderSections
        };
        
        sendProgress('complete', 'Source generation complete - ready for review', 95, 100);
        
        // Return success with source status
        return {
            success: true,
            requestId,
            documentCount: Object.keys(documents).length,
            readyForAdditionalDocs: true,
            sourceResults,
            failedSources,
            // Legacy support for placeholder sections
            placeholderSections: failedSources.map(f => ({
                id: f.id,
                name: f.name,
                fileName: f.fileName,
                section: 'Source',
                source: f.source
            }))
        };

    } catch (error) {
        auditLogger.log('RETRIEVAL', 'SOURCE_PACK_FAILED', { requestId, error: error.message });
        return { success: false, error: error.message };
    }
});

// Helper function to generate placeholder for failed sources
function generateSourcePlaceholder(sourceName, client, reason) {
    return `# ${sourceName} Report

**Client:** ${client.name}  
**Status:** ⚠️ Placeholder - Source Not Available

---

## Notice

This is a placeholder document. The ${sourceName} source could not be generated automatically.

**Reason:** ${reason}

## Next Steps

Please upload a replacement document in the "Add Documents" step to provide this source content.

---
*Generated by R/StudioGPT*
`;
}

// Add additional files to pending source pack
ipcMain.handle('sourcePack:addFiles', async (event) => {
    if (!appState.pendingSourcePack) {
        return { success: false, error: 'No pending source pack' };
    }
    
    const fileSelection = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Documents to Add to Source Pack',
        buttonLabel: 'Add to Source Pack',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (fileSelection.canceled || fileSelection.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    
    const addedFiles = [];
    const additionalFolder = '4.0_Additional_Client_Materials';
    
    for (const filePath of fileSelection.filePaths) {
        const fileName = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath);
        const fileSize = fs.statSync(filePath).size;
        
        // Extract text from document if possible
        const extracted = await extractDocumentText(fileContent, fileName);
        
        let destPath;
        let savedFileName;
        
        if (extracted.converted && extracted.text) {
            // Save as markdown with extracted text
            savedFileName = extracted.newFileName;
            destPath = `${additionalFolder}/${savedFileName}`;
            appState.pendingSourcePack.documents[destPath] = extracted.text;
            console.log(`[Source Pack] Extracted text from ${fileName} -> ${savedFileName}`);
        } else {
            // Save original file (text files or unsupported formats)
            savedFileName = fileName;
            destPath = `${additionalFolder}/${savedFileName}`;
            appState.pendingSourcePack.documents[destPath] = extracted.text || fileContent;
        }
        
        addedFiles.push({
            name: fileName,
            savedAs: savedFileName,
            path: destPath,
            size: fileSize,
            converted: extracted.converted
        });
        
        console.log(`[Source Pack] Added user file: ${fileName}${extracted.converted ? ` (converted to ${savedFileName})` : ''}`);
        emitAiConsoleLog('system', `Added: ${fileName}${extracted.converted ? ` → ${savedFileName}` : ''}`, 'success');
    }
    
    return {
        success: true,
        addedFiles,
        totalFiles: Object.keys(appState.pendingSourcePack.documents)
            .filter(k => k.startsWith(additionalFolder + '/'))
            .length
    };
});

// Add POC file to source pack (section 3)
ipcMain.handle('sourcePack:addPocFile', async (event, pocFile) => {
    if (!appState.pendingSourcePack) {
        return { success: false, error: 'No pending source pack' };
    }
    
    if (!pocFile || !pocFile.content) {
        return { success: false, error: 'No POC file provided' };
    }
    
    const pocFolder = '3.0_Client_Point_of_Contact_Info';
    let fileName = pocFile.name || 'Client_POC_Info.txt';
    
    // Handle content - could be Buffer, string, or object with data
    let content = pocFile.content;
    if (typeof content === 'object' && content.data) {
        content = Buffer.from(content.data);
    } else if (typeof content === 'string') {
        content = Buffer.from(content, 'utf-8');
    }
    
    // Extract text from document using shared utility
    const extracted = await extractDocumentText(content, fileName);
    
    let finalContent;
    let finalFileName;
    
    if (extracted.converted && extracted.text) {
        // Use extracted text, update filename
        finalContent = extracted.text.replace(/^# Content from .*\n\n/, '# Client Point of Contact Information\n\n*Extracted from: ' + fileName + '*\n\n---\n\n');
        finalFileName = extracted.newFileName;
        console.log(`[Source Pack] Extracted POC text from ${fileName} -> ${finalFileName}`);
    } else if (extracted.text) {
        // Text file - use as-is
        finalContent = extracted.text;
        finalFileName = fileName;
    } else {
        // Binary file that couldn't be converted - save note
        finalContent = `# Client Point of Contact Information\n\n*Note: The file "${fileName}" is in an unsupported format and could not be extracted.*\n\nPlease provide a text-based document (.txt, .md, .docx, .pdf) for best results.`;
        finalFileName = fileName.replace(/\.[^.]+$/, '.md');
    }
    
    // Add POC file to documents
    const destPath = `${pocFolder}/${finalFileName}`;
    appState.pendingSourcePack.documents[destPath] = finalContent;
    
    // Create index file for POC section
    const indexContent = `# Client Point of Contact Information

## Overview
This section contains client stakeholder and point of contact information provided during Source Pack generation.

## Contents
- ${finalFileName}

## Purpose
This document contains key client contact information including:
- Primary stakeholders and their roles
- Decision makers and influencers  
- Contact details and preferences
- Organizational hierarchy relevant to the engagement

---
*Added: ${new Date().toISOString()}*
*Source Pack: ${appState.pendingSourcePack.client?.name || 'Unknown'}*
`;
    appState.pendingSourcePack.documents[`${pocFolder}/_INDEX.md`] = indexContent;
    
    console.log(`[Source Pack] Added POC file: ${finalFileName}`);
    emitAiConsoleLog('system', `✓ POC file added: ${finalFileName}`, 'success');
    
    return {
        success: true,
        fileName: finalFileName,
        originalFileName: fileName,
        path: destPath,
        converted: extracted.converted
    };
});

// Replace a placeholder document with user-uploaded file
ipcMain.handle('sourcePack:replacePlaceholder', async (event, { placeholderId, fileName, content }) => {
    console.log(`[Source Pack] Replacing placeholder ${placeholderId} with file: ${fileName}`);
    
    if (!appState.pendingSourcePack) {
        return { success: false, error: 'No pending source pack' };
    }
    
    // Find the placeholder section
    const placeholder = appState.pendingSourcePack.placeholderSections?.find(p => p.id === placeholderId);
    if (!placeholder) {
        return { success: false, error: `Placeholder ${placeholderId} not found` };
    }
    
    // Handle content - could be ArrayBuffer, Buffer, Uint8Array, string, or object with data
    let fileContent;
    if (content instanceof ArrayBuffer) {
        fileContent = Buffer.from(content);
    } else if (content instanceof Uint8Array) {
        fileContent = Buffer.from(content);
    } else if (Buffer.isBuffer(content)) {
        fileContent = content;
    } else if (typeof content === 'object' && content !== null) {
        // Handle serialized ArrayBuffer/Uint8Array from IPC
        if (content.type === 'Buffer' && Array.isArray(content.data)) {
            fileContent = Buffer.from(content.data);
        } else if (ArrayBuffer.isView(content)) {
            fileContent = Buffer.from(content.buffer);
        } else {
            // Generic object with numeric keys (serialized Uint8Array)
            const values = Object.values(content);
            if (values.length > 0 && typeof values[0] === 'number') {
                fileContent = Buffer.from(values);
            } else {
                console.error('[Source Pack] Unknown content format:', typeof content, content);
                return { success: false, error: 'Unknown file content format' };
            }
        }
    } else if (typeof content === 'string') {
        fileContent = Buffer.from(content, 'utf-8');
    } else {
        console.error('[Source Pack] Unknown content type:', typeof content);
        return { success: false, error: 'Unknown file content type' };
    }
    
    console.log(`[Source Pack] File buffer size: ${fileContent.length} bytes`);
    
    // Extract text from document using shared utility - use the ORIGINAL filename for type detection
    const extracted = await extractDocumentText(fileContent, fileName);
    console.log(`[Source Pack] Extraction result: converted=${extracted.converted}, textLength=${extracted.text?.length || 0}`);
    
    // Replace the placeholder document with the extracted/original content
    // Keep the schema filename but store the actual content
    const schemaFileName = placeholder.fileName;
    
    if (extracted.text) {
        // Use extracted text
        appState.pendingSourcePack.documents[schemaFileName] = extracted.text;
        console.log(`[Source Pack] Extracted text for placeholder: ${fileName} -> ${schemaFileName}`);
    } else {
        // Binary content (shouldn't normally happen for schema files which are .md)
        appState.pendingSourcePack.documents[schemaFileName] = fileContent;
    }
    
    // Mark this placeholder as replaced
    placeholder.replaced = true;
    placeholder.uploadedFileName = fileName;
    
    console.log(`[Source Pack] Replaced placeholder ${placeholderId}: ${schemaFileName} with ${fileName}${extracted.converted ? ' (text extracted)' : ''}`);
    emitAiConsoleLog('system', `✓ Replaced ${placeholder.name} with ${fileName}`, 'success');
    
    return {
        success: true,
        placeholderId,
        schemaFileName,
        uploadedFileName: fileName,
        converted: extracted.converted
    };
});

// Finalize and create ZIP with all documents
ipcMain.handle('sourcePack:finalizeZip', async (event) => {
    const fs = require('fs');
    const archiver = require('archiver');
    
    if (!appState.pendingSourcePack) {
        return { success: false, error: 'No pending source pack' };
    }
    
    const { requestId, client, context, documents, timestamp, hasOpenAI } = appState.pendingSourcePack;
    const pocFolder = '3.0_Client_Point_of_Contact_Info';
    const additionalFolder = '4.0_Additional_Client_Materials';
    
    // Count POC files
    const pocFilesCount = Object.keys(documents)
        .filter(k => k.startsWith(pocFolder + '/') && !k.endsWith('_INDEX.md'))
        .length;
    
    // Count additional files
    const additionalFilesCount = Object.keys(documents)
        .filter(k => k.startsWith(additionalFolder + '/'))
        .length;
    
    // Create index file for additional materials if any were added
    if (additionalFilesCount > 0) {
        const indexContent = `# Additional Client Materials

## Overview
This folder contains ${additionalFilesCount} supplementary document(s) added by the user during Source Pack generation.

## Contents
${Object.keys(documents)
    .filter(k => k.startsWith(additionalFolder + '/') && !k.endsWith('_INDEX.md'))
    .map(k => `- ${k.replace(additionalFolder + '/', '')}`)
    .join('\n')}

## Context
These materials were provided by **${appState.user?.name || 'the user'}** to supplement the automated research.

They may include:
- Internal strategy documents
- Client presentations or proposals  
- Meeting notes or call transcripts
- Additional third-party research
- Supporting data or analysis

---
*Added: ${new Date().toISOString()}*
*Source Pack: ${client.name}*
`;
        documents[`${additionalFolder}/_INDEX.md`] = indexContent;
        emitAiConsoleLog('system', `✓ ${additionalFilesCount} additional documents included in Source Pack`, 'success');
    }
    
    // Create ZIP file
    const zipFileName = `SourcePack_${client.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.zip`;
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: zipFileName,
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    
    if (result.canceled) {
        return { success: false, canceled: true };
    }
    
    try {
        // Write ZIP
        const output = fs.createWriteStream(result.filePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.pipe(output);
        
        // Add all documents to ZIP
        for (const [filename, content] of Object.entries(documents)) {
            archive.append(content, { name: filename });
        }
        
        // Add metadata
        const metadata = {
            client: client.name,
            industry: client.industry,
            geography: client.geography,
            sector: client.sector,
            generatedAt: new Date().toISOString(),
            generatedBy: appState.user?.name || 'Unknown',
            requestId: requestId,
            openaiEnabled: hasOpenAI,
            additionalFilesCount: additionalFilesCount,
            context: context
        };
        archive.append(JSON.stringify(metadata, null, 2), { name: '_metadata.json' });
        
        await archive.finalize();
        
        auditLogger.log('RETRIEVAL', 'ZIP_GENERATION_COMPLETED', { 
            requestId, 
            filePath: result.filePath,
            documentCount: Object.keys(documents).length,
            additionalFilesCount
        });
        
        // Keep a deep copy for narrative generation (don't clear pending - user may want to generate narrative later)
        appState.lastSourcePack = JSON.parse(JSON.stringify(appState.pendingSourcePack));
        console.log('[SourcePack] Saved lastSourcePack with documents:', Object.keys(appState.lastSourcePack.documents || {}));
        // Keep pendingSourcePack available for narrative generation
        // appState.pendingSourcePack = null;
        
        return {
            success: true,
            requestId,
            filePath: result.filePath,
            documentCount: Object.keys(documents).length,
            additionalFilesCount
        };
        
    } catch (error) {
        auditLogger.log('RETRIEVAL', 'ZIP_FINALIZATION_FAILED', { requestId, error: error.message });
        return { success: false, error: error.message };
    }
});

// ============================================
// Template Management
// ============================================

// Initialize templates from persistent storage
if (!appState.templates) {
    appState.templates = credentialManager.loadAppData('narrativeTemplates') || [];
}

// Initialize default prompt from persistent storage
if (!appState.defaultAgentPrompt) {
    appState.defaultAgentPrompt = credentialManager.loadAppData('defaultAgentPrompt') || '';
}

// Helper to persist templates
function persistTemplates() {
    // Only persist admin templates (not session-only custom ones)
    const adminTemplates = appState.templates.filter(t => t.isAdmin);
    credentialManager.saveAppData('narrativeTemplates', adminTemplates);
}

// Get all templates
ipcMain.handle('templates:getAll', async () => {
    return appState.templates || [];
});

// Add admin template
ipcMain.handle('templates:addAdmin', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Narrative Template',
        filters: [
            { name: 'Word Documents', extensions: ['docx', 'doc'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    
    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    
    // Prompt for title and description
    // For now, use filename as title
    const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    
    try {
        // Read file content
        const content = fs.readFileSync(filePath);
        
        const template = {
            id: 'tpl_' + Date.now(),
            title: title,
            filename: filename,
            description: `Template from ${filename}`,
            content: content.toString('base64'),
            createdAt: new Date().toISOString(),
            isAdmin: true
        };
        
        appState.templates.push(template);
        
        // Persist to disk
        persistTemplates();
        
        auditLogger.log('ADMIN', 'TEMPLATE_ADDED', { 
            templateId: template.id, 
            title: template.title,
            filename: template.filename
        });
        
        return { success: true, ...template };
    } catch (error) {
        console.error('Error adding template:', error);
        return { success: false, error: error.message };
    }
});

// Upload custom template for session
ipcMain.handle('templates:uploadCustom', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Upload Custom Template',
        filters: [
            { name: 'Word Documents', extensions: ['docx', 'doc'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    
    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') + ' (Custom)';
    
    try {
        const content = fs.readFileSync(filePath);
        
        const template = {
            id: 'custom_' + Date.now(),
            title: title,
            filename: filename,
            description: 'Custom template uploaded for this session',
            content: content.toString('base64'),
            createdAt: new Date().toISOString(),
            isAdmin: false
        };
        
        appState.templates.push(template);
        
        return { success: true, ...template };
    } catch (error) {
        console.error('Error uploading custom template:', error);
        return { success: false, error: error.message };
    }
});

// Delete template
ipcMain.handle('templates:delete', async (event, templateId) => {
    const index = appState.templates.findIndex(t => t.id === templateId);
    if (index === -1) {
        return { success: false, error: 'Template not found' };
    }
    
    const template = appState.templates[index];
    appState.templates.splice(index, 1);
    
    // Persist to disk
    persistTemplates();
    
    auditLogger.log('ADMIN', 'TEMPLATE_DELETED', { 
        templateId: template.id, 
        title: template.title 
    });
    
    return { success: true };
});

// Get default agent prompt
ipcMain.handle('settings:getDefaultPrompt', async () => {
    return appState.defaultAgentPrompt || '';
});

// Save default agent prompt
ipcMain.handle('settings:saveDefaultPrompt', async (event, prompt) => {
    appState.defaultAgentPrompt = prompt || '';
    
    // Persist to disk
    credentialManager.saveAppData('defaultAgentPrompt', prompt || '');
    
    auditLogger.log('ADMIN', 'DEFAULT_PROMPT_UPDATED', { 
        promptLength: prompt?.length || 0 
    });
    
    return { success: true };
});

// Get source generation prompts
ipcMain.handle('settings:getSourcePrompts', async () => {
    const prompts = credentialManager.loadAppData('sourcePrompts') || {
        chatgpt: 'Generate a comprehensive research report on {clientName} including company overview, recent news, market position, competitors, and strategic initiatives.',
        arc: 'Research Accenture assets and solutions relevant to {clientName} in the {industry} industry, focusing on transformation capabilities and case studies.',
        alphasense: 'Provide market intelligence and analyst insights on {clientName}, including financial performance, industry trends, and competitive landscape.'
    };
    return prompts;
});

// Save source generation prompts
ipcMain.handle('settings:saveSourcePrompts', async (event, prompts) => {
    credentialManager.saveAppData('sourcePrompts', prompts);
    
    auditLogger.log('ADMIN', 'SOURCE_PROMPTS_UPDATED', { 
        sources: Object.keys(prompts)
    });
    
    return { success: true };
});

// ============================================
// Learning System IPC Handlers
// ============================================

// Capture a behavioral signal
ipcMain.handle('learnings:captureSignal', async (event, signal) => {
    try {
        const captured = captureSignal(signal);
        return { success: true, signal: captured };
    } catch (error) {
        console.error('[Learnings] Error capturing signal:', error);
        return { success: false, error: error.message };
    }
});

// Get current learnings
ipcMain.handle('learnings:get', async () => {
    return appState.learnings;
});

// Run inference on recent signals to extract learnings
ipcMain.handle('learnings:runInference', async () => {
    try {
        const result = await runLearningInference();
        return { success: true, result };
    } catch (error) {
        console.error('[Learnings] Inference error:', error);
        return { success: false, error: error.message };
    }
});

// Get learnings formatted for prompt injection
ipcMain.handle('learnings:getForPrompt', async (event, { client, industry }) => {
    try {
        const instructions = buildLearnedInstructions(appState.learnings, client, industry);
        return { success: true, instructions };
    } catch (error) {
        console.error('[Learnings] Error building instructions:', error);
        return { success: false, error: error.message };
    }
});

// Clear all learnings (reset)
ipcMain.handle('learnings:clear', async () => {
    appState.learnings = getDefaultLearnings();
    saveLearnings();
    
    auditLogger.log('ADMIN', 'LEARNINGS_CLEARED', {});
    
    return { success: true };
});

// Update a specific preference manually
ipcMain.handle('learnings:updatePreference', async (event, { category, key, value }) => {
    try {
        if (appState.learnings.preferences[category]) {
            appState.learnings.preferences[category][key] = value;
            saveLearnings();
            return { success: true };
        }
        return { success: false, error: 'Invalid category' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Get learning statistics
ipcMain.handle('learnings:getStats', async () => {
    return {
        ...appState.learnings.stats,
        lastUpdated: appState.learnings.lastUpdated,
        lastInferenceRun: appState.learnings.lastInferenceRun,
        evidenceCount: appState.learnings.evidenceLog.length,
        preferences: {
            toneConfidence: appState.learnings.preferences.tone.confidence,
            structureConfidence: appState.learnings.preferences.structure.confidence,
            contentConfidence: appState.learnings.preferences.content.confidence,
            vocabularyConfidence: appState.learnings.preferences.vocabulary.confidence
        }
    };
});

/**
 * Run AI-powered inference on recent signals to extract learnings
 */
async function runLearningInference() {
    console.log('[Learnings] Running inference on recent signals...');
    
    // Get OpenAI credentials
    const openaiCreds = await credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        throw new Error('OpenAI API key not configured');
    }
    
    // Get recent signals (last 50)
    const recentSignals = appState.learnings.evidenceLog.slice(-50);
    
    if (recentSignals.length < 3) {
        console.log('[Learnings] Not enough signals for inference');
        return { skipped: true, reason: 'Not enough signals (need at least 3)' };
    }
    
    // Prepare signals for analysis (strip large content)
    const signalsForAnalysis = recentSignals.map(s => ({
        timestamp: s.timestamp,
        type: s.type,
        section: s.section,
        userRequest: s.userRequest,
        highlightedTextPreview: s.highlightedText?.substring(0, 200),
        client: s.client?.name,
        industry: s.industry,
        iterationType: s.iterationType,
        wasAccepted: s.wasAccepted
    }));
    
    const inferencePrompt = `You are a learning system analyzing user behavior to understand their narrative writing preferences.

CURRENT LEARNED PREFERENCES:
${JSON.stringify(appState.learnings.preferences, null, 2)}

RECENT USER SIGNALS (${signalsForAnalysis.length} signals):
${JSON.stringify(signalsForAnalysis, null, 2)}

Analyze these behavioral signals and extract learnings about the user's preferences. Consider:

1. ITERATION SIGNALS: When users iterate on text, they're teaching what they DON'T want
   - Highlighted text + rewrite requests reveal style/content issues
   - Multiple iterations on same section = that section template needs improvement
   
2. ACCEPTANCE SIGNALS: When users accept without iteration, the output was good
   - Low iteration count = good default generation
   
3. PATTERNS: Look for repeated behaviors across signals
   - Consistent vocabulary corrections → learn preferred terms
   - Always expanding certain sections → those need more depth by default
   - Always shortening sections → those are too verbose

Return a JSON object (no markdown code blocks) with this exact structure:
{
  "newLearnings": [
    {
      "category": "tone|structure|content|vocabulary",
      "type": "preferred|avoid",
      "value": "specific learning",
      "confidence": 0.5,
      "evidence": "which signals support this"
    }
  ],
  "vocabularyReplacements": {
    "old_term": "new_term"
  },
  "sectionInsights": {
    "section_name": {
      "avgIterations": 0,
      "commonIssues": ["issue1"],
      "recommendation": "how to improve"
    }
  },
  "industryInsights": {
    "industry_name": {
      "emphasize": ["topic1"],
      "tone": "measured|bold|technical"
    }
  },
  "clientInsights": {
    "client_name": {
      "preferredThemes": ["theme1"],
      "focusAreas": ["area1"]
    }
  },
  "overallAssessment": "Brief summary of what we learned"
}`;

    const model = openaiCreds.model || 'gpt-4o';
    const response = await callOpenAI(openaiCreds.apiKey, model, [
        { role: 'system', content: 'You are an expert at inferring user preferences from behavioral signals. Return only valid JSON, no markdown formatting.' },
        { role: 'user', content: inferencePrompt }
    ], 3000);
    
    // Parse the response
    let inferences;
    try {
        // Clean potential markdown code blocks
        const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        inferences = JSON.parse(cleanedResponse);
    } catch (parseError) {
        console.error('[Learnings] Failed to parse inference response:', parseError);
        console.log('[Learnings] Raw response:', response);
        throw new Error('Failed to parse learning inference results');
    }
    
    // Apply the inferences to our learnings
    applyInferences(inferences);
    
    // Update inference timestamp
    appState.learnings.lastInferenceRun = new Date().toISOString();
    saveLearnings();
    
    console.log('[Learnings] Inference complete:', inferences.overallAssessment);
    
    return inferences;
}

/**
 * Apply inferred learnings to the preference database
 */
function applyInferences(inferences) {
    // Apply new learnings
    if (inferences.newLearnings) {
        for (const learning of inferences.newLearnings) {
            const category = learning.category;
            if (!appState.learnings.preferences[category]) continue;
            
            const list = learning.type === 'preferred' ? 'preferred' : 'avoid';
            
            // Add if not already present
            if (!appState.learnings.preferences[category][list].includes(learning.value)) {
                appState.learnings.preferences[category][list].push(learning.value);
            }
            
            // Update confidence (weighted average)
            const oldConf = appState.learnings.preferences[category].confidence;
            const oldCount = appState.learnings.preferences[category].evidenceCount;
            const newConf = (oldConf * oldCount + learning.confidence) / (oldCount + 1);
            appState.learnings.preferences[category].confidence = Math.min(0.95, newConf);
            appState.learnings.preferences[category].evidenceCount++;
        }
    }
    
    // Apply vocabulary replacements
    if (inferences.vocabularyReplacements) {
        appState.learnings.preferences.vocabulary.replacements = {
            ...appState.learnings.preferences.vocabulary.replacements,
            ...inferences.vocabularyReplacements
        };
    }
    
    // Apply section insights
    if (inferences.sectionInsights) {
        for (const [section, insight] of Object.entries(inferences.sectionInsights)) {
            appState.learnings.sectionPatterns[section] = {
                ...appState.learnings.sectionPatterns[section],
                ...insight,
                lastUpdated: new Date().toISOString()
            };
        }
    }
    
    // Apply industry insights
    if (inferences.industryInsights) {
        for (const [industry, insight] of Object.entries(inferences.industryInsights)) {
            appState.learnings.contextual.byIndustry[industry] = {
                ...appState.learnings.contextual.byIndustry[industry],
                ...insight,
                confidence: 0.7,
                lastUpdated: new Date().toISOString()
            };
        }
    }
    
    // Apply client insights
    if (inferences.clientInsights) {
        for (const [client, insight] of Object.entries(inferences.clientInsights)) {
            appState.learnings.contextual.byClient[client] = {
                ...appState.learnings.contextual.byClient[client],
                ...insight,
                lastUpdated: new Date().toISOString()
            };
        }
    }
}

/**
 * Build learned instructions for injection into narrative generation prompts
 */
function buildLearnedInstructions(learnings, client, industry) {
    const instructions = [];
    const minConfidence = 0.5; // Only include learnings we're somewhat confident about
    
    // Tone preferences
    if (learnings.preferences.tone.confidence >= minConfidence) {
        if (learnings.preferences.tone.preferred.length > 0) {
            instructions.push(`TONE: Write in a ${learnings.preferences.tone.preferred.join(', ')} style.`);
        }
        if (learnings.preferences.tone.avoid.length > 0) {
            instructions.push(`TONE - AVOID: Do not use ${learnings.preferences.tone.avoid.join(', ')} language.`);
        }
    }
    
    // Structure preferences
    if (learnings.preferences.structure.confidence >= minConfidence) {
        if (learnings.preferences.structure.preferredLength) {
            instructions.push(`LENGTH: Target ${learnings.preferences.structure.preferredLength} length narratives.`);
        }
        if (learnings.preferences.structure.weakSections.length > 0) {
            instructions.push(`SECTIONS NEEDING ATTENTION: Pay extra care to these sections which often need revision: ${learnings.preferences.structure.weakSections.join(', ')}`);
        }
    }
    
    // Content preferences
    if (learnings.preferences.content.confidence >= minConfidence) {
        if (learnings.preferences.content.emphasize.length > 0) {
            instructions.push(`CONTENT EMPHASIS: Make sure to include ${learnings.preferences.content.emphasize.join(', ')}`);
        }
        if (learnings.preferences.content.avoid.length > 0) {
            instructions.push(`CONTENT TO AVOID: Do not include ${learnings.preferences.content.avoid.join(', ')}`);
        }
    }
    
    // Vocabulary preferences
    if (learnings.preferences.vocabulary.confidence >= minConfidence) {
        if (learnings.preferences.vocabulary.preferred.length > 0) {
            instructions.push(`PREFERRED VOCABULARY: Use words like: ${learnings.preferences.vocabulary.preferred.join(', ')}`);
        }
        if (learnings.preferences.vocabulary.avoid.length > 0) {
            instructions.push(`VOCABULARY TO AVOID: Don't use: ${learnings.preferences.vocabulary.avoid.join(', ')}`);
        }
        const replacements = Object.entries(learnings.preferences.vocabulary.replacements);
        if (replacements.length > 0) {
            const replaceStr = replacements.map(([from, to]) => `"${from}" → "${to}"`).join(', ');
            instructions.push(`WORD REPLACEMENTS: Use these substitutions: ${replaceStr}`);
        }
    }
    
    // Section-specific guidance
    for (const [section, data] of Object.entries(learnings.sectionPatterns)) {
        if (data.recommendation) {
            instructions.push(`${section.toUpperCase()}: ${data.recommendation}`);
        }
        if (data.commonIssues && data.commonIssues.length > 0) {
            instructions.push(`${section.toUpperCase()} - COMMON ISSUES: Avoid these: ${data.commonIssues.join(', ')}`);
        }
    }
    
    // Industry-specific learnings
    const industryKey = industry || client?.industry;
    if (industryKey) {
        const industryLearnings = learnings.contextual.byIndustry[industryKey];
        if (industryLearnings && industryLearnings.confidence >= minConfidence) {
            if (industryLearnings.emphasize && industryLearnings.emphasize.length > 0) {
                instructions.push(`INDUSTRY (${industryKey}): Emphasize ${industryLearnings.emphasize.join(', ')}`);
            }
            if (industryLearnings.tone) {
                instructions.push(`INDUSTRY TONE (${industryKey}): Use a ${industryLearnings.tone} tone`);
            }
        }
    }
    
    // Client-specific learnings
    const clientName = typeof client === 'string' ? client : client?.name;
    if (clientName) {
        const clientLearnings = learnings.contextual.byClient[clientName];
        if (clientLearnings) {
            if (clientLearnings.preferredThemes && clientLearnings.preferredThemes.length > 0) {
                instructions.push(`CLIENT (${clientName}): Focus on these themes: ${clientLearnings.preferredThemes.join(', ')}`);
            }
            if (clientLearnings.focusAreas && clientLearnings.focusAreas.length > 0) {
                instructions.push(`CLIENT FOCUS AREAS: ${clientLearnings.focusAreas.join(', ')}`);
            }
        }
    }
    
    if (instructions.length === 0) {
        return ''; // No learnings yet
    }
    
    return `=== LEARNED USER PREFERENCES ===
The following preferences have been learned from past user behavior. Apply these to improve the narrative:

${instructions.join('\n')}

=== END LEARNED PREFERENCES ===`;
}

// ============================================
// File Operations
// ============================================

// Open file dialog
ipcMain.handle('files:open', async (event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: options.title || 'Select File',
        filters: options.filters || [
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: options.properties || ['openFile']
    });
    
    return result;
});

// Read file contents
ipcMain.handle('files:read', async (event, filePath) => {
    const fs = require('fs');
    
    try {
        const content = fs.readFileSync(filePath);
        return content;
    } catch (error) {
        console.error('[Files] Error reading file:', error);
        throw error;
    }
});

// Open external URL in browser
ipcMain.handle('shell:openExternal', async (event, url) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        console.error('[Shell] Error opening URL:', error);
        return { success: false, error: error.message };
    }
});

// Open file path
ipcMain.handle('shell:openPath', async (event, filePath) => {
    try {
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('[Shell] Error opening path:', error);
        return { success: false, error: error.message };
    }
});

// Generate Client Intel Pack
ipcMain.handle('intelPack:generate', async (event, { narrative, pocContent, clientName }) => {
    const requestId = 'intelpack_' + Date.now();
    
    console.log('[Intel Pack] Starting generation...');
    
    try {
        // Send progress to AI console
        mainWindow.webContents.send('ai-console-log', {
            agent: 'intel-pack',
            message: `Analyzing narrative and POC document for ${clientName}...`,
            type: 'info'
        });
        
        // Try to get the EXTRACTED POC text from the source pack (properly parsed from PDF/DOCX)
        // This is much better than the raw file buffer
        let pocContentStr = '';
        
        if (appState.pendingSourcePack?.documents) {
            // Look for POC content in the source pack documents
            const allKeys = Object.keys(appState.pendingSourcePack.documents);
            console.log(`[Intel Pack] Source pack has ${allKeys.length} documents:`, allKeys.slice(0, 10).join(', '));
            
            const pocKeys = allKeys.filter(key => 
                key.includes('Client_Point_of_Contact_Info') || key.includes('poc_info')
            );
            console.log(`[Intel Pack] Found ${pocKeys.length} POC-related keys:`, pocKeys);
            
            if (pocKeys.length > 0) {
                // Combine all POC-related documents
                pocContentStr = pocKeys.map(key => {
                    const content = appState.pendingSourcePack.documents[key];
                    // Skip index files, get actual content
                    if (key.endsWith('_INDEX.md')) return '';
                    console.log(`[Intel Pack] POC key "${key}" has ${content?.length || 0} chars`);
                    return content;
                }).filter(c => c).join('\n\n---\n\n');
                
                console.log(`[Intel Pack] Using extracted POC text from source pack (${pocContentStr.length} chars from ${pocKeys.length} files)`);
            }
        } else {
            console.log('[Intel Pack] WARNING: appState.pendingSourcePack.documents is empty or undefined');
        }
        
        // Fallback to the raw pocContent if we couldn't find extracted text
        if (!pocContentStr || pocContentStr.length < 100) {
            console.log('[Intel Pack] No extracted POC found in source pack, using raw content...');
            if (Buffer.isBuffer(pocContent)) {
                pocContentStr = pocContent.toString('utf8');
            } else if (typeof pocContent === 'object') {
                // If it's an object with data property (like Buffer.toJSON), convert it
                if (pocContent.type === 'Buffer' && Array.isArray(pocContent.data)) {
                    pocContentStr = Buffer.from(pocContent.data).toString('utf8');
                } else {
                    pocContentStr = JSON.stringify(pocContent);
                }
            } else if (typeof pocContent === 'string') {
                pocContentStr = pocContent;
            }
        }
        
        // Log the first 500 chars to verify we have real text
        console.log(`[Intel Pack] POC content preview: ${pocContentStr.substring(0, 500)}...`);
        
        // Truncate content to fit within token limits
        // GPT-4o has 128k context, but we want to stay well under rate limits
        // Aim for ~20k tokens max input (~80k chars), leaving room for output
        const MAX_NARRATIVE_CHARS = 30000;  // ~7500 tokens
        const MAX_POC_CHARS = 40000;        // ~10000 tokens
        
        const truncatedNarrative = narrative.length > MAX_NARRATIVE_CHARS 
            ? narrative.substring(0, MAX_NARRATIVE_CHARS) + '\n\n[... narrative truncated for brevity ...]'
            : narrative;
            
        const truncatedPoc = pocContentStr.length > MAX_POC_CHARS
            ? pocContentStr.substring(0, MAX_POC_CHARS) + '\n\n[... document truncated for brevity ...]'
            : pocContentStr;
        
        console.log(`[Intel Pack] Content sizes - Narrative: ${narrative.length} -> ${truncatedNarrative.length}, POC: ${pocContentStr.length} -> ${truncatedPoc.length}`);
        
        // Build the AI prompt for generating the Intel Pack content
        const intelPackPrompt = `You are an expert management consultant creating a Client Intel Pack - a stakeholder intelligence briefing for consultants who are about to meet senior leaders at ${clientName}.

## CRITICAL INSTRUCTION - READ CAREFULLY

**You MUST only use stakeholder names that are EXPLICITLY mentioned in the POC document provided below.**

DO NOT invent, fabricate, or make up any stakeholder names. No "John Smith", no "Jane Doe", no placeholder names.

If the POC document mentions "Andy Start, CEO" - use exactly that name.
If the POC document mentions "Sarah Johnson, CFO" - use exactly that name.

If NO specific names are provided in the POC document, then:
- State clearly that no named stakeholders were identified
- Provide role-based analysis instead (e.g., "The CEO/Permanent Secretary", "The CFO/Finance Director")
- Make it clear these are role-based recommendations, not specific individuals

---

## YOUR TASK

Follow this analytical process:

### STEP 1: ANALYSE THE NARRATIVE
First, carefully read the narrative document. Identify:
- The core strategic themes and value drivers
- The most compelling insights, data points, and "aha moments"
- Industry trends and market forces at play
- Transformation opportunities highlighted
- Any risks, challenges, or tensions mentioned

### STEP 2: EXTRACT REAL STAKEHOLDERS FROM THE POC DOCUMENT
Scan the POC document and LIST ONLY the actual people mentioned by name. Look for:
- Full names with titles/roles
- Email addresses that reveal names
- Meeting attendees
- Org chart references
- Signature blocks

**Write out the exact names you found before proceeding. If you cannot find real names, say so explicitly.**

### STEP 3: MATCH INSIGHTS TO THESE REAL STAKEHOLDERS
For each REAL stakeholder you identified (by their actual name from the POC), extract the "juiciest" parts of the narrative that would resonate with them specifically. Think about:
- What keeps this person up at night based on their role?
- What metrics/outcomes are they measured on?
- What would make them look good to their board/peers?
- What industry pressures affect their domain?

### STEP 4: ELABORATE WITH BROADER CONTEXT
Use your knowledge of:
- Industry best practices and benchmarks
- Common challenges faced by similar organizations
- Successful transformation examples from comparable companies
- Current market dynamics and competitive landscape

---

## OUTPUT STRUCTURE

### EXECUTIVE SNAPSHOT
2-3 sentences capturing the essence of the opportunity and why now is the right time to engage.

### STAKEHOLDERS IDENTIFIED
List the actual names and titles you found in the POC document. If none were found, state this clearly.

### STAKEHOLDER INTELLIGENCE

For EACH stakeholder you identified (using their REAL name from the POC document):

**[Name] - [Title]**
- **Their Likely Priorities**: Based on their role, what they're probably focused on
- **Narrative Hooks**: 2-3 specific quotes or insights from the narrative that would grab their attention, with brief explanation of why it matters to them
- **Conversation Angle**: How to frame the discussion to align with their agenda
- **Credibility Builders**: Industry stats, benchmarks, or examples that would resonate with their domain
- **Watch Out For**: Potential concerns or objections they might raise

### KEY INSIGHTS TO LEAD WITH
The 3-5 most compelling "soundbites" from the narrative that consultants should memorize - the kind of insights that make executives lean forward.

### STAKEHOLDER-SPECIFIC TALKING POINTS
A quick-reference matrix showing which narrative themes to emphasize with which stakeholder.

### CONVERSATION OPENERS
5-7 thought-provoking questions tailored to spark strategic dialogue, matched to specific stakeholders.

### SENSITIVITIES & LANDMINES
Topics to handle carefully based on what's implied in the documents or known about this industry/organization.

---

NARRATIVE CONTENT:
${truncatedNarrative}

---

POC DOCUMENT CONTENT:
${truncatedPoc}

---

Remember: This is a CHEAT SHEET for busy consultants. Make it scannable, punchy, and immediately actionable. Extract specific quotes and data points from the narrative - don't just summarize. The goal is to help consultants walk into meetings sounding like they deeply understand this client's world.`;

        // Call OpenAI using the rate-limited helper function
        const openaiCreds = credentialManager.getCredentials('openai');
        if (!openaiCreds || !openaiCreds.apiKey) {
            throw new Error('OpenAI API key not configured');
        }
        const intelPackContent = await callOpenAI(openaiCreds.apiKey, 'gpt-4o', [
            { role: 'system', content: 'You are an elite management consultant with 20+ years of experience advising C-suite executives. You excel at synthesizing complex information into actionable stakeholder intelligence. CRITICAL: You must ONLY use stakeholder names that are explicitly mentioned in the provided documents. NEVER invent or fabricate names like "John Smith" or "Jane Doe". If no real names are in the documents, use role-based analysis instead (e.g., "The CEO", "The CFO"). Be specific, cite the source material, and add value through your expertise.' },
            { role: 'user', content: intelPackPrompt }
        ], 4000);
        
        if (!intelPackContent) {
            throw new Error('No content generated from AI');
        }
        
        console.log('[Intel Pack] AI content generated, creating Word document...');
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'intel-pack',
            message: 'Creating Word document...',
            type: 'info'
        });
        
        // Create Word document
        const docxPkg = require('docx');
        const { Document, Paragraph, TextRun, HeadingLevel } = docxPkg;
        
        // Parse the markdown-like content into document elements
        const lines = intelPackContent.split('\n');
        const children = [];
        
        // Title
        children.push(
            new Paragraph({
                text: `Client Intel Pack: ${clientName}`,
                heading: HeadingLevel.TITLE,
                spacing: { after: 400 }
            })
        );
        
        // Date
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: `Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
                        italics: true,
                        color: '666666'
                    })
                ],
                spacing: { after: 400 }
            })
        );
        
        // Parse content
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (!trimmedLine) {
                children.push(new Paragraph({ text: '' }));
                continue;
            }
            
            if (trimmedLine.startsWith('### ')) {
                // H3 heading
                children.push(
                    new Paragraph({
                        text: trimmedLine.replace('### ', ''),
                        heading: HeadingLevel.HEADING_2,
                        spacing: { before: 300, after: 100 }
                    })
                );
            } else if (trimmedLine.startsWith('## ')) {
                // H2 heading
                children.push(
                    new Paragraph({
                        text: trimmedLine.replace('## ', ''),
                        heading: HeadingLevel.HEADING_1,
                        spacing: { before: 400, after: 200 }
                    })
                );
            } else if (trimmedLine.startsWith('- **') && trimmedLine.includes('**:')) {
                // Bold label with content
                const match = trimmedLine.match(/^- \*\*(.+?)\*\*:(.*)$/);
                if (match) {
                    children.push(
                        new Paragraph({
                            children: [
                                new TextRun({ text: '• ' }),
                                new TextRun({ text: match[1] + ': ', bold: true }),
                                new TextRun({ text: match[2].trim() })
                            ],
                            spacing: { after: 100 }
                        })
                    );
                } else {
                    children.push(new Paragraph({ text: trimmedLine }));
                }
            } else if (trimmedLine.startsWith('- ')) {
                // Bullet point
                children.push(
                    new Paragraph({
                        children: [
                            new TextRun({ text: '• ' + trimmedLine.substring(2) })
                        ],
                        spacing: { after: 100 }
                    })
                );
            } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                // Bold paragraph
                children.push(
                    new Paragraph({
                        children: [
                            new TextRun({ text: trimmedLine.replace(/\*\*/g, ''), bold: true })
                        ],
                        spacing: { after: 100 }
                    })
                );
            } else if (trimmedLine === '---') {
                // Horizontal rule - skip
                continue;
            } else {
                // Regular paragraph
                children.push(
                    new Paragraph({
                        text: trimmedLine,
                        spacing: { after: 100 }
                    })
                );
            }
        }
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: children
            }]
        });
        
        // Generate buffer
        const buffer = await docxPkg.Packer.toBuffer(doc);
        
        // Create default filename with timestamp
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const defaultFileName = `${sanitizedClientName}_Intel_Pack_${timestamp}.docx`;
        
        // Default to documents folder
        const documentsPath = app.getPath('documents');
        const defaultDir = path.join(documentsPath, 'R-StudioGPT', 'Intel Packs');
        
        // Ensure default directory exists (for the default path)
        if (!fs.existsSync(defaultDir)) {
            fs.mkdirSync(defaultDir, { recursive: true });
        }
        
        // Show Save As dialog
        const { dialog } = require('electron');
        const saveResult = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Client Intel Pack',
            defaultPath: path.join(defaultDir, defaultFileName),
            filters: [
                { name: 'Word Document', extensions: ['docx'] }
            ],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        });
        
        // User cancelled the dialog
        if (saveResult.canceled || !saveResult.filePath) {
            console.log('[Intel Pack] User cancelled save dialog');
            return { success: false, error: 'Save cancelled by user' };
        }
        
        const filePath = saveResult.filePath;
        
        fs.writeFileSync(filePath, buffer);
        
        console.log('[Intel Pack] Document saved to:', filePath);
        
        const savedFileName = path.basename(filePath);
        mainWindow.webContents.send('ai-console-log', {
            agent: 'intel-pack',
            message: `Intel Pack saved: ${savedFileName}`,
            type: 'success'
        });
        
        // Open the folder containing the file
        shell.showItemInFolder(filePath);
        
        return { success: true, filePath: filePath };
        
    } catch (error) {
        console.error('[Intel Pack] Error:', error);
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'intel-pack',
            message: `Error: ${error.message}`,
            type: 'error'
        });
        
        return { success: false, error: error.message };
    }
});

// Generate Workshop Materials (use uploaded templates or generate blank files)
ipcMain.handle('workshop:generate', async (event, { client }) => {
    const requestId = 'workshop_' + Date.now();
    
    console.log('[Workshop] Starting workshop materials generation...');
    
    // Check for uploaded templates
    const hasPptxTemplate = appState.workshopTemplates?.pptx?.content;
    const hasDocxTemplate = appState.workshopTemplates?.docx?.content;
    
    // Send to AI console for visibility
    mainWindow.webContents.send('ai-console-log', {
        agent: 'workshop',
        message: `Generating workshop materials for ${client?.name || 'Unknown'}...`,
        type: 'info'
    });
    
    if (hasPptxTemplate || hasDocxTemplate) {
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Using uploaded templates: PPTX=${hasPptxTemplate ? 'yes' : 'no'}, DOCX=${hasDocxTemplate ? 'yes' : 'no'}`,
            type: 'info'
        });
    }
    
    try {
        // Ask user where to save the files
        const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Folder for Workshop Materials',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Save Here'
        });
        
        if (canceled || !filePaths || filePaths.length === 0) {
            return { success: false, error: 'Save location not selected' };
        }
        
        const saveDir = filePaths[0];
        const clientName = (client?.name || 'Client').replace(/[^a-zA-Z0-9\s]/g, '').trim();
        // Include time in timestamp to avoid file conflicts when regenerating
        const now = new Date();
        const timestamp = `${now.toISOString().slice(0, 10)}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        const savedFiles = [];
        
        // Handle PPTX - use uploaded template with placeholder processing
        if (hasPptxTemplate) {
            // Use uploaded template and process placeholders
            const pptxBuffer = Buffer.from(appState.workshopTemplates.pptx.content, 'base64');
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Processing PPTX template with placeholders...`,
                type: 'info'
            });
            
            // Process template with placeholders
            const processedBuffer = await processTemplateWithPlaceholders(pptxBuffer, client, 'pptx');
            
            const pptxPath = path.join(saveDir, `${clientName}_Workshop_${timestamp}.pptx`);
            fs.writeFileSync(pptxPath, processedBuffer);
            savedFiles.push(pptxPath);
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Saved PPTX with filled placeholders: ${path.basename(pptxPath)}`,
                type: 'success'
            });
        } else {
            // Generate blank PPTX
            const pptx = new PptxGenJS();
            pptx.author = 'R/StudioGPT';
            pptx.title = `${clientName} Workshop Materials`;
            pptx.subject = 'Workshop Presentation';
            pptx.company = 'R/StudioGPT';
            
            // Add title slide
            let slide = pptx.addSlide();
            slide.addText(`${clientName}`, { 
                x: 0.5, y: 1.5, w: '90%', h: 1,
                fontSize: 36, bold: true, color: '363636',
                align: 'center'
            });
            slide.addText('Workshop Materials', { 
                x: 0.5, y: 2.5, w: '90%', h: 0.5,
                fontSize: 24, color: '666666',
                align: 'center'
            });
            slide.addText(`Generated: ${new Date().toLocaleDateString()}`, { 
                x: 0.5, y: 4.5, w: '90%', h: 0.3,
                fontSize: 12, color: '999999',
                align: 'center'
            });
            
            // Add a blank content slide
            let slide2 = pptx.addSlide();
            slide2.addText('Workshop Content', { 
                x: 0.5, y: 0.5, w: '90%', h: 0.5,
                fontSize: 24, bold: true, color: '363636'
            });
            slide2.addText('Add your content here...', { 
                x: 0.5, y: 1.5, w: '90%', h: 0.3,
                fontSize: 14, color: '666666'
            });
            
            const pptxPath = path.join(saveDir, `${clientName}_Workshop_${timestamp}.pptx`);
            await pptx.writeFile({ fileName: pptxPath });
            savedFiles.push(pptxPath);
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Generated blank PPTX: ${path.basename(pptxPath)}`,
                type: 'success'
            });
        }
        
        // Handle DOCX - use uploaded template with placeholder processing
        if (hasDocxTemplate) {
            // Use uploaded template and process placeholders
            const docxBuffer = Buffer.from(appState.workshopTemplates.docx.content, 'base64');
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Processing DOCX template with placeholders...`,
                type: 'info'
            });
            
            // Process template with placeholders
            const processedBuffer = await processTemplateWithPlaceholders(docxBuffer, client, 'docx');
            
            const docxPath = path.join(saveDir, `${clientName}_Workshop_Notes_${timestamp}.docx`);
            fs.writeFileSync(docxPath, processedBuffer);
            savedFiles.push(docxPath);
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Saved DOCX with filled placeholders: ${path.basename(docxPath)}`,
                type: 'success'
            });
        } else {
            // Generate blank DOCX
            const doc = new Document({
                creator: 'R/StudioGPT',
                title: `${clientName} Workshop Notes`,
                description: 'Workshop notes document',
                sections: [{
                    properties: {},
                    children: [
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: clientName,
                                    bold: true,
                                    size: 48
                                })
                            ],
                            heading: HeadingLevel.TITLE
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: 'Workshop Notes',
                                    size: 32,
                                    color: '666666'
                                })
                            ],
                            heading: HeadingLevel.HEADING_1
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: `Generated: ${new Date().toLocaleDateString()}`,
                                    size: 20,
                                    color: '999999'
                                })
                            ]
                        }),
                        new Paragraph({ children: [] }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: 'Meeting Notes',
                                    bold: true,
                                    size: 28
                                })
                            ],
                            heading: HeadingLevel.HEADING_2
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: 'Add your workshop notes here...',
                                    size: 22,
                                    color: '666666'
                                })
                            ]
                        }),
                        new Paragraph({ children: [] }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: 'Action Items',
                                    bold: true,
                                    size: 28
                                })
                            ],
                            heading: HeadingLevel.HEADING_2
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: '• ', size: 22 }),
                                new TextRun({ text: 'Action item 1', size: 22, color: '666666' })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: '• ', size: 22 }),
                                new TextRun({ text: 'Action item 2', size: 22, color: '666666' })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: '• ', size: 22 }),
                                new TextRun({ text: 'Action item 3', size: 22, color: '666666' })
                            ]
                        })
                    ]
                }]
            });
            
            const docxPath = path.join(saveDir, `${clientName}_Workshop_Notes_${timestamp}.docx`);
            const buffer = await Packer.toBuffer(doc);
            fs.writeFileSync(docxPath, buffer);
            savedFiles.push(docxPath);
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Generated blank DOCX: ${path.basename(docxPath)}`,
                type: 'success'
            });
        }
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Workshop materials saved to: ${saveDir}`,
            type: 'success'
        });
        
        auditLogger.log('EXPORT', 'WORKSHOP_MATERIALS_GENERATED', {
            client: client?.name,
            files: savedFiles.map(f => path.basename(f)),
            usedTemplates: { pptx: hasPptxTemplate, docx: hasDocxTemplate },
            location: saveDir
        });
        
        return { 
            success: true, 
            files: savedFiles,
            message: 'Workshop materials generated successfully'
        };
        
    } catch (error) {
        console.error('[Workshop] Error generating materials:', error);
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Error: ${error.message}`,
            type: 'error'
        });
        
        return { success: false, error: error.message };
    }
});

// Upload workshop template
ipcMain.handle('workshop:uploadTemplate', async (event, type) => {
    const filters = type === 'pptx' 
        ? [{ name: 'PowerPoint Files', extensions: ['pptx', 'ppt'] }]
        : [{ name: 'Word Documents', extensions: ['docx', 'doc'] }];
    
    const result = await dialog.showOpenDialog(mainWindow, {
        title: `Select ${type.toUpperCase()} Template`,
        filters: filters,
        properties: ['openFile']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    
    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    
    try {
        // Read file content
        const content = fs.readFileSync(filePath);
        
        const template = {
            filename: filename,
            content: content.toString('base64'),
            uploadedAt: new Date().toISOString()
        };
        
        appState.workshopTemplates[type] = template;
        
        // Persist to disk
        credentialManager.saveAppData('workshopTemplates', appState.workshopTemplates);
        
        auditLogger.log('ADMIN', 'WORKSHOP_TEMPLATE_UPLOADED', { 
            type: type,
            filename: filename
        });
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'admin',
            message: `Workshop ${type.toUpperCase()} template uploaded: ${filename}`,
            type: 'success'
        });
        
        return { success: true, filename: filename };
    } catch (error) {
        console.error('Error uploading workshop template:', error);
        return { success: false, error: error.message };
    }
});

// Clear workshop template
ipcMain.handle('workshop:clearTemplate', async (event, type) => {
    const oldFilename = appState.workshopTemplates[type]?.filename;
    
    appState.workshopTemplates[type] = null;
    
    // Persist to disk
    credentialManager.saveAppData('workshopTemplates', appState.workshopTemplates);
    
    auditLogger.log('ADMIN', 'WORKSHOP_TEMPLATE_CLEARED', { 
        type: type,
        previousFilename: oldFilename
    });
    
    mainWindow.webContents.send('ai-console-log', {
        agent: 'admin',
        message: `Workshop ${type.toUpperCase()} template cleared`,
        type: 'info'
    });
    
    return { success: true };
});

// Get workshop templates status
ipcMain.handle('workshop:getTemplates', async () => {
    return {
        pptx: appState.workshopTemplates?.pptx ? {
            filename: appState.workshopTemplates.pptx.filename,
            uploadedAt: appState.workshopTemplates.pptx.uploadedAt
        } : null,
        docx: appState.workshopTemplates?.docx ? {
            filename: appState.workshopTemplates.docx.filename,
            uploadedAt: appState.workshopTemplates.docx.uploadedAt
        } : null
    };
});

// ============================================
// Client Narratives Storage
// ============================================

// Get all narratives for a client
ipcMain.handle('narratives:getForClient', async (event, clientId) => {
    const allNarratives = credentialManager.loadAppData('clientNarratives') || {};
    return allNarratives[clientId] || [];
});

// Save a narrative for a client
ipcMain.handle('narratives:save', async (event, { clientId, narrative }) => {
    const allNarratives = credentialManager.loadAppData('clientNarratives') || {};
    
    if (!allNarratives[clientId]) {
        allNarratives[clientId] = [];
    }
    
    const newNarrative = {
        id: 'narr_' + Date.now(),
        content: narrative.content,
        timestamp: new Date().toISOString(),
        outputIntent: narrative.outputIntent || 'Executive Narrative',
        wordCount: narrative.content?.split(/\s+/).length || 0
    };
    
    // Add to beginning of array (newest first)
    allNarratives[clientId].unshift(newNarrative);
    
    // Keep only last 20 narratives per client
    if (allNarratives[clientId].length > 20) {
        allNarratives[clientId] = allNarratives[clientId].slice(0, 20);
    }
    
    credentialManager.saveAppData('clientNarratives', allNarratives);
    
    auditLogger.log('NARRATIVE', 'NARRATIVE_SAVED', { 
        clientId, 
        narrativeId: newNarrative.id,
        wordCount: newNarrative.wordCount
    });
    
    return { success: true, narrative: newNarrative };
});

// Delete a narrative
ipcMain.handle('narratives:delete', async (event, { clientId, narrativeId }) => {
    const allNarratives = credentialManager.loadAppData('clientNarratives') || {};
    
    if (allNarratives[clientId]) {
        allNarratives[clientId] = allNarratives[clientId].filter(n => n.id !== narrativeId);
        credentialManager.saveAppData('clientNarratives', allNarratives);
    }
    
    return { success: true };
});

// ============================================
// Video Generation (Runway ML)
// ============================================

ipcMain.handle('video:generate', async (event, options) => {
    try {
        const runwayCredentials = credentialManager.getCredentials('runway');
        
        if (!runwayCredentials?.apiKey) {
            return { success: false, error: 'Runway ML API key not configured. Please add it in Admin settings.' };
        }
        
        const { promptText, duration, ratio, audio } = options;
        const model = runwayCredentials.model || 'veo3';
        
        console.log('[Video] Starting generation with model:', model);
        console.log('[Video] Prompt:', promptText?.substring(0, 100) + '...');
        
        // Use the Runway SDK
        const RunwayML = require('@runwayml/sdk').default;
        const client = new RunwayML({ apiKey: runwayCredentials.apiKey });
        
        // Start the text-to-video task
        console.log('[Video] Creating text-to-video task...');
        const task = await client.textToVideo.create({
            model: model,
            promptText: promptText,
            ratio: ratio || '1920:1080',
            duration: duration || 8,
            audio: audio !== false
        });
        
        console.log('[Video] Task created, waiting for output. Task ID:', task.id);
        
        // Poll for task completion
        const completedTask = await client.tasks.retrieve(task.id).waitForTaskOutput();
        
        console.log('[Video] Task completed:', completedTask.status);
        
        if (completedTask.status === 'SUCCEEDED' && completedTask.output && completedTask.output.length > 0) {
            const videoUrl = completedTask.output[0];
            console.log('[Video] Video URL:', videoUrl);
            
            return {
                success: true,
                videoUrl: videoUrl,
                taskId: task.id
            };
        } else if (completedTask.status === 'FAILED') {
            console.error('[Video] Task failed:', completedTask.failure);
            return {
                success: false,
                error: completedTask.failure?.message || 'Video generation failed'
            };
        } else {
            return {
                success: false,
                error: 'Unexpected task status: ' + completedTask.status
            };
        }
    } catch (error) {
        console.error('[Video] Generation error:', error);
        return {
            success: false,
            error: error.message || 'Video generation failed'
        };
    }
});

// ============================================
// Narration Generation (ElevenLabs)
// ============================================

ipcMain.handle('narration:generate', async (event, options) => {
    try {
        const elevenlabsCredentials = credentialManager.getCredentials('elevenlabs');
        
        if (!elevenlabsCredentials?.apiKey) {
            return { success: false, error: 'ElevenLabs API key not configured. Please add it in Admin settings.' };
        }
        
        const { text, voiceId, modelId } = options;
        
        if (!text || text.trim().length === 0) {
            return { success: false, error: 'No text provided for narration.' };
        }
        
        console.log('[Narration] Starting generation...');
        console.log('[Narration] Text length:', text.length);
        console.log('[Narration] Voice ID:', voiceId);
        console.log('[Narration] Model:', modelId);
        
        // Call ElevenLabs API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsCredentials.apiKey
            },
            body: JSON.stringify({
                text: text,
                model_id: modelId || 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                }
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Narration] API error:', response.status, errorData);
            return {
                success: false,
                error: errorData.detail?.message || `ElevenLabs API error: ${response.status}`
            };
        }
        
        // Get the audio data as a buffer
        const audioBuffer = await response.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        
        console.log('[Narration] Audio generated, size:', audioBuffer.byteLength, 'bytes');
        
        // Save to history
        const narrationId = Date.now().toString();
        const narrationHistory = credentialManager.loadAppData('narrationHistory') || [];
        
        const historyItem = {
            id: narrationId,
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            fullText: text,
            voiceId: voiceId,
            modelId: modelId,
            audioBase64: audioBase64,
            createdAt: new Date().toISOString(),
            size: audioBuffer.byteLength
        };
        
        // Keep only last 10 narrations
        narrationHistory.unshift(historyItem);
        if (narrationHistory.length > 10) {
            narrationHistory.pop();
        }
        
        credentialManager.saveAppData('narrationHistory', narrationHistory);
        
        return {
            success: true,
            audioBase64: audioBase64,
            narrationId: narrationId,
            size: audioBuffer.byteLength
        };
    } catch (error) {
        console.error('[Narration] Generation error:', error);
        return {
            success: false,
            error: error.message || 'Narration generation failed'
        };
    }
});

ipcMain.handle('narration:getHistory', async () => {
    const history = credentialManager.loadAppData('narrationHistory') || [];
    // Return without the full audio data to keep response light
    return history.map(item => ({
        id: item.id,
        text: item.text,
        voiceId: item.voiceId,
        modelId: item.modelId,
        createdAt: item.createdAt,
        size: item.size,
        hasAudio: !!item.audioBase64
    }));
});

ipcMain.handle('narration:clearHistory', async () => {
    credentialManager.saveAppData('narrationHistory', []);
    return { success: true };
});

ipcMain.handle('narration:deleteHistoryItem', async (event, id) => {
    const history = credentialManager.loadAppData('narrationHistory') || [];
    const filtered = history.filter(item => item.id !== id);
    credentialManager.saveAppData('narrationHistory', filtered);
    return { success: true };
});

// Get full narration audio by ID
ipcMain.handle('narration:getAudio', async (event, id) => {
    const history = credentialManager.loadAppData('narrationHistory') || [];
    const item = history.find(h => h.id === id);
    if (item && item.audioBase64) {
        return { success: true, audioBase64: item.audioBase64 };
    }
    return { success: false, error: 'Audio not found' };
});

// Generate audio narration from narrative (OpenAI script generation + ElevenLabs TTS)
ipcMain.handle('narration:generateFromNarrative', async (event, options) => {
    try {
        const openaiCredentials = credentialManager.getCredentials('openai');
        const elevenlabsCredentials = credentialManager.getCredentials('elevenlabs');
        
        if (!openaiCredentials?.apiKey) {
            return { success: false, error: 'OpenAI API key not configured. Please add it in Admin settings.' };
        }
        
        if (!elevenlabsCredentials?.apiKey) {
            return { success: false, error: 'ElevenLabs API key not configured. Please add it in Admin settings.' };
        }
        
        const { narrativeContent, clientName, voiceId, tone } = options;
        
        if (!narrativeContent || narrativeContent.trim().length === 0) {
            return { success: false, error: 'No narrative content provided.' };
        }
        
        console.log('[NarrativeAudio] Starting generation...');
        console.log('[NarrativeAudio] Client:', clientName);
        console.log('[NarrativeAudio] Tone:', tone);
        console.log('[NarrativeAudio] Narrative length:', narrativeContent.length);
        
        // Send progress update
        event.sender.send('narrative-audio-progress', { stage: 'script', message: 'Crafting your executive script...' });
        
        // Step 1: Use OpenAI to generate an executive script from the narrative
        const toneDescriptions = {
            'inspiring': 'inspiring, visionary, and forward-looking. Paint a picture of possibility and potential.',
            'confident': 'confident, authoritative, and decisive. Speak with certainty and conviction.',
            'empathetic': 'empathetic, understanding, and human-centered.',
            'urgent': 'urgent, action-oriented, and compelling.'
        };
        
        const scriptPrompt = `You are an expert narrator converting written business documents into spoken narration. Your task is to take this narrative and rewrite it so it flows naturally when read aloud.

The tone should be ${toneDescriptions[tone] || toneDescriptions['inspiring']}

CRITICAL: Your output MUST be under 9,000 characters (approximately 1,500 words or 8-10 minutes of audio).

Guidelines:
- Preserve the key content and insights from the narrative
- If the narrative is long, focus on the most important points and summarize less critical details
- Rewrite sentences to flow naturally when spoken aloud
- Break up long complex sentences into shorter, clearer ones
- Remove bullet points and convert them into flowing prose
- Remove markdown formatting (headers, bold, etc.) - write as plain flowing text
- Add natural transitions between sections
- Avoid awkward written constructs that don't work when spoken
- Numbers and statistics should be written out in a way that's easy to speak

Here is the narrative to convert to spoken narration:

${narrativeContent}

---

Rewrite the above as natural spoken narration. Keep it under 9,000 characters. Output ONLY the narration text, no headers or explanations.`;

        const model = openaiCredentials.model || 'gpt-4o';
        console.log('[NarrativeAudio] Using OpenAI model:', model);
        
        // Use the existing callOpenAI helper function - limit to ~2500 tokens for ~9000 chars
        const generatedScript = await callOpenAI(openaiCredentials.apiKey, model, [
            { role: 'user', content: scriptPrompt }
        ], 2500);
        
        if (!generatedScript) {
            return { success: false, error: 'Failed to generate script from narrative.' };
        }
        
        console.log('[NarrativeAudio] Script generated, length:', generatedScript.length);
        
        // Send progress update
        event.sender.send('narrative-audio-progress', { stage: 'audio', message: 'Converting script to speech...' });
        
        // Step 2: Convert script to audio using ElevenLabs
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId || 'pNInz6obpgDQGcFmaJgB'}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsCredentials.apiKey
            },
            body: JSON.stringify({
                text: generatedScript,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.6,
                    similarity_boost: 0.8,
                    style: 0.3,
                    use_speaker_boost: true
                }
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[NarrativeAudio] ElevenLabs API error:', response.status, errorData);
            return {
                success: false,
                error: errorData.detail?.message || `ElevenLabs API error: ${response.status}`
            };
        }
        
        // Get the audio data as a buffer
        const audioBuffer = await response.arrayBuffer();
        const audioBase64 = Buffer.from(audioBuffer).toString('base64');
        
        console.log('[NarrativeAudio] Audio generated, size:', audioBuffer.byteLength, 'bytes');
        
        return {
            success: true,
            script: generatedScript,
            audioBase64: audioBase64,
            size: audioBuffer.byteLength
        };
    } catch (error) {
        console.error('[NarrativeAudio] Generation error:', error);
        return {
            success: false,
            error: error.message || 'Failed to generate narrative audio'
        };
    }
});

// ============================================
// Video Narrative Generation (Script to Video Montage)
// ============================================

let videoNarrativeAborted = false;

// Cancel video narrative generation
ipcMain.handle('videoNarrative:cancel', async () => {
    videoNarrativeAborted = true;
    return { success: true };
});

// Generate video narrative from script
ipcMain.handle('videoNarrative:generate', async (event, options) => {
    try {
        videoNarrativeAborted = false;
        
        const openaiCredentials = credentialManager.getCredentials('openai');
        const runwayCredentials = credentialManager.getCredentials('runway');
        
        if (!openaiCredentials?.apiKey) {
            return { success: false, error: 'OpenAI API key not configured. Please add it in Admin settings.' };
        }
        
        if (!runwayCredentials?.apiKey) {
            return { success: false, error: 'Runway ML API key not configured. Please add it in Admin settings.' };
        }
        
        const { script, aspectRatio, visualStyle, clientName } = options;
        
        if (!script || script.trim().length === 0) {
            return { success: false, error: 'No script provided.' };
        }
        
        console.log('[VideoNarrative] Starting generation...');
        console.log('[VideoNarrative] Script length:', script.length);
        console.log('[VideoNarrative] Aspect ratio:', aspectRatio);
        console.log('[VideoNarrative] Visual style:', visualStyle);
        
        // Step 1: Split script into segments (~7 seconds each, ~20 words)
        const segments = splitScriptIntoSegments(script, 20);
        console.log('[VideoNarrative] Split into', segments.length, 'segments');
        
        // Initialize segment tracking
        const segmentStatus = segments.map((text, i) => ({
            index: i,
            text: text,
            status: 'pending',
            prompt: null,
            videoPath: null,
            error: null
        }));
        
        // Send initial progress
        event.sender.send('video-narrative-progress', {
            stage: 'Splitting script...',
            percent: 5,
            segments: segmentStatus
        });
        
        // Create temp directory for videos
        const tempDir = path.join(app.getPath('temp'), 'narrative-videos-' + Date.now());
        const fs = require('fs').promises;
        await fs.mkdir(tempDir, { recursive: true });
        console.log('[VideoNarrative] Temp directory:', tempDir);
        
        const videoPaths = [];
        
        // Step 2: For each segment, generate prompt and video
        for (let i = 0; i < segments.length; i++) {
            if (videoNarrativeAborted) {
                return { success: false, error: 'Generation cancelled' };
            }
            
            const segmentText = segments[i];
            segmentStatus[i].status = 'generating-prompt';
            
            const percentPerSegment = 90 / segments.length;
            const basePercent = 5 + (i * percentPerSegment);
            
            event.sender.send('video-narrative-progress', {
                stage: `Segment ${i + 1}/${segments.length}: Creating cinematic prompt...`,
                percent: basePercent,
                segments: segmentStatus
            });
            
            // Generate cinematic prompt from segment text
            const cinematicPrompt = await generateCinematicPrompt(
                openaiCredentials.apiKey,
                segmentText,
                visualStyle,
                clientName
            );
            
            if (!cinematicPrompt) {
                segmentStatus[i].status = 'error';
                segmentStatus[i].error = 'Failed to generate prompt';
                console.error('[VideoNarrative] Failed to generate prompt for segment', i);
                continue;
            }
            
            segmentStatus[i].prompt = cinematicPrompt;
            segmentStatus[i].status = 'generating-video';
            
            event.sender.send('video-narrative-progress', {
                stage: `Segment ${i + 1}/${segments.length}: Generating video...`,
                percent: basePercent + (percentPerSegment * 0.3),
                segments: segmentStatus
            });
            
            // Generate video using Runway ML
            try {
                const videoPath = await generateRunwayVideo(
                    runwayCredentials.apiKey,
                    cinematicPrompt,
                    aspectRatio,
                    tempDir,
                    i
                );
                
                if (videoPath) {
                    segmentStatus[i].status = 'complete';
                    segmentStatus[i].videoPath = videoPath;
                    videoPaths.push(videoPath);
                    console.log('[VideoNarrative] Video generated for segment', i, ':', videoPath);
                } else {
                    segmentStatus[i].status = 'error';
                    segmentStatus[i].error = 'Video generation failed';
                }
            } catch (videoError) {
                console.error('[VideoNarrative] Video generation error for segment', i, ':', videoError);
                segmentStatus[i].status = 'error';
                segmentStatus[i].error = videoError.message;
            }
            
            event.sender.send('video-narrative-progress', {
                stage: `Segment ${i + 1}/${segments.length}: ${segmentStatus[i].status === 'complete' ? 'Complete!' : 'Error'}`,
                percent: basePercent + percentPerSegment,
                segments: segmentStatus
            });
        }
        
        if (videoPaths.length === 0) {
            return { success: false, error: 'No videos were generated successfully' };
        }
        
        // Step 3: Combine videos (for now, just use the first one if we can't stitch)
        // TODO: Add ffmpeg stitching when available
        event.sender.send('video-narrative-progress', {
            stage: 'Finalizing video...',
            percent: 95,
            segments: segmentStatus
        });
        
        let finalVideoPath;
        
        if (videoPaths.length === 1) {
            finalVideoPath = videoPaths[0];
        } else {
            // Try to concatenate videos
            try {
                finalVideoPath = await concatenateVideos(videoPaths, tempDir);
            } catch (concatError) {
                console.warn('[VideoNarrative] Could not concatenate videos:', concatError.message);
                console.log('[VideoNarrative] Using first video as fallback');
                finalVideoPath = videoPaths[0];
            }
        }
        
        event.sender.send('video-narrative-progress', {
            stage: 'Complete!',
            percent: 100,
            segments: segmentStatus
        });
        
        console.log('[VideoNarrative] Final video path:', finalVideoPath);
        
        return {
            success: true,
            videoPath: finalVideoPath,
            segmentCount: segments.length,
            successfulSegments: videoPaths.length
        };
        
    } catch (error) {
        console.error('[VideoNarrative] Generation error:', error);
        return {
            success: false,
            error: error.message || 'Failed to generate video narrative'
        };
    }
});

// Helper: Split script into segments by word count
function splitScriptIntoSegments(script, wordsPerSegment) {
    const words = script.trim().split(/\s+/);
    const segments = [];
    
    for (let i = 0; i < words.length; i += wordsPerSegment) {
        const segmentWords = words.slice(i, i + wordsPerSegment);
        segments.push(segmentWords.join(' '));
    }
    
    return segments;
}

// Helper: Generate cinematic prompt from segment text
async function generateCinematicPrompt(apiKey, segmentText, visualStyle, clientName) {
    try {
        const styleDescriptions = {
            'cinematic': 'cinematic, dramatic lighting, shallow depth of field, professional film look, smooth camera movement',
            'documentary': 'documentary style, natural lighting, authentic feel, observational camera work',
            'corporate': 'clean corporate aesthetic, modern office environments, professional atmosphere, sleek design',
            'abstract': 'abstract visuals, creative motion graphics, symbolic imagery, artistic interpretation',
            'nature': 'stunning natural landscapes, aerial shots, golden hour lighting, majestic scenery'
        };
        
        const styleDesc = styleDescriptions[visualStyle] || styleDescriptions['cinematic'];
        
        const prompt = `You are a video production expert converting narration into cinematic scene descriptions for AI video generation.

Given this narration segment: "${segmentText}"

And this visual style: ${styleDesc}

Generate a concise but vivid video scene description (50-100 words) that visually represents the essence of this narration. The description should:
- Describe what we SEE on screen (not what we hear)
- Include camera movement suggestions (slow pan, tracking shot, etc.)
- Describe lighting, mood, and atmosphere
- Be specific about subjects, settings, and actions
- Be suitable for a 7-second video clip
- NOT include any text or dialogue in the scene
- Focus on visual storytelling that complements spoken narration

Context: This is for ${clientName || 'a business'} narrative video.

Output ONLY the scene description, no explanations or headers.`;

        const response = await callOpenAI(apiKey, 'gpt-4o', [
            { role: 'user', content: prompt }
        ], 200);
        
        return response?.trim() || null;
    } catch (error) {
        console.error('[VideoNarrative] Prompt generation error:', error);
        return null;
    }
}

// Helper: Generate video using Runway ML
async function generateRunwayVideo(apiKey, prompt, aspectRatio, tempDir, segmentIndex) {
    try {
        const RunwayML = require('@runwayml/sdk').default;
        const fs = require('fs');
        const https = require('https');
        
        const client = new RunwayML({ apiKey });
        
        console.log('[VideoNarrative] Generating video for segment', segmentIndex);
        console.log('[VideoNarrative] Prompt:', prompt.substring(0, 100) + '...');
        
        // Create a text-to-video task using veo3 model
        const task = await client.textToVideo.create({
            model: 'veo3',
            promptText: prompt,
            duration: 8, // veo3 requires exactly 8 seconds
            ratio: aspectRatio === '1080:1920' ? '720:1280' : aspectRatio === '1080:1080' ? '1280:1280' : '1280:720'
        });
        
        console.log('[VideoNarrative] Task created:', task.id);
        
        // Poll for completion
        let result;
        const maxAttempts = 60; // 5 minutes max
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            
            result = await client.tasks.retrieve(task.id);
            console.log('[VideoNarrative] Task status:', result.status);
            
            if (result.status === 'SUCCEEDED') {
                break;
            } else if (result.status === 'FAILED') {
                throw new Error('Video generation failed: ' + (result.failure || 'Unknown error'));
            }
            
            attempts++;
        }
        
        if (!result || result.status !== 'SUCCEEDED') {
            throw new Error('Video generation timed out');
        }
        
        // Download the video
        const videoUrl = result.output?.[0];
        if (!videoUrl) {
            throw new Error('No video URL in response');
        }
        
        const videoPath = path.join(tempDir, `segment_${segmentIndex}.mp4`);
        
        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(videoPath);
            https.get(videoUrl, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(videoPath, () => {});
                reject(err);
            });
        });
        
        console.log('[VideoNarrative] Video downloaded:', videoPath);
        return videoPath;
        
    } catch (error) {
        console.error('[VideoNarrative] Runway video error:', error);
        throw error;
    }
}

// Helper: Concatenate videos (requires ffmpeg)
async function concatenateVideos(videoPaths, tempDir) {
    // For now, we'll create a simple file list and try to use ffmpeg if available
    // In production, you'd bundle ffmpeg or use a Node.js native solution
    const fs = require('fs').promises;
    const { execSync } = require('child_process');
    
    // Create a file list for ffmpeg
    const listPath = path.join(tempDir, 'videos.txt');
    const listContent = videoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await fs.writeFile(listPath, listContent);
    
    const outputPath = path.join(tempDir, 'final_narrative.mp4');
    
    try {
        // Try to use ffmpeg
        execSync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`, {
            stdio: 'pipe'
        });
        
        return outputPath;
    } catch (ffmpegError) {
        console.warn('[VideoNarrative] ffmpeg not available or failed:', ffmpegError.message);
        throw new Error('ffmpeg not available for video concatenation');
    }
}

// ============================================
// Template Placeholders
// ============================================

// Get all placeholders
ipcMain.handle('placeholders:getAll', async () => {
    console.log(`[Placeholders] getAll called, count: ${appState.placeholders?.length || 0}`);
    return appState.placeholders || [];
});

// Add placeholder
ipcMain.handle('placeholders:add', async (event, placeholder) => {
    console.log(`[Placeholders] Adding placeholder: ${placeholder.name}`);
    console.log(`[Placeholders] Current count before add: ${appState.placeholders?.length || 0}`);
    
    // Ensure array exists
    if (!appState.placeholders) {
        appState.placeholders = [];
    }
    
    const newPlaceholder = {
        id: 'ph_' + Date.now(),
        name: placeholder.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        prompt: placeholder.prompt,
        isList: placeholder.isList || false,
        listCount: placeholder.listCount || null,
        hasTitleBody: placeholder.hasTitleBody || false,
        maxChars: placeholder.maxChars || null,
        maxCharsTitle: placeholder.maxCharsTitle || null,
        maxCharsBody: placeholder.maxCharsBody || null,
        createdAt: new Date().toISOString()
    };
    
    appState.placeholders.push(newPlaceholder);
    console.log(`[Placeholders] Count after add: ${appState.placeholders.length}`);
    
    const saved = credentialManager.saveAppData('placeholders', appState.placeholders);
    console.log(`[Placeholders] Saved to disk: ${saved}`);
    
    auditLogger.log('ADMIN', 'PLACEHOLDER_ADDED', { 
        id: newPlaceholder.id, 
        name: newPlaceholder.name,
        isList: newPlaceholder.isList,
        listCount: newPlaceholder.listCount,
        hasTitleBody: newPlaceholder.hasTitleBody
    });
    
    return { success: true, placeholder: newPlaceholder };
});

// Update placeholder
ipcMain.handle('placeholders:update', async (event, { id, placeholder }) => {
    const index = appState.placeholders.findIndex(p => p.id === id);
    if (index === -1) {
        return { success: false, error: 'Placeholder not found' };
    }
    
    appState.placeholders[index] = {
        ...appState.placeholders[index],
        name: placeholder.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        prompt: placeholder.prompt,
        isList: placeholder.isList || false,
        listCount: placeholder.listCount || null,
        hasTitleBody: placeholder.hasTitleBody || false,
        maxChars: placeholder.maxChars || null,
        maxCharsTitle: placeholder.maxCharsTitle || null,
        maxCharsBody: placeholder.maxCharsBody || null,
        updatedAt: new Date().toISOString()
    };
    
    credentialManager.saveAppData('placeholders', appState.placeholders);
    
    auditLogger.log('ADMIN', 'PLACEHOLDER_UPDATED', { 
        id, 
        name: placeholder.name,
        isList: placeholder.isList
    });
    
    return { success: true, placeholder: appState.placeholders[index] };
});

// Delete placeholder
ipcMain.handle('placeholders:delete', async (event, id) => {
    const index = appState.placeholders.findIndex(p => p.id === id);
    if (index === -1) {
        return { success: false, error: 'Placeholder not found' };
    }
    
    const deleted = appState.placeholders.splice(index, 1)[0];
    credentialManager.saveAppData('placeholders', appState.placeholders);
    
    auditLogger.log('ADMIN', 'PLACEHOLDER_DELETED', { 
        id, 
        name: deleted.name 
    });
    
    return { success: true };
});

// Export placeholders to Excel
ipcMain.handle('placeholders:export', async () => {
    const XLSX = require('xlsx');
    
    if (!appState.placeholders || appState.placeholders.length === 0) {
        return { success: false, error: 'No placeholders to export' };
    }
    
    // Convert placeholders to Excel-friendly format
    const data = appState.placeholders.map(p => ({
        'placeholder': p.name,
        'prompt': p.prompt,
        'list': p.isList ? 'TRUE' : 'FALSE',
        'list_items': p.isList ? (p.listCount || 5) : '',
        'title_body_placeholder': p.hasTitleBody ? 'TRUE' : 'FALSE',
        'max_characters_per_box': p.maxChars || '',
        'max_chars_title': p.maxCharsTitle || '',
        'max_chars_body': p.maxCharsBody || ''
    }));
    
    // Create workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Placeholders');
    
    // Set column widths
    ws['!cols'] = [
        { wch: 25 },  // placeholder
        { wch: 60 },  // prompt
        { wch: 10 },  // list
        { wch: 12 },  // list_items
        { wch: 20 },  // title_body_placeholder
        { wch: 20 },  // max_characters_per_box
        { wch: 15 },  // max_chars_title
        { wch: 15 }   // max_chars_body
    ];
    
    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `Placeholders_Export_${new Date().toISOString().slice(0,10)}.xlsx`,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });
    
    if (result.canceled) {
        return { success: false, canceled: true };
    }
    
    try {
        XLSX.writeFile(wb, result.filePath);
        
        auditLogger.log('ADMIN', 'PLACEHOLDERS_EXPORTED', {
            count: appState.placeholders.length,
            filePath: result.filePath
        });
        
        return { success: true, filePath: result.filePath, count: appState.placeholders.length };
    } catch (error) {
        console.error('Failed to export placeholders:', error);
        return { success: false, error: error.message };
    }
});

// Import placeholders from Excel
ipcMain.handle('placeholders:import', async () => {
    const XLSX = require('xlsx');
    
    // Show open dialog
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Placeholders from Excel',
        filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }
    
    try {
        const filePath = result.filePaths[0];
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);
        
        if (!rows || rows.length === 0) {
            return { success: false, error: 'Excel file is empty or has no data rows' };
        }
        
        // Validate and convert rows to placeholders
        const imported = [];
        const errors = [];
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // Excel is 1-indexed and has header row
            
            // Get column values (handle different case variations)
            const name = row['placeholder'] || row['Placeholder'] || row['PLACEHOLDER'];
            const prompt = row['prompt'] || row['Prompt'] || row['PROMPT'];
            const listVal = row['list'] || row['List'] || row['LIST'];
            const listItemsVal = row['list_items'] || row['List_Items'] || row['LIST_ITEMS'] || row['list items'] || row['List Items'];
            const titleBodyVal = row['title_body_placeholder'] || row['Title_Body_Placeholder'] || row['TITLE_BODY_PLACEHOLDER'] || row['title/body placeholder'] || row['Title/Body Placeholder'];
            const maxCharsVal = row['max_characters_per_box'] || row['Max_Characters_Per_Box'] || row['MAX_CHARACTERS_PER_BOX'] || row['max characters per box'] || row['Max Characters Per Box'];
            const maxCharsTitleVal = row['max_chars_title'] || row['Max_Chars_Title'] || row['MAX_CHARS_TITLE'] || row['max chars title'] || row['Max Chars Title'];
            const maxCharsBodyVal = row['max_chars_body'] || row['Max_Chars_Body'] || row['MAX_CHARS_BODY'] || row['max chars body'] || row['Max Chars Body'];
            
            // Validate required fields
            if (!name) {
                errors.push(`Row ${rowNum}: Missing placeholder name`);
                continue;
            }
            if (!prompt) {
                errors.push(`Row ${rowNum}: Missing prompt for "${name}"`);
                continue;
            }
            
            // Parse boolean values
            const isList = listVal === true || listVal === 'TRUE' || listVal === 'true' || listVal === '1' || listVal === 1;
            const hasTitleBody = titleBodyVal === true || titleBodyVal === 'TRUE' || titleBodyVal === 'true' || titleBodyVal === '1' || titleBodyVal === 1;
            
            // Parse list items count
            let listCount = 5; // Default
            if (listItemsVal !== undefined && listItemsVal !== '' && listItemsVal !== null) {
                const parsed = parseInt(listItemsVal);
                if (!isNaN(parsed) && parsed > 0) {
                    listCount = parsed;
                }
            }
            
            // Parse max chars
            let maxChars = null;
            if (maxCharsVal !== undefined && maxCharsVal !== '' && maxCharsVal !== null) {
                const parsed = parseInt(maxCharsVal);
                if (!isNaN(parsed) && parsed > 0) {
                    maxChars = parsed;
                }
            }
            
            // Parse max chars title
            let maxCharsTitle = null;
            if (maxCharsTitleVal !== undefined && maxCharsTitleVal !== '' && maxCharsTitleVal !== null) {
                const parsed = parseInt(maxCharsTitleVal);
                if (!isNaN(parsed) && parsed > 0) {
                    maxCharsTitle = parsed;
                }
            }
            
            // Parse max chars body
            let maxCharsBody = null;
            if (maxCharsBodyVal !== undefined && maxCharsBodyVal !== '' && maxCharsBodyVal !== null) {
                const parsed = parseInt(maxCharsBodyVal);
                if (!isNaN(parsed) && parsed > 0) {
                    maxCharsBody = parsed;
                }
            }
            
            // Create placeholder object
            const placeholder = {
                id: 'ph_' + Date.now() + '_' + i,
                name: String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                prompt: String(prompt),
                isList: isList,
                listCount: isList ? listCount : null,
                hasTitleBody: hasTitleBody,
                maxChars: maxChars,
                maxCharsTitle: maxCharsTitle,
                maxCharsBody: maxCharsBody,
                createdAt: new Date().toISOString()
            };
            
            imported.push(placeholder);
        }
        
        if (imported.length === 0) {
            return { success: false, error: 'No valid placeholders found in file. Errors: ' + errors.join('; ') };
        }
        
        // Replace existing placeholders with imported ones
        appState.placeholders = imported;
        credentialManager.saveAppData('placeholders', appState.placeholders);
        
        auditLogger.log('ADMIN', 'PLACEHOLDERS_IMPORTED', {
            count: imported.length,
            errors: errors.length,
            filePath: filePath
        });
        
        return { 
            success: true, 
            count: imported.length, 
            errors: errors.length > 0 ? errors : null 
        };
    } catch (error) {
        console.error('Failed to import placeholders:', error);
        return { success: false, error: error.message };
    }
});

// Helper: Process template with placeholders
async function processTemplateWithPlaceholders(templateBuffer, client, fileType) {
    try {
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Starting ${fileType.toUpperCase()} template processing...`,
            type: 'info'
        });
        
        const zip = new PizZip(templateBuffer);
        
        // Built-in placeholders
        const builtInData = {
            client_name: client?.name || 'Client',
            industry: client?.industry || 'Industry',
            geography: client?.geography || 'Geography',
            sector: client?.sector || 'Sector',
            date: new Date().toLocaleDateString(),
            year: new Date().getFullYear().toString()
        };
        
        // For PPTX/DOCX, we need to find placeholders in XML and handle split tags
        // First, let's gather all XML content and find placeholders
        const xmlFiles = Object.keys(zip.files).filter(name => name.endsWith('.xml'));
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Scanning ${xmlFiles.length} XML files in template...`,
            type: 'info'
        });
        
        // First pass: Find all placeholders in the template (including list placeholders)
        const foundPlaceholders = new Set();
        const foundListPlaceholders = new Map(); // name -> Set of indices
        
        for (const xmlFile of xmlFiles) {
            const content = zip.files[xmlFile].asText();
            // Match {{placeholder}} patterns (may be split by XML tags)
            const cleanContent = content.replace(/<[^>]*>/g, ''); // Strip XML tags
            
            // Match regular placeholders {{name}}
            const regularMatches = cleanContent.matchAll(/\{\{([a-z_]+)\}\}/gi);
            for (const match of regularMatches) {
                foundPlaceholders.add(match[1].toLowerCase());
            }
            
            // Match list placeholders {{name[n]}}
            const listMatches = cleanContent.matchAll(/\{\{([a-z_]+)\[(\d+)\]\}\}/gi);
            for (const match of listMatches) {
                const name = match[1].toLowerCase();
                const index = parseInt(match[2]);
                if (!foundListPlaceholders.has(name)) {
                    foundListPlaceholders.set(name, new Set());
                }
                foundListPlaceholders.get(name).add(index);
            }
        }
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Found placeholders in template: ${[...foundPlaceholders].join(', ') || 'None'}`,
            type: 'info'
        });
        
        if (foundListPlaceholders.size > 0) {
            const listInfo = [...foundListPlaceholders.entries()]
                .map(([name, indices]) => `{{${name}[1-${Math.max(...indices)}]}}`)
                .join(', ');
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Found list placeholders in template: ${listInfo}`,
                type: 'info'
            });
        }
        
        // Collect all defined placeholders (from admin panel)
        const definedPlaceholders = appState.placeholders || [];
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Admin-defined placeholders: ${definedPlaceholders.map(p => p.name).join(', ') || 'None'}`,
            type: 'info'
        });
        
        // Get source pack content for AI
        const sourcePack = appState.pendingSourcePack || appState.lastSourcePack;
        let sourcePackContent = '';
        if (sourcePack?.documents) {
            for (const [filename, content] of Object.entries(sourcePack.documents)) {
                if (typeof content === 'string' && content.length > 0) {
                    sourcePackContent += `\n\n=== ${filename} ===\n${content.substring(0, 5000)}`;
                }
            }
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Source pack has ${Object.keys(sourcePack.documents).length} documents for AI context`,
                type: 'info'
            });
        } else {
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Warning: No source pack content available for AI generation`,
                type: 'warning'
            });
        }
        
        // Prepare data object with built-ins
        const data = { ...builtInData };
        
        // Store for list placeholder items (each item can be string or {title, body} object)
        const listPlaceholderData = {};
        
        // Store for title/body placeholder data (non-list)
        const titleBodyPlaceholderData = {};
        
        // Track generation state for dependency resolution
        const generationState = {
            completed: new Set(Object.keys(builtInData)), // Built-ins are already "generated"
            inProgress: new Set(), // For circular dependency detection
        };
        
        // Helper: Find placeholder references in a prompt
        const findPlaceholderReferences = (prompt) => {
            const matches = prompt.matchAll(/\{\{([a-z_]+)\}\}/gi);
            const refs = [];
            for (const match of matches) {
                const refName = match[1].toLowerCase();
                // Don't count self-references or built-ins
                if (!builtInData.hasOwnProperty(refName)) {
                    refs.push(refName);
                }
            }
            return [...new Set(refs)]; // Dedupe
        };
        
        // Helper: Replace placeholder references in a prompt with generated content
        const resolvePromptReferences = (prompt) => {
            return prompt.replace(/\{\{([a-z_]+)\}\}/gi, (match, name) => {
                const refName = name.toLowerCase();
                
                // Check all data sources for the referenced content
                if (data[refName]) {
                    return data[refName];
                }
                if (listPlaceholderData[refName]) {
                    const items = listPlaceholderData[refName];
                    if (items[0] && typeof items[0] === 'object') {
                        // Title/body list - format as readable text
                        return items.map((item, i) => `${i + 1}. ${item.title}: ${item.body}`).join('\n');
                    } else {
                        // Simple list
                        return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
                    }
                }
                if (titleBodyPlaceholderData[refName]) {
                    const tb = titleBodyPlaceholderData[refName];
                    return `${tb.title}: ${tb.body}`;
                }
                if (builtInData[refName]) {
                    return builtInData[refName];
                }
                
                // Not found - leave as is
                return match;
            });
        };
        
        // Helper: Get placeholder config by name
        const getPlaceholderConfig = (name) => {
            return definedPlaceholders.find(p => p.name === name);
        };
        
        // Recursive function to generate a placeholder with dependency resolution
        const generatePlaceholderWithDeps = async (placeholderName, depth = 0) => {
            const indent = '  '.repeat(depth);
            
            // Skip if already generated
            if (generationState.completed.has(placeholderName)) {
                console.log(`${indent}[Deps] ${placeholderName} already generated, skipping`);
                return;
            }
            
            // Circular dependency check
            if (generationState.inProgress.has(placeholderName)) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `⚠ Circular dependency detected for {{${placeholderName}}} - skipping`,
                    type: 'warning'
                });
                console.log(`${indent}[Deps] Circular dependency for ${placeholderName}!`);
                return;
            }
            
            const placeholder = getPlaceholderConfig(placeholderName);
            if (!placeholder) {
                console.log(`${indent}[Deps] ${placeholderName} not found in defined placeholders`);
                return;
            }
            
            // Mark as in-progress
            generationState.inProgress.add(placeholderName);
            
            // Find dependencies in the prompt
            const dependencies = findPlaceholderReferences(placeholder.prompt);
            
            if (dependencies.length > 0) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `{{${placeholderName}}} depends on: ${dependencies.map(d => `{{${d}}}`).join(', ')}`,
                    type: 'info'
                });
                console.log(`${indent}[Deps] ${placeholderName} depends on: ${dependencies.join(', ')}`);
                
                // Generate dependencies first
                for (const dep of dependencies) {
                    if (!generationState.completed.has(dep)) {
                        console.log(`${indent}[Deps] Generating dependency ${dep} first...`);
                        await generatePlaceholderWithDeps(dep, depth + 1);
                    }
                }
            }
            
            // Now generate this placeholder with resolved prompt
            const resolvedPrompt = resolvePromptReferences(placeholder.prompt);
            
            // Build character limit instruction if specified (for regular placeholders)
            const charLimitInstruction = placeholder.maxChars 
                ? `\n\nCRITICAL LENGTH CONSTRAINT: Your response MUST be ${placeholder.maxChars} characters or fewer (including spaces). This is a strict limit - be concise and impactful. Do not exceed ${placeholder.maxChars} characters.`
                : '';
            
            // For list items, the char limit applies per item
            const charLimitPerItemInstruction = placeholder.maxChars
                ? `\nIMPORTANT: Each item MUST be ${placeholder.maxChars} characters or fewer (including spaces). Be concise.`
                : '';
            
            // Build title/body character limit instructions
            const titleCharLimit = placeholder.maxCharsTitle || null;
            const bodyCharLimit = placeholder.maxCharsBody || null;
            let titleBodyCharInstruction = '';
            if (titleCharLimit || bodyCharLimit) {
                const titlePart = titleCharLimit ? `TITLE must be ${titleCharLimit} characters or fewer` : '';
                const bodyPart = bodyCharLimit ? `BODY must be ${bodyCharLimit} characters or fewer` : '';
                const combined = [titlePart, bodyPart].filter(Boolean).join('. ');
                titleBodyCharInstruction = `\nCRITICAL LENGTH CONSTRAINT: ${combined} (including spaces). Be concise and impactful.`;
            }
            
            console.log(`${indent}[Deps] Generating ${placeholderName} with resolved prompt`);
            
            // Case 1: List + Title/Body placeholder
            if (placeholder.isList && placeholder.hasTitleBody) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Generating list with title/body for {{${placeholderName}}} (${placeholder.listCount} items)...`,
                    type: 'info'
                });
                
                try {
                    const listTitleBodyPrompt = `${resolvedPrompt}

IMPORTANT: You MUST respond with EXACTLY ${placeholder.listCount} items.
Each item MUST have both a TITLE and a BODY.${titleBodyCharInstruction}

Format your response EXACTLY like this (including the markers):
[ITEM 1]
TITLE: Short descriptive title here
BODY: Longer body content here that explains the point in detail.

[ITEM 2]
TITLE: Another short title
BODY: Another body paragraph with more details.

...continue for all ${placeholder.listCount} items.

Do NOT include any preamble, explanation, or conclusion - ONLY the formatted items.`;
                    
                    const aiContent = await generatePlaceholderContent(
                        listTitleBodyPrompt,
                        client,
                        sourcePackContent
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const items = parseListTitleBodyContent(aiContent, placeholder.listCount);
                        listPlaceholderData[placeholderName] = items;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Generated ${items.length} title/body items for {{${placeholderName}}}`,
                            type: 'success'
                        });
                        
                        items.forEach((item, idx) => {
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `  [${idx + 1}] Title: "${item.title.substring(0, 40)}..."`,
                                type: 'info'
                            });
                        });
                    } else {
                        listPlaceholderData[placeholderName] = Array(placeholder.listCount).fill({
                            title: `[Error]`,
                            body: `[Error generating ${placeholderName}]`
                        });
                    }
                } catch (aiError) {
                    console.error(`[Workshop] Error generating list title/body for ${placeholderName}:`, aiError);
                    listPlaceholderData[placeholderName] = Array(placeholder.listCount).fill({
                        title: `[Error]`,
                        body: `[Error: ${aiError.message}]`
                    });
                }
            }
            // Case 2: List only placeholder
            else if (placeholder.isList) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Generating list content for {{${placeholderName}}} (${placeholder.listCount} items)...`,
                    type: 'info'
                });
                
                try {
                    const listPrompt = `${resolvedPrompt}

IMPORTANT: You MUST respond with EXACTLY ${placeholder.listCount} items.${charLimitPerItemInstruction}
Format your response as a numbered list:
1. First item
2. Second item
...etc.

Each item should be a complete, self-contained statement that can stand alone.
Do NOT include any preamble, explanation, or conclusion - ONLY the numbered list.`;
                    
                    const aiContent = await generatePlaceholderContent(
                        listPrompt,
                        client,
                        sourcePackContent
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const items = parseListContent(aiContent, placeholder.listCount);
                        listPlaceholderData[placeholderName] = items;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Generated ${items.length} list items for {{${placeholderName}}}`,
                            type: 'success'
                        });
                        
                        items.forEach((item, idx) => {
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `  [${idx + 1}] ${item.substring(0, 60)}${item.length > 60 ? '...' : ''}`,
                                type: 'info'
                            });
                        });
                    } else {
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `⚠ AI error for list {{${placeholderName}}}: ${aiContent}`,
                            type: 'error'
                        });
                        listPlaceholderData[placeholderName] = Array(placeholder.listCount).fill(`[Error generating ${placeholderName}]`);
                    }
                } catch (aiError) {
                    console.error(`[Workshop] Error generating list content for ${placeholderName}:`, aiError);
                    listPlaceholderData[placeholderName] = Array(placeholder.listCount).fill(`[Error: ${aiError.message}]`);
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `Error generating list {{${placeholderName}}}: ${aiError.message}`,
                        type: 'error'
                    });
                }
            }
            // Case 3: Title/Body only (non-list)
            else if (placeholder.hasTitleBody) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Generating title/body content for {{${placeholderName}}}...`,
                    type: 'info'
                });
                
                try {
                    const titleBodyPrompt = `${resolvedPrompt}

You MUST respond with both a TITLE and a BODY.${titleBodyCharInstruction}

Format your response EXACTLY like this:
TITLE: Short descriptive title here (keep it concise, under 10 words)
BODY: Longer body content here that explains the point in detail.

Do NOT include any preamble or explanation - ONLY the TITLE and BODY lines.`;
                    
                    const aiContent = await generatePlaceholderContent(
                        titleBodyPrompt,
                        client,
                        sourcePackContent
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const parsed = parseTitleBodyContent(aiContent);
                        titleBodyPlaceholderData[placeholderName] = parsed;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Generated title/body for {{${placeholderName}}}`,
                            type: 'success'
                        });
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `  Title: "${parsed.title.substring(0, 50)}..."`,
                            type: 'info'
                        });
                    } else {
                        titleBodyPlaceholderData[placeholderName] = {
                            title: `[Error]`,
                            body: `[Error generating ${placeholderName}]`
                        };
                    }
                } catch (aiError) {
                    console.error(`[Workshop] Error generating title/body for ${placeholderName}:`, aiError);
                    titleBodyPlaceholderData[placeholderName] = {
                        title: `[Error]`,
                        body: `[Error: ${aiError.message}]`
                    };
                }
            }
            // Case 4: Regular placeholder
            else {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Generating AI content for {{${placeholderName}}}...`,
                    type: 'info'
                });
                
                try {
                    // Add character limit to prompt if specified
                    const promptWithLimit = charLimitInstruction 
                        ? `${resolvedPrompt}${charLimitInstruction}`
                        : resolvedPrompt;
                    
                    const aiContent = await generatePlaceholderContent(
                        promptWithLimit,
                        client,
                        sourcePackContent
                    );
                    
                    if (aiContent && aiContent.startsWith('[Error:')) {
                        data[placeholderName] = aiContent;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `⚠ AI error for {{${placeholderName}}}: ${aiContent}`,
                            type: 'error'
                        });
                    } else {
                        data[placeholderName] = aiContent || `[No content generated for ${placeholderName}]`;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Generated ${aiContent?.length || 0} chars for {{${placeholderName}}}`,
                            type: 'success'
                        });
                    }
                } catch (aiError) {
                    console.error(`[Workshop] Error generating content for ${placeholderName}:`, aiError);
                    data[placeholderName] = `[Error generating ${placeholderName}]`;
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `Error generating {{${placeholderName}}}: ${aiError.message}`,
                        type: 'error'
                    });
                }
            }
            
            // Mark as completed
            generationState.inProgress.delete(placeholderName);
            generationState.completed.add(placeholderName);
        };
        
        // Generate all placeholders with dependency resolution
        for (const placeholder of definedPlaceholders) {
            const placeholderName = placeholder.name;
            
            // Skip if it's a built-in or already generated
            if (builtInData.hasOwnProperty(placeholderName)) {
                continue;
            }
            
            if (!generationState.completed.has(placeholderName)) {
                await generatePlaceholderWithDeps(placeholderName);
            }
        }
        
        // Handle any placeholders found in template but not defined
        for (const foundName of foundPlaceholders) {
            if (!data.hasOwnProperty(foundName)) {
                data[foundName] = `[Placeholder "${foundName}" not defined]`;
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Warning: {{${foundName}}} found in template but not defined in admin panel`,
                    type: 'warning'
                });
            }
        }
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Data prepared with ${Object.keys(data).length} placeholders: ${Object.keys(data).join(', ')}`,
            type: 'info'
        });
        
        // Helper function to ensure text wrapping is enabled in PPTX text boxes
        // This modifies <a:bodyPr> elements to enable word wrap
        const ensureTextWrapping = (xmlContent, fileType) => {
            if (fileType !== 'pptx') return xmlContent;
            
            let result = xmlContent;
            
            // Find all <a:bodyPr .../> or <a:bodyPr ...>...</a:bodyPr> elements
            // Ensure they have wrap="square" for proper word wrapping
            
            // Pattern 1: Self-closing <a:bodyPr ... />
            result = result.replace(/<a:bodyPr([^>]*?)\/>/g, (match, attrs) => {
                // Check if wrap attribute already exists
                if (/wrap\s*=/.test(attrs)) {
                    // Replace existing wrap value with "square"
                    attrs = attrs.replace(/wrap\s*=\s*["'][^"']*["']/g, 'wrap="square"');
                } else {
                    // Add wrap="square" attribute
                    attrs = attrs + ' wrap="square"';
                }
                return `<a:bodyPr${attrs}/>`;
            });
            
            // Pattern 2: Opening tag <a:bodyPr ...>
            result = result.replace(/<a:bodyPr([^>]*?)>/g, (match, attrs) => {
                // Skip if this is a self-closing tag (already handled above)
                if (attrs.endsWith('/')) return match;
                
                // Check if wrap attribute already exists
                if (/wrap\s*=/.test(attrs)) {
                    // Replace existing wrap value with "square"
                    attrs = attrs.replace(/wrap\s*=\s*["'][^"']*["']/g, 'wrap="square"');
                } else {
                    // Add wrap="square" attribute
                    attrs = attrs + ' wrap="square"';
                }
                return `<a:bodyPr${attrs}>`;
            });
            
            return result;
        };
        
        // Helper function to escape XML and convert line breaks for Office formats
        const escapeForOfficeXml = (text, fileType) => {
            let safeValue = String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
            
            // For PPTX, convert line breaks to soft breaks that work within text runs
            // Using &#xA; (line feed) which PowerPoint will render as a line break
            if (fileType === 'pptx') {
                safeValue = safeValue.replace(/\r\n/g, '&#xA;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xA;');
            }
            
            // For DOCX, we can use similar approach
            if (fileType === 'docx') {
                // In DOCX, we should ideally use <w:br/> but that requires more complex XML manipulation
                // For now, use the same approach
                safeValue = safeValue.replace(/\r\n/g, '&#xA;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xA;');
            }
            
            return safeValue;
        };
        
        // Helper function to merge split placeholder tags
        // In PPTX/DOCX, {{placeholder}} can be split across multiple XML runs
        // Even the {{ and }} braces themselves might be split!
        const mergeSplitPlaceholders = (xmlContent, knownPlaceholderNames) => {
            let result = xmlContent;
            
            // For each known placeholder name, try to find and fix it even if split
            for (const name of knownPlaceholderNames) {
                // Build a flexible regex that allows XML tags between any characters
                // Pattern: { potentially split } { potentially split } name potentially split } }
                const chars = `{{${name}}}`.split('');
                let flexPattern = '';
                for (let i = 0; i < chars.length; i++) {
                    // Escape special regex characters (braces and brackets)
                    const escapedChar = chars[i].replace(/[{}[\]]/g, '\\$&');
                    flexPattern += escapedChar;
                    // Allow XML tags between characters (but not after the last char)
                    if (i < chars.length - 1) {
                        flexPattern += '(?:<[^>]*>)*';
                    }
                }
                
                const regex = new RegExp(flexPattern, 'gi');
                const cleanPlaceholder = `{{${name}}}`;
                
                if (regex.test(result)) {
                    result = result.replace(new RegExp(flexPattern, 'gi'), cleanPlaceholder);
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `Fixed split placeholder: {{${name}}}`,
                        type: 'info'
                    });
                }
            }
            
            // Also try the generic approach for any remaining placeholders
            const placeholderPattern = /\{\{([^}]*(?:<[^>]*>[^}]*)*)\}\}/g;
            result = result.replace(placeholderPattern, (match) => {
                const cleanedPlaceholder = match.replace(/<[^>]*>/g, '');
                return cleanedPlaceholder;
            });
            
            return result;
        };
        
        // Collect all placeholder names we need to look for
        // Include base names AND indexed versions for list placeholders
        const allPlaceholderNames = [
            ...Object.keys(builtInData),
            ...definedPlaceholders.map(p => p.name)
        ];
        
        // For list placeholders, also add indexed versions like name[1], name[2], name [1], name [2], etc.
        for (const [listName, items] of Object.entries(listPlaceholderData)) {
            // If items have title/body structure, add non-indexed patterns for sequential replacement
            if (items[0] && typeof items[0] === 'object') {
                allPlaceholderNames.push(`${listName}[title]`);
                allPlaceholderNames.push(`${listName}[body]`);
                allPlaceholderNames.push(`${listName} [title]`);
                allPlaceholderNames.push(`${listName} [body]`);
            }
            
            for (let i = 1; i <= items.length; i++) {
                allPlaceholderNames.push(`${listName}[${i}]`);      // No space: name[1]
                allPlaceholderNames.push(`${listName} [${i}]`);     // With space: name [1]
                
                // If items have title/body structure, add indexed patterns too
                if (items[0] && typeof items[0] === 'object') {
                    allPlaceholderNames.push(`${listName}[${i}][title]`);
                    allPlaceholderNames.push(`${listName}[${i}][body]`);
                    allPlaceholderNames.push(`${listName} [${i}][title]`);
                    allPlaceholderNames.push(`${listName} [${i}][body]`);
                }
            }
        }
        
        // For title/body only placeholders
        for (const tbName of Object.keys(titleBodyPlaceholderData)) {
            allPlaceholderNames.push(`${tbName}[title]`);
            allPlaceholderNames.push(`${tbName}[body]`);
            allPlaceholderNames.push(`${tbName} [title]`);
            allPlaceholderNames.push(`${tbName} [body]`);
        }
        
        // Now process template - do direct string replacement in XML files
        // This handles cases where docxtemplater might struggle with split tags
        for (const xmlFile of xmlFiles) {
            let content = zip.files[xmlFile].asText();
            let modified = false;
            
            // First, ensure text wrapping is enabled for PPTX files
            const contentBeforeWrap = content;
            content = ensureTextWrapping(content, fileType);
            if (content !== contentBeforeWrap) {
                modified = true;
            }
            
            // Next, merge any split placeholders
            const originalContent = content;
            content = mergeSplitPlaceholders(content, allPlaceholderNames);
            
            // Check if content was changed by merge (indicates split placeholders were found)
            if (content !== originalContent) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `Merged split placeholder tags in ${xmlFile}`,
                    type: 'info'
                });
                modified = true;
            }
            
            // Debug: Check if any list placeholders exist in this file after merge
            for (const [listName, items] of Object.entries(listPlaceholderData)) {
                // First, check if the placeholder name appears at all (even if not properly formatted)
                if (content.includes(listName)) {
                    // Extract context around the placeholder name
                    const idx = content.indexOf(listName);
                    const contextStart = Math.max(0, idx - 50);
                    const contextEnd = Math.min(content.length, idx + listName.length + 50);
                    const context = content.substring(contextStart, contextEnd)
                        .replace(/</g, '&lt;')
                        .substring(0, 100);
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `DEBUG: "${listName}" appears in XML. Context: ${context}`,
                        type: 'info'
                    });
                }
                
                // Check for base placeholder {{name}}
                const basePlaceholder = `{{${listName}}}`;
                if (content.includes(basePlaceholder)) {
                    const count = (content.match(new RegExp(basePlaceholder.replace(/[{}]/g, '\\$&'), 'g')) || []).length;
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `Found ${count}x {{${listName}}} in ${path.basename(xmlFile)}`,
                        type: 'info'
                    });
                }
                
                // Check for indexed placeholders {{name[1]}}, {{name[2]}}, etc.
                for (let i = 1; i <= items.length; i++) {
                    const indexedPlaceholder = `{{${listName}[${i}]}}`;
                    if (content.includes(indexedPlaceholder)) {
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `Found {{${listName}[${i}]}} in ${path.basename(xmlFile)}`,
                            type: 'info'
                        });
                    }
                }
            }
            
            // First, replace list placeholder items
            for (const [listName, items] of Object.entries(listPlaceholderData)) {
                // Check if items have title/body structure
                const hasTitleBody = items.length > 0 && typeof items[0] === 'object' && items[0].title !== undefined;
                
                // Method 1: Replace explicitly indexed placeholders
                for (let i = 0; i < items.length; i++) {
                    if (hasTitleBody) {
                        // Title/body structure: handle {{name[N][title]}} and {{name[N][body]}}
                        const item = items[i];
                        const safeTitleValue = escapeForOfficeXml(item.title, fileType);
                        const safeBodyValue = escapeForOfficeXml(item.body, fileType);
                        
                        // Title patterns
                        const titlePatterns = [
                            `{{${listName}[${i + 1}][title]}}`,
                            `{{${listName} [${i + 1}][title]}}`,
                            `{{${listName}[${i + 1}] [title]}}`,
                            `{{${listName} [${i + 1}] [title]}}`
                        ];
                        
                        for (const pattern of titlePatterns) {
                            if (content.includes(pattern)) {
                                content = content.split(pattern).join(safeTitleValue);
                                modified = true;
                                mainWindow.webContents.send('ai-console-log', {
                                    agent: 'workshop',
                                    message: `✓ Replaced ${pattern} in ${path.basename(xmlFile)}`,
                                    type: 'success'
                                });
                            }
                        }
                        
                        // Body patterns
                        const bodyPatterns = [
                            `{{${listName}[${i + 1}][body]}}`,
                            `{{${listName} [${i + 1}][body]}}`,
                            `{{${listName}[${i + 1}] [body]}}`,
                            `{{${listName} [${i + 1}] [body]}}`
                        ];
                        
                        for (const pattern of bodyPatterns) {
                            if (content.includes(pattern)) {
                                content = content.split(pattern).join(safeBodyValue);
                                modified = true;
                                mainWindow.webContents.send('ai-console-log', {
                                    agent: 'workshop',
                                    message: `✓ Replaced ${pattern} in ${path.basename(xmlFile)}`,
                                    type: 'success'
                                });
                            }
                        }
                        
                        // Also support {{name[N]}} which will get both title and body combined
                        const indexedNoSpace = `{{${listName}[${i + 1}]}}`;
                        const indexedWithSpace = `{{${listName} [${i + 1}]}}`;
                        const combinedValue = escapeForOfficeXml(`${item.title}\n${item.body}`, fileType);
                        
                        if (content.includes(indexedNoSpace)) {
                            content = content.split(indexedNoSpace).join(combinedValue);
                            modified = true;
                        }
                        if (content.includes(indexedWithSpace)) {
                            content = content.split(indexedWithSpace).join(combinedValue);
                            modified = true;
                        }
                    } else {
                        // Simple string items (original behavior)
                        const safeValue = escapeForOfficeXml(items[i], fileType);
                        
                        const indexedNoSpace = `{{${listName}[${i + 1}]}}`;
                        const indexedWithSpace = `{{${listName} [${i + 1}]}}`;
                        
                        if (content.includes(indexedNoSpace)) {
                            content = content.split(indexedNoSpace).join(safeValue);
                            modified = true;
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `✓ Replaced {{${listName}[${i + 1}]}} in ${path.basename(xmlFile)}`,
                                type: 'success'
                            });
                        }
                        
                        if (content.includes(indexedWithSpace)) {
                            content = content.split(indexedWithSpace).join(safeValue);
                            modified = true;
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `✓ Replaced {{${listName} [${i + 1}]}} in ${path.basename(xmlFile)}`,
                                type: 'success'
                            });
                        }
                    }
                }
                
                // Method 2: Replace non-indexed {{name}} placeholders in order of appearance
                const basePlaceholder = `{{${listName}}}`;
                let itemIndex = 0;
                while (content.includes(basePlaceholder) && itemIndex < items.length) {
                    let safeValue;
                    let previewText;
                    
                    if (hasTitleBody) {
                        const item = items[itemIndex];
                        safeValue = escapeForOfficeXml(`${item.title}\n${item.body}`, fileType);
                        previewText = item.title.substring(0, 30);
                    } else {
                        safeValue = escapeForOfficeXml(items[itemIndex], fileType);
                        previewText = items[itemIndex].substring(0, 30);
                    }
                    
                    content = content.replace(basePlaceholder, safeValue);
                    modified = true;
                    
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `✓ Replaced {{${listName}}} #${itemIndex + 1} with "${previewText}..." in ${path.basename(xmlFile)}`,
                        type: 'success'
                    });
                    
                    itemIndex++;
                }
                
                // If there are more {{name}} placeholders than items, fill with placeholder text
                while (content.includes(basePlaceholder)) {
                    content = content.replace(basePlaceholder, `[No more items for ${listName}]`);
                    modified = true;
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `⚠ Extra {{${listName}}} placeholder - no more items available`,
                        type: 'warning'
                    });
                }
                
                // Method 3: For list+title/body, replace {{name[title]}} and {{name[body]}} sequentially
                if (hasTitleBody) {
                    // Sequential title replacement
                    const titlePlaceholderPatterns = [
                        `{{${listName}[title]}}`,
                        `{{${listName} [title]}}`
                    ];
                    
                    let titleIndex = 0;
                    for (const titlePattern of titlePlaceholderPatterns) {
                        while (content.includes(titlePattern) && titleIndex < items.length) {
                            const item = items[titleIndex];
                            const safeTitleValue = escapeForOfficeXml(item.title, fileType);
                            
                            content = content.replace(titlePattern, safeTitleValue);
                            modified = true;
                            
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `✓ Replaced {{${listName}[title]}} #${titleIndex + 1} with "${item.title.substring(0, 30)}..." in ${path.basename(xmlFile)}`,
                                type: 'success'
                            });
                            
                            titleIndex++;
                        }
                    }
                    
                    // Fill remaining title placeholders
                    for (const titlePattern of titlePlaceholderPatterns) {
                        while (content.includes(titlePattern)) {
                            content = content.replace(titlePattern, `[No more titles for ${listName}]`);
                            modified = true;
                        }
                    }
                    
                    // Sequential body replacement
                    const bodyPlaceholderPatterns = [
                        `{{${listName}[body]}}`,
                        `{{${listName} [body]}}`
                    ];
                    
                    let bodyIndex = 0;
                    for (const bodyPattern of bodyPlaceholderPatterns) {
                        while (content.includes(bodyPattern) && bodyIndex < items.length) {
                            const item = items[bodyIndex];
                            const safeBodyValue = escapeForOfficeXml(item.body, fileType);
                            
                            content = content.replace(bodyPattern, safeBodyValue);
                            modified = true;
                            
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `✓ Replaced {{${listName}[body]}} #${bodyIndex + 1} in ${path.basename(xmlFile)}`,
                                type: 'success'
                            });
                            
                            bodyIndex++;
                        }
                    }
                    
                    // Fill remaining body placeholders
                    for (const bodyPattern of bodyPlaceholderPatterns) {
                        while (content.includes(bodyPattern)) {
                            content = content.replace(bodyPattern, `[No more bodies for ${listName}]`);
                            modified = true;
                        }
                    }
                }
            }
            
            // Replace title/body only placeholders (non-list)
            for (const [tbName, tbData] of Object.entries(titleBodyPlaceholderData)) {
                const safeTitleValue = escapeForOfficeXml(tbData.title, fileType);
                const safeBodyValue = escapeForOfficeXml(tbData.body, fileType);
                
                // Title patterns
                const titlePatterns = [
                    `{{${tbName}[title]}}`,
                    `{{${tbName} [title]}}`
                ];
                
                for (const pattern of titlePatterns) {
                    if (content.includes(pattern)) {
                        content = content.split(pattern).join(safeTitleValue);
                        modified = true;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Replaced ${pattern} in ${path.basename(xmlFile)}`,
                            type: 'success'
                        });
                    }
                }
                
                // Body patterns
                const bodyPatterns = [
                    `{{${tbName}[body]}}`,
                    `{{${tbName} [body]}}`
                ];
                
                for (const pattern of bodyPatterns) {
                    if (content.includes(pattern)) {
                        content = content.split(pattern).join(safeBodyValue);
                        modified = true;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `✓ Replaced ${pattern} in ${path.basename(xmlFile)}`,
                            type: 'success'
                        });
                    }
                }
                
                // Also support {{name}} which will get both title and body combined
                const basePlaceholder = `{{${tbName}}}`;
                if (content.includes(basePlaceholder)) {
                    const combinedValue = escapeForOfficeXml(`${tbData.title}\n${tbData.body}`, fileType);
                    content = content.split(basePlaceholder).join(combinedValue);
                    modified = true;
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `✓ Replaced {{${tbName}}} (combined title/body) in ${path.basename(xmlFile)}`,
                        type: 'success'
                    });
                }
            }
            
            // Replace each regular placeholder in the data
            for (const [key, value] of Object.entries(data)) {
                const placeholder = `{{${key}}}`;
                if (content.includes(placeholder)) {
                    // Escape XML and handle line breaks for proper text wrapping
                    const safeValue = escapeForOfficeXml(value, fileType);
                    
                    content = content.split(placeholder).join(safeValue);
                    modified = true;
                    
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `✓ Replaced {{${key}}} in ${path.basename(xmlFile)}`,
                        type: 'success'
                    });
                }
            }
            
            if (modified) {
                zip.file(xmlFile, content);
            }
        }
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Template processing complete!`,
            type: 'success'
        });
        
        return zip.generate({ type: 'nodebuffer' });
    } catch (error) {
        console.error('[Workshop] Template processing error:', error);
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Template processing error: ${error.message}`,
            type: 'error'
        });
        
        // Return original buffer if processing fails
        return templateBuffer;
    }
}

// Helper: Parse AI-generated list content into individual items
function parseListContent(content, expectedCount) {
    if (!content) return Array(expectedCount).fill('[No content]');
    
    // Try to parse numbered list (1. item, 2. item, etc.)
    const numberedPattern = /^\s*(?:\d+[.)]\s*|\*\s*|-\s*)/gm;
    
    // Split by numbered list pattern or newlines
    let items = content
        .split(/\n(?=\s*(?:\d+[.)]\s*|\*\s*|-\s*))/g)
        .map(item => item.replace(numberedPattern, '').trim())
        .filter(item => item.length > 0);
    
    // If we couldn't parse a list, try splitting by double newlines
    if (items.length < 2) {
        items = content.split(/\n\n+/).map(item => item.trim()).filter(item => item.length > 0);
    }
    
    // If still not enough items, split by single newlines
    if (items.length < expectedCount) {
        items = content.split(/\n/).map(item => item.replace(numberedPattern, '').trim()).filter(item => item.length > 0);
    }
    
    // Pad or trim to expected count
    while (items.length < expectedCount) {
        items.push(`[Item ${items.length + 1} not generated]`);
    }
    
    return items.slice(0, expectedCount);
}

// Helper: Parse title/body content from AI response
function parseTitleBodyContent(content) {
    if (!content) return { title: '[No title]', body: '[No content]' };
    
    // Try to find TITLE: and BODY: markers
    const titleMatch = content.match(/TITLE:\s*(.+?)(?=\nBODY:|$)/is);
    const bodyMatch = content.match(/BODY:\s*([\s\S]+?)$/i);
    
    if (titleMatch && bodyMatch) {
        return {
            title: titleMatch[1].trim(),
            body: bodyMatch[1].trim()
        };
    }
    
    // Fallback: first line is title, rest is body
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
        return {
            title: lines[0].replace(/^(TITLE:|Title:)\s*/i, '').trim(),
            body: lines.slice(1).join('\n').replace(/^(BODY:|Body:)\s*/i, '').trim()
        };
    }
    
    // Last resort: use entire content as body
    return {
        title: '[Title not found]',
        body: content.trim()
    };
}

// Helper: Parse list of title/body items from AI response
function parseListTitleBodyContent(content, expectedCount) {
    if (!content) {
        return Array(expectedCount).fill({ title: '[No title]', body: '[No content]' });
    }
    
    const items = [];
    
    // Try to split by [ITEM N] markers
    const itemBlocks = content.split(/\[ITEM\s*\d+\]/i).filter(block => block.trim());
    
    for (const block of itemBlocks) {
        const titleMatch = block.match(/TITLE:\s*(.+?)(?=\nBODY:|$)/is);
        const bodyMatch = block.match(/BODY:\s*([\s\S]+?)(?=\[ITEM|\s*$)/i);
        
        if (titleMatch || bodyMatch) {
            items.push({
                title: titleMatch ? titleMatch[1].trim() : '[No title]',
                body: bodyMatch ? bodyMatch[1].trim() : '[No body]'
            });
        }
    }
    
    // If we couldn't parse with [ITEM] markers, try splitting by TITLE: markers
    if (items.length === 0) {
        const titleBlocks = content.split(/(?=TITLE:)/i).filter(block => block.trim());
        
        for (const block of titleBlocks) {
            const titleMatch = block.match(/TITLE:\s*(.+?)(?=\nBODY:|$)/is);
            const bodyMatch = block.match(/BODY:\s*([\s\S]+?)(?=TITLE:|$)/i);
            
            if (titleMatch) {
                items.push({
                    title: titleMatch[1].trim(),
                    body: bodyMatch ? bodyMatch[1].trim() : '[No body]'
                });
            }
        }
    }
    
    // Pad or trim to expected count
    while (items.length < expectedCount) {
        items.push({ title: `[Item ${items.length + 1} not generated]`, body: '[No content]' });
    }
    
    return items.slice(0, expectedCount);
}

// Helper: Generate placeholder content with AI
async function generatePlaceholderContent(prompt, client, sourcePackContent) {
    console.log('[Workshop] generatePlaceholderContent called with prompt:', prompt);
    
    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds?.apiKey) {
        console.log('[Workshop] No OpenAI API key configured');
        return '[Error: OpenAI API key not configured]';
    }
    
    console.log('[Workshop] Using model:', openaiCreds.model || 'gpt-5.2');
    console.log('[Workshop] Source pack content length:', sourcePackContent?.length || 0);
    
    try {
        const systemPrompt = `You are an expert business analyst helping prepare workshop materials. 
Generate content based on the user's prompt, using information from the provided source pack.
Be concise and professional. Format for presentation/document use.
Client: ${client?.name || 'Unknown'}
Industry: ${client?.industry || 'Unknown'}
Geography: ${client?.geography || 'Unknown'}`;

        // Limit source pack content to avoid token limits
        const truncatedSourcePack = sourcePackContent ? sourcePackContent.substring(0, 30000) : '';

        const userPrompt = `${prompt}

SOURCE PACK CONTENT:
${truncatedSourcePack || 'No source pack content available.'}

Generate the content now. Be direct and concise - this will be inserted into a template.`;

        console.log('[Workshop] Making OpenAI API call...');
        
        // Build request body - use max_completion_tokens for newer models, max_tokens for older
        const modelName = openaiCreds.model || 'gpt-5.2';
        const isNewerModel = modelName.includes('gpt-5') || modelName.includes('o1') || modelName.includes('o3');
        
        const requestBody = {
            model: modelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
        };
        
        // Add appropriate token limit parameter
        if (isNewerModel) {
            requestBody.max_completion_tokens = 1000;
        } else {
            requestBody.max_tokens = 1000;
        }
        
        const response = await axios.post('https://api.openai.com/v1/chat/completions', requestBody, {
            headers: {
                'Authorization': `Bearer ${openaiCreds.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        const result = response.data.choices?.[0]?.message?.content?.trim() || '';
        console.log('[Workshop] AI generated content length:', result.length);
        return result;
    } catch (error) {
        console.error('[Workshop] AI generation error:', error.message);
        if (error.response) {
            console.error('[Workshop] API response status:', error.response.status);
            console.error('[Workshop] API response data:', JSON.stringify(error.response.data));
        }
        // Return error with more detail
        const errorDetail = error.response?.data?.error?.message || error.message;
        return `[Error: ${errorDetail}]`;
    }
}

// ====================================
// MULTI-AGENT NARRATIVE GENERATION
// ====================================

/**
 * Agent 1: ANALYST - Extracts key insights from ALL source documents
 */
async function runAnalystAgent(documents, client, openaiCreds, emitLog) {
    emitLog('analyst', '🔍 Analyst Agent: Beginning comprehensive source analysis...', 'thinking');
    
    // Build full document content (no categorization - analyst sees everything)
    let allContent = '';
    const docList = [];
    const skippedDocs = [];
    
    for (const [filename, content] of Object.entries(documents)) {
        // Skip obvious placeholders
        if (typeof content === 'string' && (content.includes('[PLACEHOLDER]') || content.includes('API key not configured'))) {
            skippedDocs.push(filename);
            continue;
        }
        
        let contentStr = '';
        if (typeof content === 'string') {
            contentStr = content;
        } else if (Buffer.isBuffer(content)) {
            contentStr = content.toString('utf8');
        } else if (content && typeof content === 'object') {
            contentStr = JSON.stringify(content);
        } else {
            contentStr = String(content || '');
        }
        
        // Skip empty content
        if (!contentStr || contentStr.trim().length < 50) {
            skippedDocs.push(filename + ' (empty)');
            continue;
        }
        
        // Allow more content per document for richer analysis
        const truncated = contentStr.length > 15000 
            ? contentStr.substring(0, 15000) + '\n[...truncated]'
            : contentStr;
        
        allContent += `\n\n=== DOCUMENT: ${filename} ===\n${truncated}\n`;
        docList.push(filename);
    }
    
    emitLog('analyst', `Analyzing ${docList.length} documents (skipped ${skippedDocs.length} placeholders)...`, 'thinking');
    
    // Log which documents we're analyzing
    if (docList.length > 0) {
        emitLog('analyst', `Documents: ${docList.join(', ')}`, 'info');
    }
    
    // Check if we have any content
    if (allContent.trim().length < 100) {
        emitLog('analyst', '⚠️ Warning: Very little content found in source pack!', 'warning');
        return `No substantive content found in source pack. Documents checked: ${Object.keys(documents).join(', ')}. All were either placeholders or empty.`;
    }
    
    console.log(`[Analyst] Total content length: ${allContent.length} chars from ${docList.length} documents`);
    
    const analysisPrompt = `You are a senior research analyst. Your job is to thoroughly analyze all provided source documents and extract every piece of valuable information.

CLIENT: ${client?.name || 'Unknown'}
INDUSTRY: ${client?.industry || 'Unknown'}

═══════════════════════════════════════════════════════════════════════════════
CRITICAL FIRST STEP: STAKEHOLDER ANALYSIS
═══════════════════════════════════════════════════════════════════════════════

FIRST, look for any Point of Contact (POC) information in the documents.
Search for files containing "poc", "point_of_contact", "stakeholder", or from folder "3.0".
If found, extract:
• Stakeholder names, titles, and roles
• Seniority levels and decision-making authority  
• Known priorities, interests, and communication preferences
• Any stated concerns or strategic focus areas

This audience analysis is CRITICAL for tailoring the narrative.

═══════════════════════════════════════════════════════════════════════════════
SOURCE DOCUMENTS
═══════════════════════════════════════════════════════════════════════════════
${allContent}
═══════════════════════════════════════════════════════════════════════════════

Perform a comprehensive extraction across ALL documents. For EACH category below, extract ALL relevant information found ANYWHERE in the documents:

## 1. STAKEHOLDER PROFILE (from POC/contact files if present)
- Who are the target audience members?
- What are their roles, priorities, and preferences?

## 2. KEY FACTS & STATISTICS
- Numbers, percentages, financial figures, market sizes
- Growth rates, benchmarks, quantitative data points
- Include the source document for each

## 3. CLIENT-SPECIFIC INSIGHTS
- Information about ${client?.name || 'the client'}'s situation
- Challenges, opportunities, competitive position
- Strategic priorities mentioned

## 4. INDUSTRY & MARKET DYNAMICS
- Trends, disruptions, competitive landscape
- Regulatory factors, technology shifts

## 5. PROBLEMS & PAIN POINTS
- Challenges, risks, inefficiencies
- Capability gaps, threats, barriers

## 6. OPPORTUNITIES & VALUE DRIVERS
- Growth opportunities, efficiency gains
- Transformation potential, competitive advantages

## 7. SOLUTIONS & CAPABILITIES
- Specific solutions, technologies, methodologies
- Assets or capabilities that could address challenges

## 8. POWERFUL QUOTES & STATEMENTS
- Impactful phrases, executive statements
- Quotable insights with source attribution

## 9. CROSS-CUTTING THEMES
- Themes appearing across multiple documents
- These are often the most important strategic threads

Be exhaustive. Extract EVERYTHING of value. Note which document each insight came from.`;

    const model = openaiCreds.model || 'gpt-5.2';
    
    console.log(`[Analyst] Calling OpenAI with model: ${model}, prompt length: ${analysisPrompt.length}`);
    emitLog('analyst', `Calling ${model} with ${Math.round(analysisPrompt.length / 1000)}k chars...`, 'thinking');
    
    try {
        const analysis = await callOpenAI(openaiCreds.apiKey, model, [
            { role: 'system', content: 'You are a meticulous research analyst who extracts every valuable insight from documents. You never miss important details and always cite your sources.' },
            { role: 'user', content: analysisPrompt }
        ], 6000);
        
        console.log(`[Analyst] OpenAI returned: ${analysis?.length || 0} chars`);
        
        if (!analysis || analysis.length < 100) {
            emitLog('analyst', `⚠️ Warning: Analysis returned minimal content (${analysis?.length || 0} chars)`, 'warning');
        } else {
            emitLog('analyst', `✓ Analysis complete - ${analysis.length} chars of insights extracted`, 'success');
        }
        
        return analysis || 'Analysis returned empty - documents may not have contained extractable content.';
    } catch (err) {
        console.error('[Analyst] OpenAI call failed:', err);
        emitLog('analyst', `❌ Error calling OpenAI: ${err.message}`, 'error');
        return `Analysis failed: ${err.message}. The source documents were: ${docList.join(', ')}`;
    }
}

/**
 * Agent 2: STRATEGIST - Maps insights to narrative structure  
 */
async function runStrategistAgent(analysisOutput, agentPrompt, client, openaiCreds, emitLog) {
    emitLog('strategist', '📊 Strategist Agent: Mapping insights to narrative architecture...', 'thinking');
    
    const strategyPrompt = `You are a senior strategy consultant. You have received a comprehensive analysis of source materials. Your job is to organize these insights into a strategic narrative structure.

CLIENT: ${client?.name || 'Unknown'}
INDUSTRY: ${client?.industry || 'Unknown'}

=== ANALYST'S EXTRACTED INSIGHTS ===
${analysisOutput}
=== END OF INSIGHTS ===

=== NARRATIVE STRUCTURE REQUESTED ===
${agentPrompt}
=== END OF STRUCTURE ===

Your task is to CREATE A STRATEGIC BRIEF that maps the extracted insights to the narrative structure. For each section of the requested narrative:

1. Identify the STRONGEST insights that should be used
2. Note specific facts, figures, and quotes to include
3. Identify any CROSS-DOCUMENT connections (where insights from different sources reinforce each other)
4. Flag any gaps where we have weak evidence
5. Suggest the NARRATIVE ANGLE - what's the most compelling story to tell?

Structure your output as:

## NARRATIVE ARCHITECTURE

### Opening Belief / Identity
- Key insights to use: [list]
- Recommended angle: [description]
- Supporting evidence: [specific facts/quotes with sources]

### Purpose  
- Key insights to use: [list]
- Recommended angle: [description]
- Supporting evidence: [specific facts/quotes with sources]

### Goals
- Suggested goals based on evidence: [list with supporting data]

### Signature Capabilities
- Capabilities/solutions found in sources: [list with descriptions]
- How each ties to client needs: [connections]

### End-to-End Flow
- Journey elements found: [stages, phases, milestones]
- Recommended flow structure: [outline]

### Expected Impact
- Quantifiable impacts found: [list all numbers/metrics]
- Strategic outcomes supported by evidence: [list]
- Relationship/ecosystem outcomes: [list]

## CROSS-DOCUMENT SYNTHESIS
Identify the 3-5 most powerful themes that emerge across multiple documents - these should be the backbone of the narrative.

## NARRATIVE RECOMMENDATIONS
Provide 3-4 specific recommendations for how to make this narrative maximally compelling, based on what the evidence supports.`;

    const model = openaiCreds.model || 'gpt-5.2';
    
    console.log(`[Strategist] Calling OpenAI with model: ${model}, analysis input: ${analysisOutput?.length || 0} chars`);
    emitLog('strategist', `Calling ${model}...`, 'thinking');
    
    try {
        const strategy = await callOpenAI(openaiCreds.apiKey, model, [
            { role: 'system', content: 'You are a master strategist who sees patterns across complex information and knows how to craft compelling executive narratives. You always ground recommendations in evidence.' },
            { role: 'user', content: strategyPrompt }
        ], 5000);
        
        console.log(`[Strategist] OpenAI returned: ${strategy?.length || 0} chars`);
        
        if (!strategy || strategy.length < 100) {
            emitLog('strategist', `⚠️ Warning: Strategy returned minimal content (${strategy?.length || 0} chars)`, 'warning');
        } else {
            emitLog('strategist', `✓ Strategic mapping complete - ${strategy.length} chars`, 'success');
        }
        
        return strategy || 'Strategy mapping returned empty.';
    } catch (err) {
        console.error('[Strategist] OpenAI call failed:', err);
        emitLog('strategist', `❌ Error calling OpenAI: ${err.message}`, 'error');
        return `Strategy mapping failed: ${err.message}`;
    }
}

/**
 * Agent 3: NARRATOR - Writes the final executive narrative
 */
async function runNarratorAgent(analysisOutput, strategyOutput, agentPrompt, client, context, openaiCreds, emitLog) {
    emitLog('narrator', '✍️ Narrator Agent: Crafting executive narrative...', 'thinking');
    
    // Handle missing or null inputs
    const safeAnalysis = analysisOutput || 'No analysis available - the source pack may not have contained substantive content.';
    const safeStrategy = strategyOutput || 'No strategic mapping available.';
    
    // Log what we received
    console.log(`[Narrator] Analysis length: ${safeAnalysis?.length || 0}, Strategy length: ${safeStrategy?.length || 0}`);
    
    // Get learned preferences from user's iteration history
    const learnedPreferences = buildLearnedInstructions(appState.learnings, client, client?.industry);
    if (learnedPreferences) {
        console.log('[Narrator] Applying learned preferences to narrative generation');
    }
    
    const narrativePrompt = `You are a world-class executive narrative writer, crafting strategy documents for C-suite leaders.

CLIENT: ${client?.name || 'Unknown'}
INDUSTRY: ${client?.industry || 'Unknown'}
CONTEXT: ${context?.outputIntent || 'Executive Narrative'}

=== YOUR WRITING BRIEF ===
${agentPrompt}
=== END OF BRIEF ===

=== ANALYST'S SOURCE INSIGHTS ===
${safeAnalysis}
=== END OF INSIGHTS ===

=== STRATEGIST'S NARRATIVE ARCHITECTURE ===
${safeStrategy}
=== END OF ARCHITECTURE ===
${learnedPreferences ? `
=== LEARNED USER PREFERENCES ===
The following preferences have been learned from the user's previous iterations and edits. Apply these to make the narrative better match their expectations:

${learnedPreferences}
=== END OF LEARNED PREFERENCES ===
` : ''}
NOW WRITE THE NARRATIVE.

IMPORTANT: You MUST write a complete narrative using whatever information is available. If some source insights are limited, work with what you have and make reasonable inferences for a ${client?.industry || 'Unknown'} sector client. Do NOT refuse to write or ask for more information.

STRUCTURE TO FOLLOW:
1. Opening Belief / Identity - A powerful statement about the client's current moment
2. Purpose - Why this approach exists
3. Goals - 3-5 clear strategic, commercial, and experiential goals
4. Signature Capabilities - 4-6 named components with descriptions
5. End-to-End Flow - How the approach moves from ambition to execution
6. Expected Impact - Strategic, commercial, and relationship outcomes

WRITING GUIDELINES:
- Use the ANALYST'S INSIGHTS as your factual foundation where available
- Follow the STRATEGIST'S ARCHITECTURE for structure and angles
- Write in an executive, confident, declarative tone
- Replace {{client_name}} with "${client?.name || 'the client'}"
- Make it feel like a polished strategy document from a top-tier consulting firm

Write the complete narrative now:`;

    const model = openaiCreds.model || 'gpt-5.2';
    const narrative = await callOpenAI(openaiCreds.apiKey, model, [
        { role: 'system', content: 'You are an elite executive writer who crafts narratives that win C-suite trust and commitment. Your writing is confident, grounded, and commercially compelling. You ALWAYS produce a complete narrative - never refuse or ask for more information. Work with what you have.' },
        { role: 'user', content: narrativePrompt }
    ], 8000);
    
    emitLog('narrator', '✓ Executive narrative complete', 'success');
    return narrative;
}

// ============================================
// Narrative Builder - Step 5 Guided Prompt Creation
// ============================================

ipcMain.handle('sourceChat:sendMessage', async (event, { message }) => {
    console.log('[NarrativeBuilder] Received message:', message.substring(0, 50) + '...');
    
    try {
        // Get OpenAI credentials
        const openaiCreds = await credentialManager.getCredentials('openai');
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
        }
        
        // Get the current source pack content
        if (!appState.pendingSourcePack || !appState.pendingSourcePack.documents) {
            return { success: false, error: 'No source pack loaded' };
        }
        
        // Build context from source pack documents
        let sourceContext = '';
        const documents = appState.pendingSourcePack.documents;
        
        console.log('[NarrativeBuilder] Documents in source pack:', Object.keys(documents).length);
        
        // Calculate available tokens for context (rough estimate: ~4 chars per token)
        const maxContextChars = 200000; // ~50k tokens for documents
        let totalChars = 0;
        
        // Sort documents - prioritize main source documents over index files
        const sortedDocs = Object.entries(documents).sort((a, b) => {
            const aIsMain = /^[0-9]+\.[0-9]+_/.test(a[0]) && !a[0].includes('_INDEX');
            const bIsMain = /^[0-9]+\.[0-9]+_/.test(b[0]) && !b[0].includes('_INDEX');
            if (aIsMain && !bIsMain) return -1;
            if (!aIsMain && bIsMain) return 1;
            return a[0].localeCompare(b[0]);
        });
        
        // Build a brief summary of available sources for the AI
        let sourceSummary = 'Available source documents:\n';
        for (const [fileName, content] of sortedDocs) {
            if (content && typeof content === 'string') {
                const sampleStart = content.substring(0, 500);
                const isBinary = /[\x00-\x08\x0E-\x1F]/.test(sampleStart) || 
                                 sampleStart.includes('PK\x03\x04') ||
                                 sampleStart.includes('%PDF');
                
                if (isBinary) {
                    console.log(`[NarrativeBuilder] Skipping binary file: ${fileName}`);
                    continue;
                }
                
                const remainingChars = maxContextChars - totalChars;
                if (remainingChars <= 0) {
                    console.log(`[NarrativeBuilder] Context limit reached, skipping: ${fileName}`);
                    continue;
                }
                
                const docCount = sortedDocs.length;
                const perDocLimit = Math.max(10000, Math.floor(maxContextChars / docCount));
                const charLimit = Math.min(remainingChars, perDocLimit);
                
                const truncatedContent = content.length > charLimit 
                    ? content.substring(0, charLimit) + '\n\n... [truncated]'
                    : content;
                    
                sourceContext += `\n\n=== ${fileName} ===\n${truncatedContent}`;
                totalChars += truncatedContent.length;
                
                // Add to summary
                sourceSummary += `- ${fileName} (${content.length} chars)\n`;
                
                console.log(`[NarrativeBuilder] Added document: ${fileName} (${content.length} chars, used ${truncatedContent.length})`);
            }
        }
        
        console.log(`[NarrativeBuilder] Total context size: ${totalChars} chars (~${Math.round(totalChars/4)} tokens)`);
        
        if (totalChars === 0) {
            return { success: false, error: 'No readable documents in source pack' };
        }
        
        // Get client info
        const clientName = appState.pendingSourcePack.metadata?.client || 'the client';
        
        // Build the Narrative Builder system prompt
        const systemPrompt = `You are an expert narrative strategist helping users craft the perfect prompt for generating strategic narratives. Your role is to have a GUIDED CONVERSATION to understand exactly what kind of narrative the user wants to create.

CLIENT CONTEXT:
- Client Name: ${clientName}
${sourceSummary}

SOURCE DOCUMENTS:
${sourceContext}

YOUR CONVERSATION GOALS:
You need to gather information about the user's narrative preferences through natural conversation. Key questions to explore (but ask naturally, not as a rigid checklist):

1. **NARRATIVE TYPE** - What kind of narrative angle would resonate most?
   - Value Driver: Focus on specific business value and growth opportunities
   - Divergent Scenario: Explore alternative futures and strategic pivots  
   - Human/C-suite Dynamics: Center on leadership challenges and organizational dynamics

2. **NARRATIVE LENGTH** - How detailed should the narrative be?
   - Brief executive summary (1-2 pages)
   - Standard narrative (3-5 pages)
   - Comprehensive deep-dive (6+ pages)

3. **ADDITIONAL CONTEXT** - Based on what you learn from the sources, probe for:
   - Specific themes they want emphasized
   - Any angles they want to avoid
   - Target audience (board, investors, internal leadership)
   - Tone preferences (bold, measured, visionary, pragmatic)

CONVERSATION STYLE:
- Start by sharing 2-3 interesting insights you found in the source documents (use bullet points • for listing insights)
- Use these insights to naturally lead into questions about their preferences
- Be conversational and helpful, not robotic
- Ask ONE question at a time - never multiple questions in the same message
- Build on their answers to refine your understanding
- Reference specific content from the sources when relevant

FORMATTING RULES:
- For listing insights or observations: use bullet points (• or -)
- For question OPTIONS that the user should choose from: use bold lowercase letters **a)** **b)** **c)** **d)** etc. (as many as appropriate)
- ALWAYS put each option on its own line for readability
- NEVER put options in a paragraph or on the same line
- NEVER use a, b, c for anything other than selectable options to a question

WHEN YOU HAVE ENOUGH INFORMATION:
When you feel you have a clear picture of what they want (typically after 3-5 exchanges), signal that you're ready by:
1. Summarizing what you've understood about their preferences
2. Asking "I think I have everything I need to craft your narrative prompt. Is there anything else you'd like to add or adjust before I generate it?"

GENERATING THE FINAL PROMPT:
When the user confirms they're ready (or says something like "no, go ahead", "that's all", "generate it", etc.), respond with EXACTLY this format:

===NARRATIVE_PROMPT_START===
[Write a comprehensive, detailed prompt for the narrative generation agent. This should include:
- The narrative type and angle
- Specific themes and focus areas from the sources
- Length and depth expectations
- Tone and style guidance
- Target audience considerations
- Any specific elements to include or avoid
- Structure suggestions if applicable]
===NARRATIVE_PROMPT_END===

The prompt between the markers will be extracted and used as the narrative generation instructions.`;

        // Add user message to history
        sourceChatHistory.push({ role: 'user', content: message });
        
        // Keep only last 20 messages for context (more for this guided conversation)
        if (sourceChatHistory.length > 20) {
            sourceChatHistory = sourceChatHistory.slice(-20);
        }
        
        // Build messages array
        const messages = [
            { role: 'system', content: systemPrompt },
            ...sourceChatHistory
        ];
        
        // Call OpenAI
        const model = openaiCreds.model || 'gpt-4o';
        const response = await callOpenAI(openaiCreds.apiKey, model, messages, 3000);
        
        // Add assistant response to history
        sourceChatHistory.push({ role: 'assistant', content: response });
        
        // Check if the response contains a generated prompt
        const promptMatch = response.match(/===NARRATIVE_PROMPT_START===([\s\S]*?)===NARRATIVE_PROMPT_END===/);
        const generatedPrompt = promptMatch ? promptMatch[1].trim() : null;
        
        console.log('[NarrativeBuilder] Response generated successfully');
        if (generatedPrompt) {
            console.log('[NarrativeBuilder] Final prompt generated, length:', generatedPrompt.length);
        }
        
        return { 
            success: true, 
            message: response,
            generatedPrompt: generatedPrompt  // Will be null if not yet generated
        };
        
    } catch (error) {
        console.error('[NarrativeBuilder] Error:', error);
        return { success: false, error: error.message };
    }
});

// Start the Narrative Builder conversation
ipcMain.handle('sourceChat:startConversation', async (event) => {
    console.log('[NarrativeBuilder] Starting guided conversation...');
    
    try {
        // Reset chat history
        sourceChatHistory = [];
        
        // Get OpenAI credentials
        const openaiCreds = await credentialManager.getCredentials('openai');
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
        }
        
        // Get the current source pack content  
        if (!appState.pendingSourcePack || !appState.pendingSourcePack.documents) {
            return { success: false, error: 'No source pack loaded' };
        }
        
        const documents = appState.pendingSourcePack.documents;
        const clientName = appState.pendingSourcePack.metadata?.client || 'your client';
        
        // Build a brief context for the opening message
        let docList = [];
        for (const [fileName, content] of Object.entries(documents)) {
            if (content && typeof content === 'string' && content.length > 100) {
                docList.push(fileName);
            }
        }
        
        // Get first ~2000 chars from main documents for initial insights
        let sampleContent = '';
        const mainDocs = Object.entries(documents)
            .filter(([name, content]) => content && typeof content === 'string' && /^[0-9]+\.[0-9]+_/.test(name))
            .slice(0, 3);
            
        for (const [fileName, content] of mainDocs) {
            sampleContent += `\n=== ${fileName} ===\n${content.substring(0, 2000)}...\n`;
        }
        
        // Generate the opening message
        const systemPrompt = `You are an expert narrative strategist. Generate an engaging opening message for a guided conversation to help the user craft a narrative prompt.

CLIENT: ${clientName}
DOCUMENTS AVAILABLE: ${docList.join(', ')}

SAMPLE CONTENT FROM SOURCES:
${sampleContent}

Generate an opening message that:
1. Warmly greets the user and explains you'll help them craft a narrative
2. Mentions 2-3 interesting insights or themes you spotted in their source documents (use bullet points • for these)
3. Asks ONE opening question about what kind of narrative angle interests them

Be conversational and engaging. Don't be robotic. Make the user excited about the narrative possibilities.

CRITICAL FORMATTING:
- Use bullet points (• or -) for listing insights/observations
- Use bold letters **a)** **b)** **c)** ONLY for the question options the user should choose from
- Put EACH option on its own line for readability (never in a paragraph)
- Ask only ONE question, don't combine multiple questions
- Keep the message focused and not overwhelming`;

        const messages = [{ role: 'system', content: systemPrompt }];
        
        const model = openaiCreds.model || 'gpt-4o';
        const response = await callOpenAI(openaiCreds.apiKey, model, messages, 1500);
        
        // Add to history as the first assistant message
        sourceChatHistory.push({ role: 'assistant', content: response });
        
        console.log('[NarrativeBuilder] Opening message generated');
        
        return { success: true, message: response };
        
    } catch (error) {
        console.error('[NarrativeBuilder] Error starting conversation:', error);
        return { success: false, error: error.message };
    }
});

// ============================================
// Narrative Chat - Step 6 Q&A with Sources + Narrative
// ============================================

let narrativeChatHistory = [];
let narrativeChatCancelled = false;

// Cancel handler
ipcMain.handle('narrativeChat:cancel', async (event) => {
    narrativeChatCancelled = true;
    console.log('[NarrativeChat] Cancellation requested');
    return { success: true };
});

ipcMain.handle('narrativeChat:sendMessage', async (event, { message, narrativeContent, sourcePack, mode = 'ask', highlightedText = null, fullRewriteConfirmed = false }) => {
    console.log('[NarrativeChat] Received message:', message.substring(0, 50) + '...');
    console.log('[NarrativeChat] Mode:', mode);
    console.log('[NarrativeChat] Highlighted text:', highlightedText ? highlightedText.substring(0, 50) + '...' : 'none');
    
    // Reset cancellation flag
    narrativeChatCancelled = false;
    
    try {
        // Get OpenAI credentials
        const openaiCreds = await credentialManager.getCredentials('openai');
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
        }
        
        // Use source pack from parameter (for history) or fall back to appState
        const sourcePackToUse = sourcePack || appState.pendingSourcePack;
        
        // Get the current source pack content
        if (!sourcePackToUse || !sourcePackToUse.documents) {
            return { success: false, error: 'No source pack loaded. This narrative may have been generated before source packs were saved to history.' };
        }
        
        // Build context from source pack documents
        let sourceContext = '';
        const documents = sourcePackToUse.documents;
        
        console.log('[NarrativeChat] Documents in source pack:', Object.keys(documents).length);
        
        const maxContextChars = 150000; // Leave room for narrative
        let totalChars = 0;
        
        // Sort documents - prioritize main source documents
        const sortedDocs = Object.entries(documents).sort((a, b) => {
            const aIsMain = /^[0-9]+\.[0-9]+_/.test(a[0]) && !a[0].includes('_INDEX');
            const bIsMain = /^[0-9]+\.[0-9]+_/.test(b[0]) && !b[0].includes('_INDEX');
            if (aIsMain && !bIsMain) return -1;
            if (!aIsMain && bIsMain) return 1;
            return a[0].localeCompare(b[0]);
        });
        
        for (const [fileName, content] of sortedDocs) {
            if (content && typeof content === 'string') {
                const sampleStart = content.substring(0, 500);
                const isBinary = /[\x00-\x08\x0E-\x1F]/.test(sampleStart) || 
                                 sampleStart.includes('PK\x03\x04') ||
                                 sampleStart.includes('%PDF');
                
                if (isBinary) continue;
                
                const remainingChars = maxContextChars - totalChars;
                if (remainingChars <= 0) break;
                
                const docCount = sortedDocs.length;
                const perDocLimit = Math.max(8000, Math.floor(maxContextChars / docCount));
                const charLimit = Math.min(remainingChars, perDocLimit);
                
                const truncatedContent = content.length > charLimit 
                    ? content.substring(0, charLimit) + '\n... [truncated]'
                    : content;
                    
                sourceContext += `\n\n=== ${fileName} ===\n${truncatedContent}`;
                totalChars += truncatedContent.length;
            }
        }
        
        console.log(`[NarrativeChat] Source context size: ${totalChars} chars`);
        
        // Get client info
        const clientName = sourcePackToUse.metadata?.client || 'the client';
        
        // Check for cancellation
        if (narrativeChatCancelled) {
            return { success: false, cancelled: true };
        }
        
        // Handle different modes
        if (mode === 'iterate') {
            return await handleIterateMode(openaiCreds, clientName, sourceContext, narrativeContent, message, highlightedText, fullRewriteConfirmed);
        } else {
            return await handleAskMode(openaiCreds, clientName, sourceContext, narrativeContent, message);
        }
        
    } catch (error) {
        console.error('[NarrativeChat] Error:', error);
        return { success: false, error: error.message };
    }
});

// Handle Ask mode - Q&A about sources and narrative
async function handleAskMode(openaiCreds, clientName, sourceContext, narrativeContent, message) {
    // Build system prompt for Q&A
    const systemPrompt = `You are an expert research analyst assistant helping users understand their source documents and generated narrative.

CLIENT: ${clientName}

SOURCE DOCUMENTS:
${sourceContext}

GENERATED NARRATIVE:
${narrativeContent || '[No narrative generated yet]'}

---

Your role is to:
1. Answer questions about both the source documents AND the generated narrative
2. Explain how specific parts of the narrative connect to the source material
3. Identify themes, insights, and key points
4. Help users understand the strategic implications
5. Suggest refinements or additional angles to explore

When answering:
- Reference specific documents or sections of the narrative when relevant
- Be direct and concise
- Use bullet points for clarity
- Be honest if something isn't covered in the sources or narrative
- Provide actionable insights`;

    // Add user message to history
    narrativeChatHistory.push({ role: 'user', content: message });
    
    // Keep only last 10 messages for context
    if (narrativeChatHistory.length > 10) {
        narrativeChatHistory = narrativeChatHistory.slice(-10);
    }
    
    // Build messages array
    const messages = [
        { role: 'system', content: systemPrompt },
        ...narrativeChatHistory
    ];
    
    // Check for cancellation
    if (narrativeChatCancelled) {
        return { success: false, cancelled: true };
    }
    
    // Call OpenAI
    const model = openaiCreds.model || 'gpt-4o';
    const response = await callOpenAI(openaiCreds.apiKey, model, messages, 2000);
    
    // Add assistant response to history
    narrativeChatHistory.push({ role: 'assistant', content: response });
    
    console.log('[NarrativeChat] Ask response generated successfully');
    
    return { success: true, message: response };
}

// Handle Iterate mode - Edit the narrative
async function handleIterateMode(openaiCreds, clientName, sourceContext, narrativeContent, message, highlightedText, fullRewriteConfirmed) {
    console.log('[NarrativeChat] Iterate mode - generating edits...');
    
    let editScope = 'targeted';
    if (fullRewriteConfirmed) {
        editScope = 'full';
    } else if (highlightedText) {
        editScope = 'highlighted';
    }
    
    // Build system prompt for editing
    const systemPrompt = `You are an expert narrative editor. Your task is to edit the narrative based on the user's instructions.

CLIENT: ${clientName}

SOURCE DOCUMENTS (for reference):
${sourceContext}

CURRENT NARRATIVE:
${narrativeContent || '[No narrative]'}

---

EDITING INSTRUCTIONS:
${highlightedText ? `
The user has highlighted this specific section for editing:
---
${highlightedText}
---

Focus your edits primarily on this highlighted section, but you may adjust surrounding text if needed for coherence.
` : `
No specific section was highlighted. ${fullRewriteConfirmed ? 'The user has confirmed they want a full rewrite.' : 'Make targeted edits to address the user\'s request without rewriting the entire document.'}
`}

USER REQUEST: ${message}

---

IMPORTANT INSTRUCTIONS:
1. You MUST output the complete updated narrative in your response
2. Maintain the same overall structure and formatting (markdown headers, bullet points, etc.)
3. Keep the same professional tone and style
4. Ensure all changes are grounded in the source documents
5. If the edit request doesn't make sense or contradicts the sources, explain why and suggest alternatives
6. After the narrative, add a brief summary of what you changed

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
---NARRATIVE_START---
[The complete updated narrative goes here]
---NARRATIVE_END---

---CHANGES_SUMMARY---
[Brief summary of what was changed]
---CHANGES_END---`;

    // Check for cancellation
    if (narrativeChatCancelled) {
        return { success: false, cancelled: true };
    }
    
    // Call OpenAI with higher token limit for narrative output
    const model = openaiCreds.model || 'gpt-4o';
    const response = await callOpenAI(openaiCreds.apiKey, model, [
        { role: 'system', content: systemPrompt }
    ], 8000);
    
    // Check for cancellation
    if (narrativeChatCancelled) {
        return { success: false, cancelled: true };
    }
    
    // Parse the response to extract updated narrative
    const narrativeMatch = response.match(/---NARRATIVE_START---\s*([\s\S]*?)\s*---NARRATIVE_END---/);
    const changesMatch = response.match(/---CHANGES_SUMMARY---\s*([\s\S]*?)\s*---CHANGES_END---/);
    
    if (narrativeMatch && narrativeMatch[1]) {
        const updatedNarrative = narrativeMatch[1].trim();
        const changesSummary = changesMatch ? changesMatch[1].trim() : 'Changes applied successfully.';
        
        console.log('[NarrativeChat] Iterate - narrative updated successfully');
        
        // Add to chat history
        narrativeChatHistory.push({ role: 'user', content: `[ITERATE] ${message}` });
        narrativeChatHistory.push({ role: 'assistant', content: `Changes applied: ${changesSummary}` });
        
        return { 
            success: true, 
            message: changesSummary,
            updatedNarrative: updatedNarrative
        };
    } else {
        // If parsing failed, the AI might have just responded with text
        console.log('[NarrativeChat] Iterate - could not parse structured response, returning as message');
        
        narrativeChatHistory.push({ role: 'user', content: `[ITERATE] ${message}` });
        narrativeChatHistory.push({ role: 'assistant', content: response });
        
        return { 
            success: true, 
            message: response
        };
    }
}

// Reset narrative chat history
ipcMain.handle('narrativeChat:reset', async (event) => {
    narrativeChatHistory = [];
    narrativeChatCancelled = false;
    console.log('[NarrativeChat] History reset');
    return { success: true };
});

// Generate Narrative - Multi-Agent Flow
ipcMain.handle('narrative:generate', async (event, { templateId, agentPrompt, sourcePackPath, client, context }) => {
    const requestId = 'narrative_' + Date.now();
    
    console.log('[Narrative] Starting multi-agent generation...');
    
    // Helper to emit logs to AI console
    const emitLog = (agent, message, type) => {
        mainWindow.webContents.send('ai-console-log', { agent, message, type });
        console.log(`[Narrative][${agent}] ${message}`);
    };
    
    // Reset cancellation flag
    appState.narrativeCancelled = false;
    
    emitLog('system', `🚀 Starting multi-agent narrative generation for ${client?.name || 'Unknown'}...`, 'info');
    emitLog('system', 'Pipeline: Analyst → Strategist → Narrator', 'info');
    
    auditLogger.log('RETRIEVAL', 'NARRATIVE_GENERATION_STARTED', { 
        requestId, 
        templateId, 
        client: client?.name,
        mode: 'multi-agent'
    });
    
    try {
        // Get OpenAI credentials
        const openaiCreds = await credentialManager.getCredentials('openai');
        if (!openaiCreds || !openaiCreds.apiKey) {
            return { success: false, error: 'OpenAI API key not configured' };
        }
        
        // Get source pack
        const sourcePack = appState.pendingSourcePack || appState.lastSourcePack;
        
        // Debug logging
        console.log('[Narrative] pendingSourcePack:', appState.pendingSourcePack ? 'exists' : 'null');
        console.log('[Narrative] lastSourcePack:', appState.lastSourcePack ? 'exists' : 'null');
        
        if (!sourcePack) {
            emitLog('system', '❌ No source pack found! Generate a source pack first.', 'error');
            return { 
                success: false, 
                error: 'No source pack found. Please generate a source pack first.' 
            };
        }
        
        if (!sourcePack.documents) {
            emitLog('system', '❌ Source pack has no documents object!', 'error');
            console.log('[Narrative] sourcePack keys:', Object.keys(sourcePack));
            return { 
                success: false, 
                error: 'Source pack is corrupted - no documents found.' 
            };
        }
        
        const docKeys = Object.keys(sourcePack.documents);
        const docCount = docKeys.length;
        
        console.log('[Narrative] Document keys:', docKeys);
        
        // Log document sizes
        for (const [key, val] of Object.entries(sourcePack.documents)) {
            const size = typeof val === 'string' ? val.length : (Buffer.isBuffer(val) ? val.length : 0);
            console.log(`[Narrative] Doc: ${key} = ${size} chars`);
        }
        
        emitLog('system', `📦 Found source pack with ${docCount} documents`, 'success');
        emitLog('system', `Documents: ${docKeys.slice(0, 5).join(', ')}${docKeys.length > 5 ? '...' : ''}`, 'info');
        
        // ========== AGENT 1: ANALYST ==========
        if (appState.narrativeCancelled) {
            emitLog('system', '⚠️ Generation cancelled', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        emitLog('system', 'PHASE 1/3: Deep Analysis', 'info');
        const analysisOutput = await runAnalystAgent(
            sourcePack.documents, 
            client, 
            openaiCreds, 
            emitLog
        );
        
        // ========== AGENT 2: STRATEGIST ==========
        if (appState.narrativeCancelled) {
            emitLog('system', '⚠️ Generation cancelled after analysis', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        emitLog('system', 'PHASE 2/3: Strategic Mapping', 'info');
        const strategyOutput = await runStrategistAgent(
            analysisOutput, 
            agentPrompt, 
            client, 
            openaiCreds, 
            emitLog
        );
        
        // ========== AGENT 3: NARRATOR ==========
        if (appState.narrativeCancelled) {
            emitLog('system', '⚠️ Generation cancelled after strategy', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        emitLog('system', 'PHASE 3/3: Narrative Synthesis', 'info');
        const narrativeContent = await runNarratorAgent(
            analysisOutput,
            strategyOutput, 
            agentPrompt, 
            client, 
            context, 
            openaiCreds, 
            emitLog
        );
        
        if (!narrativeContent) {
            return { success: false, error: 'Failed to generate narrative content' };
        }
        
        emitLog('system', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        emitLog('system', '✅ All agents complete - preparing document...', 'success');
        
        if (!narrativeContent) {
            return { success: false, error: 'Failed to generate narrative content' };
        }
        
        // Save as Word document
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const docFileName = `Narrative_${client?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Unknown'}_${timestamp}.docx`;
        
        const saveResult = await dialog.showSaveDialog(mainWindow, {
            defaultPath: docFileName,
            filters: [{ name: 'Word Document', extensions: ['docx'] }]
        });
        
        if (saveResult.canceled) {
            return { success: false, canceled: true };
        }
        
        // Generate proper Word document using docx library
        const docChildren = [];
        
        // Title
        docChildren.push(new Paragraph({
            text: 'Executive Narrative',
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 }
        }));
        
        // Subtitle with client name
        docChildren.push(new Paragraph({
            text: `Generated Narrative for ${client?.name || 'Client'}`,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 200 }
        }));
        
        // Metadata
        docChildren.push(new Paragraph({
            children: [
                new TextRun({ text: 'Generated: ', bold: true }),
                new TextRun({ text: new Date().toLocaleString() })
            ],
            spacing: { after: 100 }
        }));
        docChildren.push(new Paragraph({
            children: [
                new TextRun({ text: 'Client: ', bold: true }),
                new TextRun({ text: client?.name || 'Unknown' })
            ],
            spacing: { after: 100 }
        }));
        docChildren.push(new Paragraph({
            children: [
                new TextRun({ text: 'Industry: ', bold: true }),
                new TextRun({ text: client?.industry || 'Unknown' })
            ],
            spacing: { after: 400 }
        }));
        
        // Parse and add narrative content
        const lines = narrativeContent.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('### ')) {
                // Section heading
                docChildren.push(new Paragraph({
                    text: trimmedLine.replace('### ', ''),
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 400, after: 200 }
                }));
            } else if (trimmedLine.startsWith('## ')) {
                // Major heading
                docChildren.push(new Paragraph({
                    text: trimmedLine.replace('## ', ''),
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 200 }
                }));
            } else if (trimmedLine.startsWith('# ')) {
                // Title
                docChildren.push(new Paragraph({
                    text: trimmedLine.replace('# ', ''),
                    heading: HeadingLevel.TITLE,
                    spacing: { before: 400, after: 200 }
                }));
            } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ')) {
                // Bullet point
                docChildren.push(new Paragraph({
                    text: trimmedLine.replace(/^[-•]\s*/, ''),
                    bullet: { level: 0 },
                    spacing: { after: 100 }
                }));
            } else if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
                // Bold paragraph
                docChildren.push(new Paragraph({
                    children: [new TextRun({ text: trimmedLine.replace(/\*\*/g, ''), bold: true })],
                    spacing: { after: 100 }
                }));
            } else if (trimmedLine.startsWith('|') && trimmedLine.includes('|')) {
                // Skip markdown table formatting (handled separately if needed)
                continue;
            } else if (trimmedLine === '---') {
                // Horizontal rule - add spacing
                docChildren.push(new Paragraph({ text: '', spacing: { after: 200 } }));
            } else if (trimmedLine.length > 0) {
                // Regular paragraph - handle inline bold
                const parts = trimmedLine.split(/(\*\*[^*]+\*\*)/g);
                const runs = parts.map(part => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                        return new TextRun({ text: part.replace(/\*\*/g, ''), bold: true });
                    }
                    return new TextRun({ text: part });
                });
                docChildren.push(new Paragraph({
                    children: runs,
                    spacing: { after: 100 }
                }));
            }
        }
        
        // Footer
        docChildren.push(new Paragraph({ text: '', spacing: { after: 400 } }));
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: 'Generated by R/StudioGPT', italics: true, color: '666666' })],
            spacing: { before: 400 }
        }));
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: docChildren
            }]
        });
        
        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(saveResult.filePath, buffer);
        
        auditLogger.log('RETRIEVAL', 'NARRATIVE_GENERATION_COMPLETED', { 
            requestId, 
            filePath: saveResult.filePath 
        });
        
        mainWindow.webContents.send('ai-console-log', {
            agent: 'narrator',
            message: 'Narrative document generated successfully!',
            type: 'success'
        });
        
        return { 
            success: true, 
            filePath: saveResult.filePath,
            requestId,
            content: narrativeContent,
            outputIntent: context?.outputIntent || 'Executive Narrative',
            sourcePack: sourcePack  // Return source pack for frontend chat
        };
        
    } catch (error) {
        console.error('Narrative generation error:', error);
        auditLogger.log('RETRIEVAL', 'NARRATIVE_GENERATION_FAILED', { 
            requestId, 
            error: error.message 
        });
        return { success: false, error: error.message };
    }
});

// Cancel narrative generation
ipcMain.handle('narrative:cancel', async () => {
    console.log('[Narrative] Cancellation requested');
    appState.narrativeCancelled = true;
    
    mainWindow.webContents.send('ai-console-log', {
        agent: 'system',
        message: '⚠️ Cancellation requested - stopping generation...',
        type: 'warning'
    });
    
    return { success: true };
});

// Generate section summary
function generateSectionSummary(section, client, context) {
    const now = new Date().toISOString();
    return `# ${section} Overview

## Client: ${client.name}
- **Industry:** ${client.industry}
- **Geography:** ${client.geography}
- **Sector:** ${client.sector}

## Context
- **Output Intent:** ${context.outputIntent}
- **Time Horizon:** ${context.timeHorizon} days
- **Generated:** ${now}

---

## ${section} Analysis

This section contains the ${section.toLowerCase()} analysis for ${client.name}.

### Reports Included:
- ${section} AlphaSense Report (0.${section === 'Situation' ? '1' : section === 'Complication' ? '1' : '1'})
- ${section} ARC Report (0.${section === 'Situation' ? '2' : section === 'Complication' ? '2' : '2'})
- ${section} ChatGPT DeepResearch Report (0.${section === 'Situation' ? '3' : section === 'Complication' ? '3' : '3'})

---
*Generated by R/StudioGPT*
`;
}

// Generate placeholder report for AlphaSense/ARC
function generatePlaceholderReport(section, source, client, reason = 'API not configured') {
    const now = new Date().toISOString();
    return `# ${section} - ${source} Report

## [PLACEHOLDER]

**Status:** This report is a placeholder.
**Reason:** ${reason}

---

## Client: ${client.name}
- **Industry:** ${client.industry}
- **Geography:** ${client.geography}
- **Sector:** ${client.sector}

---

## Placeholder Content

This ${source} report for the **${section}** analysis of **${client.name}** will be populated when the ${source} API is configured.

### Expected Content:
${source === 'AlphaSense' ? `
- Analyst consensus insights
- Expert transcripts and commentary
- Market sentiment analysis
- Key themes and trends
- Notable quotes from industry experts
` : source === 'ARC' ? `
- Industry benchmark data
- Competitive positioning metrics
- Market share analysis
- Performance KPIs
- Trend comparisons
` : `
- AI-powered deep research
- Comprehensive market analysis
- Strategic insights
- Opportunity identification
`}

---

**Generated:** ${now}
**Source:** ${source} [PLACEHOLDER]
*Generated by R/StudioGPT*
`;
}

// Deep Research Agent - Streamlined AI research pattern (2-step for reliability)
async function runDeepResearch(section, client, context, openaiCreds) {
    // Check if fast generate mode is enabled
    const fastMode = context.fastGenerate === true;
    
    // Use the cheapest model in fast mode, otherwise use configured model
    const model = fastMode ? 'gpt-4o-mini' : (openaiCreds.model || 'gpt-4o');
    
    console.log(`[DeepResearch Agent] Starting ${section} analysis for ${client.name}`);
    console.log(`[DeepResearch Agent] Using model: ${model}${fastMode ? ' (FAST MODE)' : ''}`);
    
    // In fast mode, return fallback content immediately to skip API calls
    if (fastMode) {
        console.log(`[DeepResearch Agent] Fast mode - returning fallback content for ${section}`);
        emitAiConsoleLog('system', `Fast Generate mode - using cached template for ${section}`, 'info');
        return generateFallbackReport(section, client, context, model);
    }
    
    emitAiConsoleLog('system', `Starting ${section} Deep Research for ${client.name}`, 'info');
    emitAiConsoleLog('system', `Model: ${model} | Output Intent: ${context.outputIntent}`, 'info');
    
    try {
        // Step 1: Comprehensive research and analysis in a single call
        console.log(`[DeepResearch Agent] Step 1: Comprehensive ${section} research...`);
        emitAiConsoleLog('researcher', `Step 1: Researching ${client.name} - ${section} analysis...`, 'thinking');
        
        const sectionPrompts = {
            'Situation': `You are a senior strategy consultant. Provide a comprehensive SITUATION analysis for ${client.name}.

**Client:** ${client.name}
**Industry:** ${client.industry}
**Geography:** ${client.geography}
**Sector:** ${client.sector || 'Not specified'}

Provide a detailed analysis covering:

1. **Company Overview**: Full company name, headquarters, founding history, current CEO/leadership, approximate revenue and employee scale

2. **Market Position**: Current industry standing, market share estimates, competitive positioning, brand strength

3. **Financial Performance**: Recent revenue trends, profitability, growth trajectory, key financial metrics

4. **Strategic Assets**: Core competencies, competitive advantages, key resources, intellectual property

5. **Industry Context**: Key trends affecting the sector, regulatory environment, macroeconomic factors

6. **Stakeholder Landscape**: Key customers, partners, investors, suppliers, regulators

7. **Recent Developments**: Major announcements, initiatives, leadership changes, M&A activity (last 12-18 months)

Be specific and use data points where possible. Format with clear headers and bullet points. If uncertain about specific numbers, indicate estimates.`,

            'Complication': `You are a senior strategy consultant. Provide a comprehensive COMPLICATION analysis for ${client.name}.

**Client:** ${client.name}
**Industry:** ${client.industry}
**Geography:** ${client.geography}
**Sector:** ${client.sector || 'Not specified'}

Provide a detailed analysis of challenges and complications covering:

1. **Company Overview**: Brief company background and current position

2. **Competitive Threats**: Key competitors, market share dynamics, disruptive new entrants, competitive pressure points

3. **Market Disruption**: Digital disruption, changing customer expectations, new business models threatening the industry

4. **Technology Challenges**: Legacy system issues, digital transformation gaps, technology debt, innovation velocity

5. **Operational Risks**: Supply chain vulnerabilities, talent gaps, operational efficiency challenges

6. **Financial Pressures**: Margin compression, cost inflation, investment constraints, capital allocation trade-offs

7. **Regulatory & External Risks**: Compliance burden, policy changes, ESG pressures, geopolitical factors

8. **Strategic Dilemmas**: Key trade-offs, conflicting priorities, difficult decisions facing leadership

Prioritize by severity and urgency. Be specific about impacts and include data where possible.`,

            'Value': `You are a senior strategy consultant. Provide a comprehensive VALUE creation analysis for ${client.name}.

**Client:** ${client.name}
**Industry:** ${client.industry}
**Geography:** ${client.geography}
**Sector:** ${client.sector || 'Not specified'}

Provide a detailed analysis of value creation opportunities covering:

1. **Company Overview**: Brief company background and current position

2. **Revenue Growth Opportunities**: New markets, products, customer segments, pricing optimization, cross-sell/upsell

3. **Cost Optimization**: Process automation, technology modernization, procurement savings, operating model efficiency

4. **Digital Transformation**: Technology modernization, data monetization, AI/ML opportunities, digital channels

5. **Strategic Options**: M&A opportunities, partnership potential, divestitures, geographic expansion

6. **Innovation Potential**: R&D opportunities, new business models, ecosystem plays, platform strategies

7. **ESG & Sustainability Value**: Environmental initiatives, social impact, governance improvements

8. **Implementation Priorities**: Quick wins (0-6 months), medium-term (6-18 months), strategic bets (18+ months)

Quantify opportunities where possible (%, $, timeframes). Be specific and actionable.`
        };
        
        const comprehensiveAnalysis = await callOpenAI(openaiCreds.apiKey, model, [
            {
                role: 'user',
                content: sectionPrompts[section] || sectionPrompts['Situation']
            }
        ], 4000);
        
        if (!comprehensiveAnalysis) {
            emitAiConsoleLog('system', `Warning: ${section} analysis returned empty, generating fallback content...`, 'warning');
            return generateFallbackReport(section, client, context, model);
        }
        
        console.log(`[DeepResearch Agent] Step 1 complete: ${comprehensiveAnalysis.length} chars`);
        emitAiConsoleLog('analyst', `✓ ${section} research complete (${comprehensiveAnalysis.length} chars)`, 'success');
        
        // Step 2: Polish into executive narrative
        console.log(`[DeepResearch Agent] Step 2: Creating executive narrative...`);
        emitAiConsoleLog('narrator', `Step 2: Crafting executive narrative...`, 'thinking');
        
        const executiveNarrative = await callOpenAI(openaiCreds.apiKey, model, [
            {
                role: 'user',
                content: `Transform this analysis into a polished executive narrative suitable for a ${context.outputIntent}:

${comprehensiveAnalysis}

Requirements:
- Write in a clear, professional, engaging style
- Lead with the most important insights
- Use specific facts, numbers, and examples
- Include clear section headers
- Keep it substantive but concise
- Make it suitable for senior executive consumption

Format as a complete report with Executive Summary and detailed sections.`
            }
        ], 3500);
        
        const finalContent = executiveNarrative || comprehensiveAnalysis;
        
        if (executiveNarrative) {
            console.log(`[DeepResearch Agent] Step 2 complete: ${executiveNarrative.length} chars`);
            emitAiConsoleLog('narrator', `✓ Executive narrative complete (${executiveNarrative.length} chars)`, 'success');
        } else {
            emitAiConsoleLog('system', `Using research directly (narrative polish skipped)`, 'info');
        }
        
        emitAiConsoleLog('system', `${section} Deep Research complete! Total: 2 steps executed`, 'success');
        emitAiConsoleLog('system', `───────────────────────────────────────────`, 'info');
        
        // Compile final report
        const now = new Date().toISOString();
        const report = `# ${section} Analysis - Deep Research Report

## Client Profile
| Field | Value |
|-------|-------|
| **Company** | ${client.name} |
| **Industry** | ${client.industry} |
| **Geography** | ${client.geography} |
| **Sector** | ${client.sector || 'Not specified'} |

## Report Metadata
| Field | Value |
|-------|-------|
| **Output Intent** | ${context.outputIntent} |
| **Analysis Type** | Deep Research (Streamlined) |
| **AI Model** | ${model} |
| **Generated** | ${now} |

---

${finalContent}

---

*This report was generated using the R/StudioGPT Deep Research Agent.*
`;
        
        console.log(`[DeepResearch Agent] Complete! Total report: ${report.length} chars`);
        return report;
        
    } catch (error) {
        console.error(`[DeepResearch Agent] Error:`, error);
        emitAiConsoleLog('system', `Error: ${error.message}`, 'error');
        return generateFallbackReport(section, client, context, openaiCreds.model || 'gpt-4o');
    }
}

// Generate fallback report when API calls fail
function generateFallbackReport(section, client, context, model) {
    const now = new Date().toISOString();
    
    let sectionContent = '';
    if (section === 'Situation') {
        sectionContent = `## Situation Overview

${client.name} is a ${client.industry} organization operating in ${client.geography}.

### Market Position
- Established presence in the ${client.industry} sector
- Competitive positioning influenced by industry dynamics and customer expectations
- Revenue and performance trajectory reflecting market conditions

### Strategic Context
- Operating in an industry undergoing transformation from digital disruption
- Regulatory environment creating both compliance requirements and opportunities
- Macroeconomic factors affecting demand and operational costs

### Current State
- Existing strengths in core business operations
- Technology infrastructure in various stages of modernization
- Workforce capabilities aligned with business model requirements`;
    } else if (section === 'Complication') {
        sectionContent = `## Complications Overview

${client.name} faces several challenges common to the ${client.industry} sector in ${client.geography}.

### External Challenges
- Intensifying competition from traditional players and digital-native disruptors
- Margin pressure from competitive dynamics and cost inflation
- Regulatory changes requiring compliance investment

### Market Disruption
- Digital transformation raising customer expectations
- New entrants targeting high-margin segments
- Platform businesses changing competitive boundaries

### Internal Challenges
- Technology modernization requirements
- Talent competition for digital and data skills
- Change capacity constraints`;
    } else if (section === 'Value') {
        sectionContent = `## Value Creation Opportunities

${client.name} has multiple levers for value creation in the ${client.industry} sector.

### Revenue Growth
- Customer experience optimization
- Digital channel expansion
- New market and segment opportunities

### Cost Optimization
- Process automation potential
- Technology modernization benefits
- Procurement and operating model efficiency

### Strategic Transformation
- Data and analytics capabilities
- Digital platform development
- ESG and sustainability value creation`;
    }
    
    return `# ${section} Analysis - Deep Research Report

## Client Profile
| Field | Value |
|-------|-------|
| **Company** | ${client.name} |
| **Industry** | ${client.industry} |
| **Geography** | ${client.geography} |
| **Sector** | ${client.sector || 'Not specified'} |

## Report Metadata
| Field | Value |
|-------|-------|
| **Output Intent** | ${context.outputIntent} |
| **Analysis Type** | Fallback Content |
| **AI Model** | ${model} (API unavailable) |
| **Generated** | ${now} |

---

${sectionContent}

---

*Note: This report contains template content as the AI analysis service was unavailable. For full analysis, please retry when the service is available.*
`;
}

// ============================================
// OpenAI Rate Limiter & Queue System
// ============================================
const openAIRateLimiter = {
    queue: [],
    isProcessing: false,
    lastCallTime: 0,
    minDelayMs: 500,  // Minimum 500ms between calls (higher throughput)
    retryDelayMs: 3000, // Initial retry delay
    maxRetries: 3,
    
    async enqueue(callFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ callFn, resolve, reject });
            this.processQueue();
        });
    },
    
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.queue.length > 0) {
            const { callFn, resolve, reject } = this.queue.shift();
            
            // Ensure minimum delay between calls
            const now = Date.now();
            const timeSinceLastCall = now - this.lastCallTime;
            if (timeSinceLastCall < this.minDelayMs) {
                const waitTime = this.minDelayMs - timeSinceLastCall;
                console.log(`[Rate Limiter] Waiting ${waitTime}ms before next API call...`);
                await new Promise(r => setTimeout(r, waitTime));
            }
            
            this.lastCallTime = Date.now();
            
            try {
                const result = await callFn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.isProcessing = false;
    }
};

// Fallback model if primary model fails
const FALLBACK_MODEL = 'gpt-4o';

// Helper function to make OpenAI API calls with rate limiting, retry, and model fallback
async function callOpenAI(apiKey, model, messages, maxTokens = 2000) {
    // First try with the requested model
    const result = await openAIRateLimiter.enqueue(() => callOpenAIWithRetry(apiKey, model, messages, maxTokens));
    
    // If the result is null and we're not already using the fallback model, try fallback
    if (result === null && model !== FALLBACK_MODEL) {
        console.log(`[OpenAI] Primary model ${model} returned empty. Trying fallback model ${FALLBACK_MODEL}...`);
        emitAiConsoleLog('system', `Model ${model} returned empty. Trying fallback model ${FALLBACK_MODEL}...`, 'warning');
        
        const fallbackResult = await openAIRateLimiter.enqueue(() => callOpenAIWithRetry(apiKey, FALLBACK_MODEL, messages, maxTokens));
        
        if (fallbackResult) {
            console.log(`[OpenAI] Fallback model succeeded!`);
            emitAiConsoleLog('system', `✓ Fallback model ${FALLBACK_MODEL} succeeded`, 'success');
            return fallbackResult;
        }
    }
    
    return result;
}

// Internal function with retry logic
async function callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount = 0) {
    const https = require('https');
    
    // Determine if this model uses the new Responses API (gpt-5.x models)
    const useResponsesAPI = model.startsWith('gpt-5');
    
    return new Promise((resolve, reject) => {
        let requestBody;
        let apiPath;
        
        if (useResponsesAPI) {
            // Use the Responses API for GPT-5.x models
            // Convert chat messages to a single input string
            const systemMessage = messages.find(m => m.role === 'system')?.content || '';
            const userMessages = messages.filter(m => m.role !== 'system')
                .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                .join('\n\n');
            
            const inputText = systemMessage 
                ? `System Instructions:\n${systemMessage}\n\n${userMessages}`
                : userMessages;
            
            requestBody = JSON.stringify({
                model: model,
                input: inputText,
                max_output_tokens: maxTokens,
                // instructions: systemMessage  // Alternative way to pass system prompt
            });
            apiPath = '/v1/responses';
            
            console.log(`[OpenAI] Using Responses API for ${model}`);
        } else {
            // Use Chat Completions API for other models (gpt-4o, o1, o3, etc.)
            const useNewTokenParam = model.startsWith('o3') || model.startsWith('o1');
            const tokenParam = useNewTokenParam ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
            
            // o1 models don't support temperature
            const tempParam = model.startsWith('o1') ? {} : { temperature: 0.4 };
            
            requestBody = JSON.stringify({
                model: model,
                messages: messages,
                ...tempParam,
                ...tokenParam
            });
            apiPath = '/v1/chat/completions';
        }

        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: apiPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 180000  // 3 minute timeout for o1 (it thinks longer)
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', async () => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.error) {
                        const errorMsg = response.error.message || JSON.stringify(response.error);
                        const errorType = response.error.type || '';
                        const errorCode = response.error.code || '';
                        
                        console.error(`[OpenAI] API Error:`, response.error);
                        
                        // Check if it's a rate limit error
                        const isRateLimitError = 
                            errorType === 'rate_limit_error' ||
                            errorCode === 'rate_limit_exceeded' ||
                            errorMsg.includes('rate limit') ||
                            errorMsg.includes('Rate limit') ||
                            errorMsg.includes('Too Many Requests') ||
                            res.statusCode === 429;
                        
                        if (isRateLimitError && retryCount < openAIRateLimiter.maxRetries) {
                            // Extract retry-after header if available
                            const retryAfter = res.headers['retry-after'];
                            const waitTime = retryAfter 
                                ? parseInt(retryAfter) * 1000 
                                : openAIRateLimiter.retryDelayMs * Math.pow(2, retryCount); // Exponential backoff
                            
                            console.log(`[OpenAI] Rate limited. Retry ${retryCount + 1}/${openAIRateLimiter.maxRetries} in ${waitTime}ms...`);
                            emitAiConsoleLog('system', `Rate limited. Waiting ${Math.round(waitTime/1000)}s before retry ${retryCount + 1}...`, 'warning');
                            
                            await new Promise(r => setTimeout(r, waitTime));
                            
                            // Retry the call
                            try {
                                const retryResult = await callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount + 1);
                                resolve(retryResult);
                            } catch (retryError) {
                                resolve(null);
                            }
                            return;
                        }
                        
                        // Check if it's a quota exceeded error (budget issue, not rate limit)
                        const isQuotaError = 
                            errorMsg.includes('quota') ||
                            errorMsg.includes('insufficient_quota') ||
                            errorCode === 'insufficient_quota';
                        
                        if (isQuotaError) {
                            emitAiConsoleLog('system', `OpenAI quota exceeded. Please check your billing at platform.openai.com`, 'error');
                        } else {
                            emitAiConsoleLog('system', `OpenAI Error: ${errorMsg}`, 'error');
                        }
                        
                        resolve(null);
                        return;
                    }
                    
                    // Log the full response structure for debugging
                    console.log(`[OpenAI] Response structure:`, JSON.stringify({
                        // Chat Completions API fields
                        hasChoices: !!response.choices,
                        choicesLength: response.choices?.length,
                        hasMessage: !!response.choices?.[0]?.message,
                        contentType: typeof response.choices?.[0]?.message?.content,
                        contentLength: response.choices?.[0]?.message?.content?.length,
                        finishReason: response.choices?.[0]?.finish_reason,
                        // Responses API fields
                        hasOutput: !!response.output,
                        outputLength: response.output?.length,
                        outputTypes: response.output?.map(o => o.type),
                        hasOutputText: !!response.output_text,
                        // Common
                        usage: response.usage
                    }));
                    
                    // Extract content - handle both Chat Completions and Responses API formats
                    let content = null;
                    
                    // Try Chat Completions format first
                    if (response.choices?.[0]?.message?.content) {
                        content = response.choices[0].message.content;
                        console.log(`[OpenAI] Extracted content from Chat Completions format`);
                    }
                    // Try Responses API format - check output_text first (convenience field)
                    else if (response.output_text) {
                        content = response.output_text;
                        console.log(`[OpenAI] Extracted content from Responses API output_text`);
                    }
                    // Try Responses API output array
                    else if (response.output && Array.isArray(response.output)) {
                        // Look for message type outputs and extract text content
                        const textParts = [];
                        for (const item of response.output) {
                            if (item.type === 'message' && item.content) {
                                // content is an array of content parts
                                for (const part of item.content) {
                                    if (part.type === 'output_text' && part.text) {
                                        textParts.push(part.text);
                                    } else if (part.type === 'text' && part.text) {
                                        textParts.push(part.text);
                                    }
                                }
                            }
                        }
                        if (textParts.length > 0) {
                            content = textParts.join('\n');
                            console.log(`[OpenAI] Extracted content from Responses API output array (${textParts.length} parts)`);
                        } else {
                            console.log(`[OpenAI] Responses API output array had no text content. Output types:`, response.output.map(o => o.type));
                        }
                    }
                    
                    if (!content) {
                        console.error(`[OpenAI] No content in response. Status: ${res.statusCode}`);
                        console.error(`[OpenAI] Full response:`, JSON.stringify(response).substring(0, 2000));
                        emitAiConsoleLog('system', `OpenAI returned empty response (status ${res.statusCode})`, 'error');
                        resolve(null);
                        return;
                    }
                    
                    // Log successful call
                    const tokensUsed = response.usage?.total_tokens || 'unknown';
                    console.log(`[OpenAI] Success. Model: ${model}, Tokens: ${tokensUsed}`);
                    
                    resolve(content);
                } catch (parseError) {
                    console.error(`[OpenAI] Parse error:`, parseError);
                    console.error(`[OpenAI] Raw data:`, data.substring(0, 500));
                    emitAiConsoleLog('system', `OpenAI response parse error: ${parseError.message}`, 'error');
                    resolve(null);
                }
            });
        });

        req.on('error', async (error) => {
            console.error(`[OpenAI] Request error:`, error);
            
            // Retry on network errors
            if (retryCount < openAIRateLimiter.maxRetries) {
                const waitTime = openAIRateLimiter.retryDelayMs * Math.pow(2, retryCount);
                console.log(`[OpenAI] Network error. Retry ${retryCount + 1}/${openAIRateLimiter.maxRetries} in ${waitTime}ms...`);
                emitAiConsoleLog('system', `Network error. Retrying in ${Math.round(waitTime/1000)}s...`, 'warning');
                
                await new Promise(r => setTimeout(r, waitTime));
                
                try {
                    const retryResult = await callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount + 1);
                    resolve(retryResult);
                } catch (retryError) {
                    resolve(null);
                }
                return;
            }
            
            emitAiConsoleLog('system', `OpenAI request error: ${error.message}`, 'error');
            resolve(null);
        });

        req.setTimeout(180000, () => {
            console.error(`[OpenAI] Request timed out after 3 minutes`);
            emitAiConsoleLog('system', `OpenAI request timed out after 3 minutes`, 'error');
            req.destroy();
            resolve(null);
        });

        req.write(requestBody);
        req.end();
    });
}

// Audit logs
ipcMain.handle('audit:getLogs', async (event, { limit = 100, category } = {}) => {
    return auditLogger.getLogs({ limit, category });
});

// Persist generated packs history
ipcMain.handle('appData:saveGeneratedPacks', async (event, packs) => {
    credentialManager.saveAppData('generatedPacks', packs);
    return { success: true };
});

ipcMain.handle('appData:loadGeneratedPacks', async () => {
    return credentialManager.loadAppData('generatedPacks') || [];
});

// Health check
ipcMain.handle('health:check', async () => {
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        services: {
            alphasense: credentialManager.isConfigured('alphasense'),
            arc: credentialManager.isConfigured('arc'),
            openai: credentialManager.isConfigured('openai'),
            internet: true
        }
    };
});

// ============================================
// Markdown Generator
// ============================================
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
${sourcePack.regulatory_events.map(e => `- **${e.title}** (${e.effective_date})
  - Impact: ${e.impact}
  - Source: ${e.regulator}`).join('\n\n')}

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
${sourcePack.sources.map(s => `- [${s.name}] - ${s.source} (${s.type})`).join('\n')}

---

*Generated: ${sourcePack.metadata.generated_at}*
*Request ID: ${sourcePack.metadata.request_id}*
*Generated by: ${sourcePack.metadata.generated_by}*
`;
}

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    // Save any pending learnings before quitting
    saveLearningsImmediate();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
});

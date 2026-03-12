/**
 * R/StudioGPT
 * Electron Main Process - Standalone Desktop Application
 */

// CRITICAL: Only load Electron essentials first for fast splash screen
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Lazy-loaded modules (loaded after splash is shown)
let uuidv4, axios, Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle;
let PptxGenJS, PizZip, Docxtemplater;

// Deferred module loading - called after splash is visible
function loadHeavyModules() {
    if (!uuidv4) {
        const uuid = require('uuid');
        uuidv4 = uuid.v4;
    }
    if (!axios) axios = require('axios');
    if (!Document) {
        const docx = require('docx');
        Document = docx.Document;
        Packer = docx.Packer;
        Paragraph = docx.Paragraph;
        TextRun = docx.TextRun;
        HeadingLevel = docx.HeadingLevel;
        Table = docx.Table;
        TableRow = docx.TableRow;
        TableCell = docx.TableCell;
        WidthType = docx.WidthType;
        BorderStyle = docx.BorderStyle;
    }
    if (!PptxGenJS) PptxGenJS = require('pptxgenjs');
    if (!PizZip) PizZip = require('pizzip');
    if (!Docxtemplater) Docxtemplater = require('docxtemplater');
}

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
    { id: 'cl-001', name: 'Vodafone Group PLC', commonName: 'Vodafone', industry: 'Telecommunications', geography: 'Europe', sector: 'Mobile & Fixed Communications' },
    { id: 'cl-002', name: 'Unilever PLC', commonName: 'Unilever', industry: 'Consumer Goods', geography: 'Europe', sector: 'FMCG & Personal Care' },
    { id: 'cl-003', name: 'BP PLC', commonName: 'BP', industry: 'Energy', geography: 'Europe', sector: 'Oil & Gas, Low Carbon Energy' },
    { id: 'cl-004', name: 'Lloyds Banking Group PLC', commonName: 'Lloyds', industry: 'Financial Services', geography: 'Europe', sector: 'Retail & Commercial Banking' },
    { id: 'cl-005', name: 'GlaxoSmithKline PLC', commonName: 'GSK', industry: 'Healthcare', geography: 'Europe', sector: 'Pharmaceuticals & Consumer Health' },
    { id: 'cl-006', name: 'Rio Tinto Group', commonName: 'Rio Tinto', industry: 'Mining & Metals', geography: 'Global', sector: 'Mining & Natural Resources' },
    { id: 'cl-007', name: 'Schneider Electric SE', commonName: 'Schneider Electric', industry: 'Industrial', geography: 'Europe', sector: 'Energy Management & Automation' },
    { id: 'cl-008', name: 'Marriott International', commonName: 'Marriott', industry: 'Hospitality', geography: 'North America', sector: 'Hotels & Lodging' },
    { id: 'cl-009', name: 'Philips N.V.', commonName: 'Philips', industry: 'Healthcare Technology', geography: 'Europe', sector: 'Health Technology & Consumer Electronics' },
    { id: 'cl-010', name: 'Deutsche Telekom AG', commonName: 'Deutsche Telekom', industry: 'Telecommunications', geography: 'Europe', sector: 'Integrated Telecommunications' }
];

// Application state - load persisted data
console.log('[Startup] ========== LOADING WORKSHOP TEMPLATES ==========');
console.log('[Startup] Timestamp:', new Date().toISOString());

// First check what's ACTUALLY on disk
const diskTemplates = credentialManager.loadAppDataFromDisk('workshopTemplates');
console.log('[Startup] DISK CHECK - PPTX exists:', !!diskTemplates?.pptx?.content);
console.log('[Startup] DISK CHECK - DOCX exists:', !!diskTemplates?.docx?.content);
if (diskTemplates?.pptx) {
    console.log('[Startup] DISK CHECK - PPTX filename:', diskTemplates.pptx.filename);
    console.log('[Startup] DISK CHECK - PPTX uploadedAt:', diskTemplates.pptx.uploadedAt);
    console.log('[Startup] DISK CHECK - PPTX content length:', diskTemplates.pptx.content?.length || 0);
}

// Now load via cache (which should match)
const loadedWorkshopTemplates = credentialManager.loadAppData('workshopTemplates');
console.log('[Startup] CACHE CHECK - PPTX template found:', !!loadedWorkshopTemplates?.pptx?.content);
console.log('[Startup] CACHE CHECK - DOCX template found:', !!loadedWorkshopTemplates?.docx?.content);
if (loadedWorkshopTemplates?.pptx) {
    console.log('[Startup] CACHE CHECK - PPTX filename:', loadedWorkshopTemplates.pptx.filename);
    console.log('[Startup] CACHE CHECK - PPTX content length:', loadedWorkshopTemplates.pptx.content?.length || 0);
}
console.log('[Startup] ================================================');

const appState = {
    user: credentialManager.loadAppData('userSession') || null, // Persist login session
    clients: credentialManager.loadAppData('clients') || [...defaultClients],
    workshopTemplates: loadedWorkshopTemplates || {
        pptx: null,  // { filename, content (base64), uploadedAt }
        docx: null
    },
    placeholders: credentialManager.loadAppData('placeholders') || [],
    narrativeCancelled: false,  // Flag for cancelling narrative generation
    // Each placeholder: { id, name, prompt, createdAt }
};

// Backfill commonName for existing clients that don't have one
(function backfillCommonNames() {
    let updated = false;
    for (const client of appState.clients) {
        if (!client.commonName) {
            // Derive a short common name by stripping common suffixes
            client.commonName = (client.name || 'Client')
                .replace(/\s+(PLC|plc|Inc\.?|Corporation|Corp\.?|Ltd\.?|LLC|S\.?A\.?|AG|SE|N\.?V\.?|Group|Holdings|International|Incorporated)$/gi, '')
                .replace(/\s+(PLC|plc|Inc\.?|Corporation|Corp\.?|Ltd\.?|LLC|S\.?A\.?|AG|SE|N\.?V\.?|Group|Holdings|International|Incorporated)$/gi, '') // second pass for "Group PLC" etc.
                .trim();
            updated = true;
        }
    }
    if (updated) {
        credentialManager.saveAppData('clients', appState.clients);
        console.log('[Startup] Backfilled commonName for existing clients');
    }
})();

// Source chat history (for Step 6 Q&A)
let sourceChatHistory = [];

// Demo users
const validUsers = {
    'client.lead': { password: 'demo123', role: 'client_lead', name: 'Ed Goh' },
    'industry.lead': { password: 'demo123', role: 'industry_lead', name: 'Sarah Chen' },
    'analyst': { password: 'demo123', role: 'analyst', name: 'James Wilson' },
    'admin': { password: 'admin123', role: 'admin', name: 'System Admin' }
};

// Splash window reference
let splashWindow = null;

// Check if launched with native splash (from VBS launcher)
const hasNativeSplash = process.argv.includes('--close-splash');

// Close the native HTA splash screen
function closeNativeSplash() {
    if (hasNativeSplash) {
        // Kill the HTA splash
        const { exec } = require('child_process');
        exec('taskkill /F /IM mshta.exe 2>nul', (err) => {
            // Ignore errors - splash may already be closed
        });
    }
}

function createSplashWindow() {
    // Skip Electron splash if native HTA splash is already showing
    if (hasNativeSplash) {
        return;
    }
    
    const basePath = getBasePath();
    
    splashWindow = new BrowserWindow({
        width: 400,
        height: 450,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    
    splashWindow.loadFile(path.join(basePath, 'public', 'splash.html'));
    
    // Handle splash closed unexpectedly
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

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

    // Show window when ready and close splash
    mainWindow.once('ready-to-show', () => {
        // Close native HTA splash if it's running
        closeNativeSplash();
        
        // Close Electron splash window with a small delay for smooth transition
        if (splashWindow && !splashWindow.isDestroyed()) {
            setTimeout(() => {
                if (splashWindow && !splashWindow.isDestroyed()) {
                    splashWindow.close();
                    splashWindow = null;
                }
                mainWindow.show();
                mainWindow.focus();
            }, 300);
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
        
        // Show splash message in console
        console.log(`
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬â€
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                               ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬ R/StudioGPT                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬   ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   Desktop Application v1.0.0                                  ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                               ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   Demo Credentials:                                           ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ client.lead / demo123                                     ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ   ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ admin / admin123                                          ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                               ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã…Â¡ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
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
                            detail: 'Version 1.0.0\n\nA governed intelligence assembly tool for generating schema-validated Source Packs from strategic data sources.\n\nÃƒâ€šÃ‚Â© 2026 R/StudioGPT Team'
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

// Update a client's editable fields (e.g., commonName)
ipcMain.handle('clients:update', async (event, { id, updates }) => {
    const client = appState.clients.find(c => c.id === id);
    if (!client) {
        return { success: false, error: 'Client not found' };
    }
    
    // Allow updating specific fields
    const allowedFields = ['commonName', 'industry', 'geography', 'sector'];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            client[field] = updates[field];
        }
    }
    
    // Persist
    credentialManager.saveAppData('clients', appState.clients);
    
    auditLogger.log('CLIENT', 'UPDATED', { 
        clientId: id,
        clientName: client.name,
        updatedFields: Object.keys(updates).filter(k => allowedFields.includes(k)),
        user: appState.user?.username 
    });
    
    return { success: true, client };
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
            commonName: aiResult.commonName || aiResult.officialName || companyName,
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
        
        const model = openaiCreds.model || 'gpt-5.2';
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
        
        emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Extracted ${currentCount} stakeholder${currentCount !== 1 ? 's' : ''} from POC`, 'success');
        
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
            model: 'gpt-5.2',  // Use GPT-5 series for web search
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

// Call OpenAI Responses API with web search for placeholder research
async function callOpenAIWebSearchForResearch(apiKey, query, client) {
    const https = require('https');
    
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await new Promise((resolve, reject) => {
                const requestBody = JSON.stringify({
                    model: 'gpt-5.2',  // Use GPT-5 series for web search
                    input: query,
                    tools: [{ type: 'web_search_preview' }],
                    tool_choice: 'auto',
                    max_output_tokens: 4000
                });
                
                console.log(`[WebSearchResearch] Making request to Responses API (attempt ${attempt}/${maxRetries})...`);
                
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
                    timeout: 180000  // 3 minute timeout for research
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
                                console.error('[WebSearchResearch] API Error:', response.error);
                                // Check if it's a retryable error (rate limit or server error)
                                if (response.error.type === 'rate_limit_error' || 
                                    response.error.code === 'rate_limit_exceeded' ||
                                    (res.statusCode >= 500 && res.statusCode < 600)) {
                                    reject({ retryable: true, message: response.error.message || 'Rate limited' });
                                    return;
                                }
                                resolve('');
                                return;
                            }
                            
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
                                console.log('[WebSearchResearch] No text content found in response');
                                resolve('');
                                return;
                            }
                            
                            console.log('[WebSearchResearch] Research content length:', textContent.length);
                            
                            // Return the research content (truncate if too long)
                            const maxResearchLength = 8000;
                            if (textContent.length > maxResearchLength) {
                                textContent = textContent.substring(0, maxResearchLength) + '\n...[Research truncated for length]';
                            }
                            
                            resolve(textContent);
                            
                        } catch (parseError) {
                            console.error('[WebSearchResearch] Response parse error:', parseError);
                            resolve('');
                        }
                    });
                });
                
                req.on('error', (error) => {
                    console.error('[WebSearchResearch] Request error:', error.message);
                    // Network errors are retryable
                    const isNetworkError = 
                        error.code === 'ENOTFOUND' ||
                        error.code === 'ETIMEDOUT' ||
                        error.code === 'ECONNRESET' ||
                        error.code === 'ECONNREFUSED' ||
                        error.code === 'EAI_AGAIN' ||
                        error.message.includes('getaddrinfo') ||
                        error.message.includes('socket hang up');
                    
                    if (isNetworkError) {
                        reject({ retryable: true, message: error.message, code: error.code });
                    } else {
                        resolve('');
                    }
                });
                
                req.setTimeout(180000, () => {
                    console.error('[WebSearchResearch] Request timed out');
                    req.destroy();
                    reject({ retryable: true, message: 'Request timed out', code: 'ETIMEDOUT' });
                });
                
                req.write(requestBody);
                req.end();
            });
            
            // If we got here, the request succeeded
            return result;
            
        } catch (error) {
            // Check if error is retryable and we have retries left
            if (error.retryable && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
                console.log(`[WebSearchResearch] Retryable error on attempt ${attempt}/${maxRetries}: ${error.message}. Retrying in ${delay/1000}s...`);
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `ÃƒÂ¢Ã…Â¡Ã‚Â  Research network issue, retrying (${attempt}/${maxRetries})...`,
                        type: 'warning'
                    });
                }
                
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            // Non-retryable error or max retries reached
            console.error('[WebSearchResearch] Failed after retries:', error.message);
            return '';
        }
    }
    
    // Should not reach here, but return empty string just in case
    return '';
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
    "commonName": "The short name this company is commonly known as in everyday business conversation (e.g., 'Reckitt' not 'Reckitt Benckiser Group plc', 'GSK' not 'GlaxoSmithKline PLC', 'BP' not 'BP PLC', 'Vodafone' not 'Vodafone Group PLC')",
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
        emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Successfully analyzed "${result.officialName || companyName}" (${result.headquartersCountry || result.geography})`, 'success');
        
        // Web search verification: confirm the current official and common names
        // Companies rebrand (e.g., Reckitt Benckiser ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Reckitt, Facebook ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Meta)
        // The AI model's training data may be stale, so we verify with a live web search
        let verifiedOfficialName = result.officialName || companyName;
        let verifiedCommonName = result.commonName || result.officialName || companyName;
        
        try {
            emitAiConsoleLog('system', `ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Verifying current company name via web search...`, 'info');
            
            const nameVerificationQuery = `What is the current official legal name and commonly known brand name of "${companyName}" as of ${new Date().getFullYear()}? Has this company rebranded, changed its name, or simplified its trading name recently? Respond with ONLY a JSON object: {"officialName": "current full legal name", "commonName": "the short name commonly used in business and media"}`;
            
            const webResult = await callOpenAIWebSearchForResearch(apiKey, nameVerificationQuery, null);
            
            if (webResult && webResult.length > 0) {
                // Try to extract JSON from the web search response
                const jsonMatch = webResult.match(/\{[^{}]*"officialName"[^{}]*"commonName"[^{}]*\}/);
                if (jsonMatch) {
                    try {
                        const nameData = JSON.parse(jsonMatch[0]);
                        if (nameData.officialName && nameData.officialName.length > 1) {
                            verifiedOfficialName = nameData.officialName;
                            console.log(`[ClientAnalysis] Web verified official name: ${verifiedOfficialName}`);
                        }
                        if (nameData.commonName && nameData.commonName.length > 1) {
                            verifiedCommonName = nameData.commonName;
                            console.log(`[ClientAnalysis] Web verified common name: ${verifiedCommonName}`);
                        }
                        emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Name verified: "${verifiedCommonName}" (official: ${verifiedOfficialName})`, 'success');
                    } catch (parseErr) {
                        console.log('[ClientAnalysis] Could not parse name verification JSON, using AI result');
                    }
                } else {
                    // Fallback: try to extract names from free-text response
                    // Look for patterns like "officially known as X" or "commonly called X"
                    const officialMatch = webResult.match(/official(?:ly| name| legal name)[^"]*?["""]([^"""]+)["""]/i) ||
                                          webResult.match(/legal name[^"]*?["""]([^"""]+)["""]/i);
                    const commonMatch = webResult.match(/common(?:ly| name| known)[^"]*?["""]([^"""]+)["""]/i) ||
                                        webResult.match(/(?:trades?|trading|branded?|known) (?:as|under)[^"]*?["""]([^"""]+)["""]/i);
                    
                    if (officialMatch?.[1]) {
                        verifiedOfficialName = officialMatch[1].trim();
                        emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Official name verified: "${verifiedOfficialName}"`, 'success');
                    }
                    if (commonMatch?.[1]) {
                        verifiedCommonName = commonMatch[1].trim();
                        emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Common name verified: "${verifiedCommonName}"`, 'success');
                    }
                }
            }
        } catch (verifyError) {
            console.log('[ClientAnalysis] Name web verification failed (non-critical):', verifyError.message);
            emitAiConsoleLog('system', `ÃƒÂ¢Ã…Â¡Ã‚Â  Name verification skipped (using AI result)`, 'warning');
        }
        
        return {
            officialName: verifiedOfficialName,
            commonName: verifiedCommonName,
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
        // Derive commonName from the lookup key (the short name the user typed)
        const derivedCommonName = knownCompany.commonName || companyName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return { ...knownCompany, commonName: derivedCommonName, confidence: 0.95 };
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
        commonName: capitalizedName,
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
        alphasense: 'Provide market intelligence and analyst insights on {clientName}, including financial performance, industry trends, and competitive landscape.',
        alphasenseStrategy: 'Provide a detailed analysis of {clientName}\'s corporate strategy, including strategic priorities, transformation initiatives, growth plans, capital allocation, and executive statements on future direction.'
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
            alphasense: { success: false, error: null, fileName: '3.0_AlphaSense_Market_Report.md' },
            alphasenseStrategy: { success: false, error: null, fileName: '4.0_AlphaSense_Strategy_Report.md' }
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
                const model = openaiCreds.model || 'gpt-5.2';
                
                const response = await callOpenAI(openaiCreds.apiKey, model, [
                    { role: 'system', content: 'You are a senior business researcher providing comprehensive analysis for executive-level decision making. Format your response in clear markdown with headers and bullet points.' },
                    { role: 'user', content: chatgptPrompt }
                ]);
                
                documents[sourceResults.chatgpt.fileName] = `# ChatGPT Research Report\n\n**Client:** ${client.name}  \n**Generated:** ${timestamp}  \n**Model:** ${model}\n\n---\n\n${response}`;
                sourceResults.chatgpt.success = true;
                emitAiConsoleLog('researcher', 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ ChatGPT research report complete', 'success');
                sendProgress('chatgpt', 'ChatGPT research complete', 30, 100);
            } catch (e) {
                console.error('[ChatGPT Error]', e);
                sourceResults.chatgpt.error = e.message;
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…Â¡Ã‚Â  ChatGPT error: ${e.message}`, 'error');
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
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ ARC report: ${arcResults?.assets?.length || 0} assets found`, 'success');
                sendProgress('arc', 'ARC assets report complete', 55, 100);
            } catch (e) {
                console.error('[ARC Error]', e);
                sourceResults.arc.error = e.message;
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…Â¡Ã‚Â  ARC error: ${e.message}`, 'error');
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
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ AlphaSense: ${alphaResults?.documents?.length || 0} documents analysed`, 'success');
                sendProgress('alphasense', 'AlphaSense market report complete', 70, 100);
            } catch (e) {
                console.error('[AlphaSense Error]', e);
                sourceResults.alphasense.error = e.message;
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…Â¡Ã‚Â  AlphaSense error: ${e.message}`, 'error');
                documents[sourceResults.alphasense.fileName] = generateSourcePlaceholder('AlphaSense Market', client, e.message);
            }
        } else {
            sourceResults.alphasense.error = 'AlphaSense API not configured';
            documents[sourceResults.alphasense.fileName] = generateSourcePlaceholder('AlphaSense Market', client, 'AlphaSense API not configured');
            sendProgress('alphasense', 'AlphaSense report [PLACEHOLDER - API not configured]', 70);
        }

        // =====================================
        // Source 4: AlphaSense Strategy Report
        // =====================================
        sendProgress('alphasenseStrategy', 'Generating AlphaSense strategy report...', 75, 10);
        
        if (hasAlphaSense) {
            emitAiConsoleLog('researcher', 'AlphaSense: Searching for client strategy information...', 'thinking');
            try {
                // Use a strategy-focused search (reusing the connector but with different focus)
                const strategyContext = { ...context, searchFocus: 'strategy' };
                const strategyResults = await alphasenseConnector.runComprehensiveSearch(client, strategyContext, (msg) => {
                    emitAiConsoleLog('researcher', `AlphaSense Strategy: ${msg}`, 'thinking');
                });
                
                // Format as strategy report
                const strategyReport = alphasenseConnector.formatStrategyReport 
                    ? alphasenseConnector.formatStrategyReport(client, context, strategyResults)
                    : formatAlphasenseStrategyReport(client, context, strategyResults);
                    
                documents[sourceResults.alphasenseStrategy.fileName] = strategyReport;
                sourceResults.alphasenseStrategy.success = true;
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ AlphaSense Strategy: Client strategy analysis complete`, 'success');
                sendProgress('alphasenseStrategy', 'AlphaSense strategy report complete', 85, 100);
            } catch (e) {
                console.error('[AlphaSense Strategy Error]', e);
                sourceResults.alphasenseStrategy.error = e.message;
                emitAiConsoleLog('researcher', `ÃƒÂ¢Ã…Â¡Ã‚Â  AlphaSense Strategy error: ${e.message}`, 'error');
                documents[sourceResults.alphasenseStrategy.fileName] = generateSourcePlaceholder('AlphaSense Strategy', client, e.message);
            }
        } else {
            sourceResults.alphasenseStrategy.error = 'AlphaSense API not configured';
            documents[sourceResults.alphasenseStrategy.fileName] = generateSourcePlaceholder('AlphaSense Strategy', client, 'AlphaSense API not configured');
            sendProgress('alphasenseStrategy', 'AlphaSense strategy report [PLACEHOLDER - API not configured]', 85);
        }

        sendProgress('normalize', 'Validating generated sources...', 90, 50);

        // Build list of failed sources for frontend (also used as placeholderSections)
        const failedSources = [];
        for (const [source, result] of Object.entries(sourceResults)) {
            if (!result.success) {
                const sourceName = source === 'chatgpt' ? 'ChatGPT Research Report' : 
                      source === 'arc' ? 'ARC Assets Report' : 
                      source === 'alphasense' ? 'AlphaSense Market Report' :
                      source === 'alphasenseStrategy' ? 'AlphaSense Strategy Report' :
                      source.charAt(0).toUpperCase() + source.slice(1);
                      
                failedSources.push({
                    id: source,
                    name: sourceName,
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

// Helper function to format AlphaSense strategy report (fallback if connector doesn't have this method)
function formatAlphasenseStrategyReport(client, context, results) {
    const timestamp = new Date().toISOString().split('T')[0];
    return `# AlphaSense Strategy Report

**Client:** ${client.name}  
**Industry:** ${client.industry || 'Not specified'}  
**Generated:** ${timestamp}

---

## Client Strategy Analysis

This report contains strategic intelligence gathered from AlphaSense regarding ${client.name}'s corporate strategy, priorities, and future direction.

${results?.documents?.length ? `### Sources Analyzed: ${results.documents.length} documents` : ''}

## Strategic Priorities

*Analysis of ${client.name}'s stated strategic priorities and focus areas.*

## Transformation Initiatives

*Overview of major transformation programs and change initiatives.*

## Growth Plans

*Identified growth strategies, market expansion plans, and investment priorities.*

## Executive Statements

*Key quotes and statements from leadership regarding future direction.*

---
*Generated by AlphaSense via R/StudioGPT*
`;
}

// Helper function to generate placeholder for failed sources
function generateSourcePlaceholder(sourceName, client, reason) {
    return `# ${sourceName} Report

**Client:** ${client.name}  
**Status:** ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Placeholder - Source Not Available

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
        emitAiConsoleLog('system', `Added: ${fileName}${extracted.converted ? ` ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ${savedFileName}` : ''}`, 'success');
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
    emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ POC file added: ${finalFileName}`, 'success');
    
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
    emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced ${placeholder.name} with ${fileName}`, 'success');
    
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
        emitAiConsoleLog('system', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ ${additionalFilesCount} additional documents included in Source Pack`, 'success');
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
        
        // Return the source pack so it can be saved to history for later retrieval
        return {
            success: true,
            requestId,
            filePath: result.filePath,
            documentCount: Object.keys(documents).length,
            additionalFilesCount,
            sourcePack: appState.lastSourcePack  // Include full source pack for history persistence
        };
        
    } catch (error) {
        auditLogger.log('RETRIEVAL', 'ZIP_FINALIZATION_FAILED', { requestId, error: error.message });
        return { success: false, error: error.message };
    }
});

// ============================================
// Supporting Documents – Upload & Chunking
// ============================================

const documentChunker = require('./src/services/documentChunker');

// In-memory corpus per session
if (!appState.supportingDocsCorpus) {
    appState.supportingDocsCorpus = null;     // { documents[], totalChunks, ... }
}
if (!appState.supportingDocFiles) {
    appState.supportingDocFiles = [];         // {id, fileName, filePath, size, status, error?}
}

// Let the user pick files via native dialog, copy to temp, return metadata
ipcMain.handle('supportingDocs:upload', async () => {
    const fileSelection = await dialog.showOpenDialog(mainWindow, {
        title: 'Upload Supporting Documents',
        buttonLabel: 'Upload',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Documents', extensions: ['pptx','pdf','docx','doc','xlsx','xls','csv','md','txt','rtf','html','htm','json','eml','msg'] },
            { name: 'Images', extensions: ['jpg','jpeg','png','gif','bmp','webp'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (fileSelection.canceled || fileSelection.filePaths.length === 0) {
        return { success: false, canceled: true };
    }

    // Create temp dir for copies
    const tmpDir = path.join(app.getPath('temp'), 'rstudiogpt-docs');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const added = [];
    for (const fp of fileSelection.filePaths) {
        const fileName = path.basename(fp);
        const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tmpPath = path.join(tmpDir, `${id}_${fileName}`);
        fs.copyFileSync(fp, tmpPath);

        const entry = {
            id,
            fileName,
            filePath: tmpPath,
            originalPath: fp,
            size: fs.statSync(fp).size,
            ext: path.extname(fileName).toLowerCase(),
            status: 'pending'   // pending → processing → done | error
        };
        appState.supportingDocFiles.push(entry);
        added.push(entry);
    }

    return { success: true, files: added, totalFiles: appState.supportingDocFiles.length };
});

// Serialisation chain – ensures only one batch processes at a time so
// concurrent uploads never race on the corpus merge.
let _docProcessChain = Promise.resolve();

// Process all pending docs into chunks (or re-process everything)
ipcMain.handle('supportingDocs:process', async () => {
    const p = _docProcessChain.then(() => _doProcessSupportingDocs());
    _docProcessChain = p.catch(() => {}); // keep chain alive on error
    return p;
});

async function _doProcessSupportingDocs() {
    const files = appState.supportingDocFiles.filter(f => f.status === 'pending' || f.status === 'error');
    if (files.length === 0 && appState.supportingDocsCorpus) {
        return { success: true, corpus: getSafeCorpusSummary(), message: 'Already processed' };
    }
    if (files.length === 0) {
        return { success: true, corpus: getSafeCorpusSummary(), message: 'No files to process' };
    }

    console.log(`[SupportingDocs] Processing ${files.length} file(s)...`);

    // Grab OpenAI key for image extraction
    const openaiCreds = credentialManager.getCredentials('openai');
    const openaiApiKey = (openaiCreds && openaiCreds.configured && openaiCreds.apiKey) ? openaiCreds.apiKey : null;

    // Mark as processing
    for (const f of files) f.status = 'processing';

    // Send progress to renderer
    const onProgress = (current, total, fileName) => {
        mainWindow?.webContents?.send('supportingDocs:progress', { current, total, fileName });
    };

    try {
        const batchResult = await documentChunker.processDocumentBatch(
            files.map(f => ({ filePath: f.filePath, fileName: f.fileName })),
            { openaiApiKey, onProgress }
        );

        // Update file statuses — detect 0-chunk docs as warnings
        for (let i = 0; i < files.length; i++) {
            const doc = batchResult.documents[i];
            if (doc && !doc.error) {
                if (doc.chunks.length === 0) {
                    // Extracted OK but no text — flag so user knows
                    files[i].status = 'error';
                    files[i].error = 'No extractable text content found in this file';
                    files[i].chunkCount = 0;
                    console.warn(`[SupportingDocs] 0 chunks from: ${files[i].fileName}`);
                } else {
                    files[i].status = 'done';
                    files[i].chunkCount = doc.chunks.length;
                }
            } else {
                files[i].status = 'error';
                files[i].error = doc?.error || 'Unknown error';
                console.error(`[SupportingDocs] Error processing ${files[i].fileName}: ${files[i].error}`);
            }
        }

        // Merge with any previously processed docs
        if (appState.supportingDocsCorpus) {
            appState.supportingDocsCorpus.documents.push(...batchResult.documents);
            appState.supportingDocsCorpus.totalChunks += batchResult.totalChunks;
            appState.supportingDocsCorpus.totalDocuments += batchResult.totalDocuments;
            appState.supportingDocsCorpus.successfulDocuments += batchResult.successfulDocuments;
            appState.supportingDocsCorpus.failedDocuments += batchResult.failedDocuments;
        } else {
            appState.supportingDocsCorpus = batchResult;
        }

        const doneCount = files.filter(f => f.status === 'done').length;
        const errCount = files.filter(f => f.status === 'error').length;
        console.log(`[SupportingDocs] Batch complete: ${doneCount} OK, ${errCount} failed`);

        return {
            success: true,
            corpus: getSafeCorpusSummary(),
            files: appState.supportingDocFiles
        };
    } catch (error) {
        console.error('[SupportingDocs] Processing failed:', error);
        for (const f of files) {
            f.status = 'error';
            f.error = error.message;
        }
        return { success: false, error: error.message, files: appState.supportingDocFiles };
    }
}

// Remove a single file from the upload list (and its chunks from corpus)
ipcMain.handle('supportingDocs:remove', async (event, { fileId }) => {
    const idx = appState.supportingDocFiles.findIndex(f => f.id === fileId);
    if (idx === -1) return { success: false, error: 'File not found' };

    const removed = appState.supportingDocFiles.splice(idx, 1)[0];
    // Clean up temp file
    try { if (fs.existsSync(removed.filePath)) fs.unlinkSync(removed.filePath); } catch {}

    // Remove from corpus
    if (appState.supportingDocsCorpus) {
        const sourceId = appState.supportingDocsCorpus.documents.find(
            d => d.sourceName === removed.fileName
        )?.sourceId;
        if (sourceId) {
            appState.supportingDocsCorpus.documents = appState.supportingDocsCorpus.documents.filter(
                d => d.sourceId !== sourceId
            );
            appState.supportingDocsCorpus.totalChunks = appState.supportingDocsCorpus.documents.reduce(
                (sum, d) => sum + (d.chunks?.length || 0), 0
            );
            appState.supportingDocsCorpus.totalDocuments = appState.supportingDocsCorpus.documents.length;
        }
    }

    return { success: true, files: appState.supportingDocFiles, corpus: getSafeCorpusSummary() };
});

// Clear everything
ipcMain.handle('supportingDocs:clear', async () => {
    // Delete temp files
    for (const f of appState.supportingDocFiles) {
        try { if (fs.existsSync(f.filePath)) fs.unlinkSync(f.filePath); } catch {}
    }
    appState.supportingDocFiles = [];
    appState.supportingDocsCorpus = null;
    return { success: true };
});

// Get current state (files + corpus summary)
ipcMain.handle('supportingDocs:getState', async () => {
    return {
        files: appState.supportingDocFiles,
        corpus: getSafeCorpusSummary()
    };
});

// Search the corpus
ipcMain.handle('supportingDocs:search', async (event, { query, limit }) => {
    if (!appState.supportingDocsCorpus) return { results: [] };
    const results = documentChunker.searchCorpus(appState.supportingDocsCorpus, query, limit || 20);
    return { results };
});

// Helper: return a safe summary (no huge content payloads)
function getSafeCorpusSummary() {
    if (!appState.supportingDocsCorpus) return null;
    const c = appState.supportingDocsCorpus;
    return {
        totalChunks: c.totalChunks,
        totalDocuments: c.totalDocuments,
        successfulDocuments: c.successfulDocuments,
        failedDocuments: c.failedDocuments,
        processedAt: c.processedAt,
        documents: (c.documents || []).map(d => ({
            sourceId: d.sourceId,
            sourceName: d.sourceName,
            sourceType: d.sourceType,
            chunkCount: d.chunks?.length || 0,
            error: d.error || null,
            processedAt: d.processedAt
        }))
    };
}


// ============================================
// Qualification Criteria – Document Generation
// ============================================

// In-memory state for last generated qualification doc
if (!appState.lastQualificationDoc) {
    appState.lastQualificationDoc = null; // { markdown, htmlPreview, docxBuffer, fileName }
}

// Initialize qualification prompt from persistent storage
if (!appState.qualificationPrompt) {
    appState.qualificationPrompt = credentialManager.loadAppData('qualificationPrompt') || '';
}

// Get / save qualification prompt (settings)
ipcMain.handle('settings:getQualPrompt', async () => {
    return appState.qualificationPrompt || '';
});

ipcMain.handle('settings:saveQualPrompt', async (event, prompt) => {
    appState.qualificationPrompt = prompt || '';
    credentialManager.saveAppData('qualificationPrompt', prompt || '');
    auditLogger.log('ADMIN', 'QUAL_PROMPT_UPDATED', { promptLength: prompt?.length || 0 });
    return { success: true };
});

// ============================================
// Smart Context Builder
// ============================================

/**
 * Stopwords list for keyword extraction — common English words that carry
 * no retrieval signal. Kept small to avoid accidentally removing domain
 * terms that happen to be common (e.g. "market", "growth" are NOT here).
 */
const STOPWORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'by','from','is','it','as','be','was','are','been','being','have','has',
    'had','do','does','did','will','would','shall','should','may','might',
    'can','could','this','that','these','those','not','no','nor','so',
    'if','then','than','too','very','just','about','also','which','what',
    'who','whom','when','where','how','all','each','every','both','few',
    'more','most','other','some','such','only','own','same','into','over',
    'such','up','out','its','your','our','their','my','we','you','they',
    'he','she','him','her','his','them','me','us','i','using','produce',
    'write','document','content','following','must','provide','include',
    'based','use','make','generate','create','please','ensure','above',
    'below'
]);

/**
 * Extract meaningful keywords from a prompt string.
 * Returns an array of lowercase terms, longest first (multi-word phrases
 * score higher matches than single words).
 */
function extractPromptKeywords(prompt, clientName, industry, geography) {
    if (!prompt) return [];

    // 1. Remove markdown/formatting noise
    const clean = prompt
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\*\*|__|##|#+/g, ' ')
        .replace(/\{\{[^}]+\}\}/g, ' ')   // template vars
        .replace(/[|<>\\\/\-]{2,}/g, ' ')  // table dividers, HTML-ish
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[^a-zA-Z0-9\s'-]/g, ' ');

    // 2. Extract multi-word phrases (bigrams/trigrams from headings & key phrases)
    const phrases = [];
    const headingMatches = prompt.match(/(?:^|\n)#+\s+(.+)/g) || [];
    for (const h of headingMatches) {
        const headingText = h.replace(/^#+\s*/, '').trim().toLowerCase();
        if (headingText.length > 3 && headingText.length < 80) phrases.push(headingText);
    }
    // Bold phrases
    const boldMatches = prompt.match(/\*\*([^*]+)\*\*/g) || [];
    for (const b of boldMatches) {
        const text = b.replace(/\*\*/g, '').trim().toLowerCase();
        if (text.length > 3 && text.length < 60) phrases.push(text);
    }

    // 3. Single-word keywords
    const words = clean.toLowerCase().split(/\s+/)
        .filter(w => w.length > 3 && !STOPWORDS.has(w))
        .filter(w => !/^\d+$/.test(w));

    // 4. Count word frequency — higher freq = more important to the prompt
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;

    // 5. Add client/industry/geography as high-priority terms
    const boostTerms = [];
    if (clientName) boostTerms.push(...clientName.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    if (industry)   boostTerms.push(...industry.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    if (geography)  boostTerms.push(...geography.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    for (const t of boostTerms) freq[t] = (freq[t] || 0) + 5; // heavy boost

    // 6. Sort by freq descending, then return top N single words + all phrases
    const sortedWords = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 60)
        .map(e => e[0]);

    return { singleTerms: sortedWords, phrases };
}

/**
 * Score a chunk against extracted keywords.
 * Returns a numeric relevance score (higher = more relevant).
 * Phrase matches count 3x to reward topical coherence.
 */
function scoreChunk(chunk, keywords) {
    const lower = chunk.content.toLowerCase();
    let score = 0;

    // Single-term matches (each occurrence adds 1)
    for (const term of keywords.singleTerms) {
        // Use indexOf loop instead of regex for speed on large text
        let pos = 0;
        while ((pos = lower.indexOf(term, pos)) !== -1) {
            score += 1;
            pos += term.length;
        }
    }

    // Phrase matches (3x multiplier — topical coherence signal)
    for (const phrase of keywords.phrases) {
        let pos = 0;
        while ((pos = lower.indexOf(phrase, pos)) !== -1) {
            score += 3;
            pos += phrase.length;
        }
    }

    // Structural bonus: chunks with headings/entities/numbers are richer
    const struct = chunk.structure || {};
    if (struct.headings?.length > 0) score += 2;
    if (struct.numbers?.length > 0)  score += 1;
    if (struct.entities?.length > 0) score += 1;

    return score;
}

/**
 * Build smart context for a generation step.
 *
 * @param {object} options
 * @param {string} options.stepName           - 'qualification' | 'valueCase' | 'provoke'
 * @param {string} options.userPrompt         - The user-configurable prompt for this step
 * @param {string} options.clientName
 * @param {string} options.industry
 * @param {string} options.geography
 * @param {object[]} [options.priorOutputs]   - Array of { label, markdown } from earlier steps
 * @param {number} [options.maxContextChars]  - Total char budget (default 100000 = ~25k tokens)
 * @returns {object} { contextStr, includedChunks, totalChunks, stats }
 */
function buildSmartContext(options) {
    const {
        stepName,
        userPrompt,
        clientName,
        industry,
        geography,
        priorOutputs = [],
        maxContextChars = 100000
    } = options;

    // ── 1. Reserve space for prior-step outputs (LAYER 1 — highest priority) ──
    // These are passed as full markdown, NOT re-chunked. They provide the
    // analytical backbone that later steps should build on.
    let layer1 = '';
    let layer1Budget = 0;
    const LAYER1_BUDGET_FRACTION = 0.35; // max 35% of total budget for prior outputs

    if (priorOutputs.length > 0) {
        const maxLayer1 = Math.floor(maxContextChars * LAYER1_BUDGET_FRACTION);
        for (const prior of priorOutputs) {
            if (!prior.markdown) continue;
            const section = `\n\n========== PRIOR ANALYSIS: ${prior.label} ==========\n\n${prior.markdown}\n`;
            if (layer1.length + section.length <= maxLayer1) {
                layer1 += section;
            } else {
                // Truncate last one to fit
                const remaining = maxLayer1 - layer1.length;
                if (remaining > 500) {
                    layer1 += `\n\n========== PRIOR ANALYSIS: ${prior.label} (truncated) ==========\n\n${prior.markdown.slice(0, remaining - 100)}\n\n[... truncated for context budget ...]\n`;
                }
            }
        }
        layer1Budget = layer1.length;
    }

    // ── 2. Collect source-document chunks only (exclude auto-chunked outputs) ──
    const sourceChunks = [];
    if (appState.supportingDocsCorpus) {
        for (const doc of appState.supportingDocsCorpus.documents) {
            if (doc.error) continue;
            // Skip auto-generated documents (qualification, value case, provoke)
            // They start with these prefixes when auto-chunked
            const isAutoDoc = /^(Qualification_|ValueCase_|Provocation_)/i.test(doc.sourceName);
            if (isAutoDoc) continue;
            for (const chunk of (doc.chunks || [])) {
                sourceChunks.push(chunk);
            }
        }
    }

    if (sourceChunks.length === 0 && layer1.length === 0) {
        return { contextStr: '', includedChunks: 0, totalChunks: 0, stats: { layer1Chars: 0, layer2Chars: 0, layer3Chars: 0 } };
    }

    // ── 3. Score and rank source chunks by relevance ──
    const keywords = extractPromptKeywords(userPrompt, clientName, industry, geography);

    const scored = sourceChunks.map(chunk => ({
        chunk,
        score: scoreChunk(chunk, keywords)
    }));

    // Sort by score descending, then by original order (chunkIndex) as tiebreaker
    scored.sort((a, b) => b.score - a.score || a.chunk.chunkIndex - b.chunk.chunkIndex);

    // ── 4. Fill Layer 2 (high-relevance) and Layer 3 (remaining) ──
    const layer2Budget = maxContextChars - layer1Budget;
    let layer2 = '';
    let layer2Count = 0;
    let layer3 = '';
    let layer3Count = 0;
    const usedChunkIds = new Set(); // dedup (overlap chunks may share content)

    // Tier split: top 60% of budget for high-scoring chunks, rest for coverage
    const TIER1_FRACTION = 0.60;
    const tier1Budget = Math.floor(layer2Budget * TIER1_FRACTION);
    const tier2Budget = layer2Budget - tier1Budget;

    // LAYER 2 — High-relevance chunks (by score)
    for (const { chunk, score } of scored) {
        if (score === 0) break; // no point including zero-relevance chunks in Layer 2
        if (usedChunkIds.has(chunk.id)) continue;

        const entry = `\n--- [${chunk.sourceName} | ${chunk.anchor} | relevance:${score}] ---\n${chunk.content}\n`;
        if (layer2.length + entry.length > tier1Budget) continue; // skip, try smaller chunks
        layer2 += entry;
        layer2Count++;
        usedChunkIds.add(chunk.id);
    }

    // LAYER 3 — Coverage chunks (fill remaining budget with unseen chunks, original order)
    // This ensures we don't miss important info that keyword scoring might underweight
    const unseenChunks = sourceChunks
        .filter(c => !usedChunkIds.has(c.id))
        .sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.chunkIndex - b.chunkIndex);

    for (const chunk of unseenChunks) {
        const entry = `\n--- [${chunk.sourceName} | ${chunk.anchor}] ---\n${chunk.content}\n`;
        if (layer3.length + entry.length > tier2Budget) break;
        layer3 += entry;
        layer3Count++;
        usedChunkIds.add(chunk.id);
    }

    // ── 5. Assemble final context ──
    let contextStr = '';
    const totalSourceDocs = appState.supportingDocsCorpus?.totalDocuments || 0;
    const totalIncluded = layer2Count + layer3Count;

    if (layer1) {
        contextStr += `\n## Prior Step Analysis\nThe following sections are the outputs from earlier workflow steps. Use them as your analytical foundation — do not contradict their findings without explicit justification.\n${layer1}\n`;
    }

    if (layer2 || layer3) {
        contextStr += `\n## Source Document Evidence\nThe following excerpts are from ${totalSourceDocs} uploaded source documents, ranked by relevance to this step. ${layer2Count} high-relevance chunks + ${layer3Count} coverage chunks.\n`;
        if (layer2) contextStr += layer2;
        if (layer3) contextStr += `\n--- [Lower-relevance coverage chunks follow] ---\n${layer3}`;
    }

    const stats = {
        layer1Chars: layer1Budget,
        layer2Chars: layer2.length,
        layer2Chunks: layer2Count,
        layer3Chars: layer3.length,
        layer3Chunks: layer3Count,
        totalChunks: sourceChunks.length,
        includedChunks: totalIncluded,
        keywordCount: keywords.singleTerms.length + keywords.phrases.length,
        topKeywords: keywords.singleTerms.slice(0, 10)
    };

    console.log(`[SmartContext:${stepName}] Layer1: ${Math.round(layer1Budget/1000)}KB prior outputs | Layer2: ${layer2Count} chunks (${Math.round(layer2.length/1000)}KB) | Layer3: ${layer3Count} chunks (${Math.round(layer3.length/1000)}KB) | Total: ${Math.round(contextStr.length/1000)}KB`);
    emitAiConsoleLog('system', `Smart context: ${totalIncluded}/${sourceChunks.length} source chunks (${layer2Count} relevant + ${layer3Count} coverage)${priorOutputs.length > 0 ? ` + ${priorOutputs.length} prior step output(s)` : ''} = ${Math.round(contextStr.length/1000)}KB`, 'info');

    return { contextStr, includedChunks: totalIncluded, totalChunks: sourceChunks.length, stats };
}


// Generate qualification document
ipcMain.handle('qualification:generate', async (event, { prompt, clientName, industry, geography }) => {
    console.log('[Qualification] Starting generation...');
    emitAiConsoleLog('system', 'Starting qualification document generation...', 'info');

    // 1. Validate
    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }
    if (!appState.supportingDocsCorpus || appState.supportingDocsCorpus.totalChunks === 0) {
        return { success: false, error: 'No supporting documents processed. Go back to Step 3 and process documents first.' };
    }

    // 2. Build smart context — relevance-ranked source doc chunks only (no prior steps for qualification)
    const { contextStr, includedChunks, totalChunks, stats: ctxStats } = buildSmartContext({
        stepName: 'qualification',
        userPrompt: prompt || '',
        clientName,
        industry,
        geography,
        priorOutputs: [],           // qualification is first analytical step — no prior outputs
        maxContextChars: 100000     // ~25k tokens, leaves room for prompt + response
    });

    // 3. Interpolate variables in step-level prompt
    let userPrompt = (prompt || '').trim();
    userPrompt = userPrompt
        .replace(/\{\{client_name\}\}/gi, clientName || 'the client')
        .replace(/\{\{industry\}\}/gi, industry || 'their industry')
        .replace(/\{\{geography\}\}/gi, geography || 'Global')
        .replace(/\{\{chunk_count\}\}/gi, String(includedChunks));

    // 4. Call OpenAI
    const model = openaiCreds.model || 'gpt-5.2';
    const systemMessage = `You are an elite management consultant producing a client qualification assessment document.

ROLE: Produce the document content directly in well-structured Markdown. The system will automatically convert your Markdown into a formatted Word (.docx) file — you must NOT generate code, scripts, instructions, or references to python-docx or any file-creation tools. Just write the document content.

INSTRUCTIONS FOR USING CONTEXT:
- You have been given chunks from ${appState.supportingDocsCorpus.totalDocuments} supporting documents about the client.
- SYNTHESIZE and REASON from the evidence. Connect data points, draw inferences, identify patterns, and form strategic conclusions — do not merely quote or parrot the source text.
- Where data is partial, state what IS known, what can be reasonably inferred, and what remains a gap. Do NOT simply say "Insufficient data" — instead provide your best analytical assessment using whatever signals exist, then note specific gaps.
- Only say "No data available" if there is genuinely zero relevant information across all provided documents.
- Be thorough, specific, and analytical. Use actual figures, percentages, and facts from the documents.

FORMATTING:
- Use clean Markdown: ## for section headings, ### for subsections, **bold** for emphasis, bullet lists, numbered lists.
- Start with a title and executive summary.
- End with a summary/recommendation section.
- DO NOT wrap output in code blocks or fences. DO NOT include \`\`\`markdown or \`\`\`python tags.
- DO NOT provide instructions on how to generate files. Just provide the document content.

CRITICAL TABLE FORMAT FOR FRAMEWORK PROMPTS:
When the user's prompt contains numbered frameworks with diagnostic prompts/questions, you MUST format each framework's prompts as a markdown table. Each framework gets its own table. The table has exactly two columns:
- Column 1 (narrow): The prompt number (e.g., "1", "2", "36.1")
- Column 2 (wide): The question in bold on the first line, then a blank line, then the client-specific answer with bullet points, data, and analysis

Example format for a framework table:
| # | Prompt & Response |
|---|---|
| 1 | **What is the structural growth rate of your economy?** <br><br> The UK economy grew 0.1% in Q3 2025... <br> - GDP growth constrained to 1.1% forecast <br> - Sector productivity gap vs US peers: ~25% <br> - Incremental improvement cannot close a structural gap of this magnitude |
| 2 | **What is the productivity differential?** <br><br> UK retail productivity lags US peers by... <br> - Revenue per employee: £X vs $Y <br> - Operating margin differential: X% vs Y% |

Use <br> for line breaks within table cells. Use <br><br> to separate the question from the answer. Put the question text in **bold**. The answer should include specific data, bullet points (using <br> - format), and analytical reasoning.

This table format is MANDATORY for any section that contains numbered diagnostic prompts or questions. Non-prompt sections (like "The Origination Cascade" or "The Dual Commercial Pathway") should use regular markdown headings, paragraphs, and bullet lists.`;

    const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `# Supporting Document Context\n\nThe following excerpts are from ${appState.supportingDocsCorpus.totalDocuments} uploaded documents (${includedChunks} chunks) for client "${clientName || 'Unknown'}" in the ${industry || 'unspecified'} industry (${geography || 'Global'}).\n\n${contextStr}\n\n---\n\n# Qualification Criteria Assessment\n\nUsing the context above, produce the following document. Write the FULL document content in Markdown — do NOT generate code or scripts.\n\n${userPrompt}` }
    ];

    emitAiConsoleLog('system', `Sending to ${model} (${messages[1].content.length} chars)...`, 'thinking');

    // Send progress events
    mainWindow?.webContents?.send('qualification:progress', { stage: 'generating', pct: 30 });

    let markdown;
    try {
        markdown = await callOpenAI(openaiCreds.apiKey, model, messages, 16000);
    } catch (err) {
        console.error('[Qualification] OpenAI call failed:', err);
        return { success: false, error: `AI generation failed: ${err.message}` };
    }

    if (!markdown) {
        return { success: false, error: 'AI returned an empty response. Try again or adjust the prompt.' };
    }

    // Post-process: strip code fences if the AI wrapped output in them
    markdown = markdown.trim();
    if (markdown.startsWith('```')) {
        markdown = markdown
            .replace(/^```(?:markdown|md|python|javascript|text)?\s*\n?/i, '')
            .replace(/\n?```\s*$/, '')
            .trim();
    }

    emitAiConsoleLog('system', `Received ${markdown.length} chars of qualification content`, 'success');
    mainWindow?.webContents?.send('qualification:progress', { stage: 'building_doc', pct: 70 });

    // 5. Build Word document from markdown
    let docxBuffer;
    try {
        loadHeavyModules();
        docxBuffer = await buildQualificationDocx(markdown, clientName);
    } catch (err) {
        console.error('[Qualification] DOCX build failed:', err);
        return { success: false, error: `Word document creation failed: ${err.message}` };
    }

    mainWindow?.webContents?.send('qualification:progress', { stage: 'chunking', pct: 90 });

    // 6. Auto-chunk the qualification doc and merge into corpus
    try {
        const tmpDir = path.join(app.getPath('temp'), 'rstudiogpt-docs');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const qualMdPath = path.join(tmpDir, `qualification_${Date.now()}.md`);
        fs.writeFileSync(qualMdPath, markdown, 'utf8');

        const qualDoc = await documentChunker.processDocument(qualMdPath, `Qualification_${clientName || 'Client'}.md`, {});
        
        // Add to corpus
        if (appState.supportingDocsCorpus) {
            appState.supportingDocsCorpus.documents.push(qualDoc);
            appState.supportingDocsCorpus.totalChunks += qualDoc.chunks.length;
            appState.supportingDocsCorpus.totalDocuments += 1;
            appState.supportingDocsCorpus.successfulDocuments += 1;
        }
        emitAiConsoleLog('system', `Qualification doc chunked (${qualDoc.chunks.length} chunks) and added to corpus`, 'success');
    } catch (err) {
        console.warn('[Qualification] Auto-chunking failed (non-fatal):', err.message);
    }

    // 7. Store result
    const sanitized = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${sanitized}_Qualification_${ts}.docx`;

    appState.lastQualificationDoc = {
        markdown,
        docxBuffer: Buffer.from(docxBuffer),
        fileName
    };

    mainWindow?.webContents?.send('qualification:progress', { stage: 'done', pct: 100 });

    auditLogger.log('QUALIFICATION', 'DOC_GENERATED', {
        clientName,
        markdownLength: markdown.length,
        docxSize: docxBuffer.length,
        chunksUsed: includedChunks
    });

    return {
        success: true,
        markdown,
        fileName,
        corpusSummary: getSafeCorpusSummary()
    };
});

// Download the generated qualification docx
ipcMain.handle('qualification:download', async () => {
    if (!appState.lastQualificationDoc) {
        return { success: false, error: 'No qualification document to download' };
    }

    // Lazy-rebuild docx if only markdown is available (e.g. restored from history)
    if (!appState.lastQualificationDoc.docxBuffer && appState.lastQualificationDoc.markdown) {
        try {
            loadHeavyModules();
            const buf = await buildQualificationDocx(appState.lastQualificationDoc.markdown, 'Client', {});
            appState.lastQualificationDoc.docxBuffer = Buffer.from(buf);
        } catch (err) {
            return { success: false, error: 'Failed to rebuild document: ' + err.message };
        }
    }

    if (!appState.lastQualificationDoc.docxBuffer) {
        return { success: false, error: 'No qualification document to download' };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: appState.lastQualificationDoc.fileName,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
    });

    if (result.canceled) return { success: false, canceled: true };

    try {
        fs.writeFileSync(result.filePath, appState.lastQualificationDoc.docxBuffer);
        emitAiConsoleLog('system', `Qualification doc saved: ${path.basename(result.filePath)}`, 'success');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ============================================
// Step 5: Value Case
// ============================================

// Initialize value case prompt from persistent storage
if (!appState.valueCasePrompt) {
    appState.valueCasePrompt = credentialManager.loadAppData('valueCasePrompt') || '';
}

// Initialise value case document store
if (!appState.lastValueCaseDoc) {
    appState.lastValueCaseDoc = null; // { markdown, docxBuffer, fileName }
}

// Get / save value case prompt (settings)
ipcMain.handle('settings:getValueCasePrompt', async () => {
    return appState.valueCasePrompt || '';
});

ipcMain.handle('settings:saveValueCasePrompt', async (event, prompt) => {
    appState.valueCasePrompt = prompt || '';
    credentialManager.saveAppData('valueCasePrompt', prompt || '');
    auditLogger.log('ADMIN', 'VALUE_CASE_PROMPT_UPDATED', { promptLength: prompt?.length || 0 });
    return { success: true };
});

// Generate value case document
ipcMain.handle('valueCase:generate', async (event, { prompt, clientName, industry, geography }) => {
    console.log('[ValueCase] Starting generation...');
    emitAiConsoleLog('system', 'Starting value case document generation...', 'info');

    // 1. Validate
    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }
    if (!appState.supportingDocsCorpus || appState.supportingDocsCorpus.totalChunks === 0) {
        return { success: false, error: 'No supporting documents processed. Go back to Step 3 and process documents first.' };
    }

    // 2. Build smart context — qualification as prior output + relevance-ranked source docs
    const qualMarkdown = appState.lastQualificationDoc?.markdown || '';
    const priorOutputs = qualMarkdown ? [{ label: 'Qualification Assessment', markdown: qualMarkdown }] : [];

    const { contextStr, includedChunks, totalChunks, stats: ctxStats } = buildSmartContext({
        stepName: 'valueCase',
        userPrompt: prompt || '',
        clientName,
        industry,
        geography,
        priorOutputs,
        maxContextChars: 120000
    });

    // 3. Interpolate variables
    let userPrompt = (prompt || '').trim();
    userPrompt = userPrompt
        .replace(/\{\{client_name\}\}/gi, clientName || 'the client')
        .replace(/\{\{industry\}\}/gi, industry || 'their industry')
        .replace(/\{\{geography\}\}/gi, geography || 'Global')
        .replace(/\{\{chunk_count\}\}/gi, String(includedChunks));

    // 4. Call OpenAI
    const model = openaiCreds.model || 'gpt-5.2';
    const systemMessage = `You are an elite strategy consultant producing a comprehensive Value Case document for a client engagement.

ROLE: Produce the document content directly in well-structured Markdown. The system will automatically convert your Markdown into a formatted Word (.docx) file — you must NOT generate code, scripts, instructions, or references to python-docx or any file-creation tools. Just write the document content.

INSTRUCTIONS FOR USING CONTEXT:
- You have been given chunks from supporting documents AND potentially a qualification assessment about the client.
- SYNTHESIZE and REASON from the evidence. Connect data points, draw inferences, identify patterns, and form strategic conclusions.
- Every claim must be specific to the client: use sector economics, geography, competitive set, regulatory context, operating model realities.
- If a fact is unknown, state a reasonable assumption explicitly and label it "Assumption".
- Use evidence where possible — reference public, reputable sources (annual reports, investor presentations, ONS/OECD/IMF, sector benchmarks).
- Where data is partial, state what IS known, what can be reasonably inferred, and what remains a gap. Do NOT simply say "Insufficient data".
- Be thorough, specific, and analytical. Use actual figures, percentages, and facts from the documents.
- Tone: boardroom-credible, evidence-based, compelling, CFO-literate.

FORMAT REQUIREMENTS — THIS IS CRITICAL:
Your output is Markdown that will be automatically converted into a formatted Word (.docx) document.
The system handles all document creation — you must NOT generate code, scripts, python-docx instructions, or technical implementation details.

You MUST use these Markdown conventions precisely:
- # for main title (use once)
- ## for major section headings
- ### for subsection headings
- #### for sub-subsection headings
- **bold text** for emphasis, key terms, metrics, and labels
- *italic text* for supporting commentary
- Bullet points using - for lists
- Numbered lists using 1. 2. 3. format
- DO NOT wrap output in code blocks or fences. DO NOT include \`\`\`markdown or \`\`\`python tags.
- DO NOT provide instructions on how to generate files. Just provide the document content.

TABLE FORMATTING — MANDATORY:
Whenever you present structured data, you MUST use Markdown tables. This includes:
- Financial projections, ROI analysis, cost-benefit breakdowns
- Comparisons (e.g., current state vs future state)
- KPIs, metrics, or benchmarks
- Risk assessments and scoring matrices
- Any side-by-side or multi-attribute analysis

Every table MUST have the header row and separator row (|---|---|).
Use <br> for line breaks within table cells.

DOCUMENT STRUCTURE:
The user will provide their specific prompt structure. Follow it precisely. The output should be a complete, narrative value case document that reads as a cohesive business case — not just a list of answers. Sections should flow as prose with appropriate headings, subheadings, tables, and bullet lists.

Include a "Sources Consulted" section at the end as a bullet list.`;

    const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `# Supporting Document Context\n\nThe following excerpts are from ${appState.supportingDocsCorpus?.totalDocuments || 0} uploaded documents (${includedChunks} chunks) for client "${clientName || 'Unknown'}" in the ${industry || 'unspecified'} industry (${geography || 'Global'}).\n\n${contextStr}\n\n---\n\n# Value Case Document\n\nUsing the context above, produce the following value case document for ${clientName || 'the client'}. Write the FULL document content in Markdown — do NOT generate code or scripts.\n\n${userPrompt}` }
    ];

    emitAiConsoleLog('system', `Sending to ${model} (${messages[1].content.length} chars)...`, 'thinking');
    mainWindow?.webContents?.send('valueCase:progress', { stage: 'generating', pct: 30 });

    let markdown;
    try {
        markdown = await callOpenAI(openaiCreds.apiKey, model, messages, 16000);
    } catch (err) {
        console.error('[ValueCase] OpenAI call failed:', err);
        return { success: false, error: `AI generation failed: ${err.message}` };
    }

    if (!markdown) {
        return { success: false, error: 'AI returned an empty response. Try again or adjust the prompt.' };
    }

    // Post-process: strip code fences if the AI wrapped output in them
    markdown = markdown.trim();
    if (markdown.startsWith('```')) {
        markdown = markdown
            .replace(/^```(?:markdown|md|python|javascript|text)?\s*\n?/i, '')
            .replace(/\n?```\s*$/, '')
            .trim();
    }

    emitAiConsoleLog('system', `Received ${markdown.length} chars of value case content`, 'success');
    mainWindow?.webContents?.send('valueCase:progress', { stage: 'building_doc', pct: 70 });

    // 5. Build Word document (reuse the same builder)
    let docxBuffer;
    try {
        loadHeavyModules();
        docxBuffer = await buildQualificationDocx(markdown, clientName, { pageBreakOnSections: true });
    } catch (err) {
        console.error('[ValueCase] DOCX build failed:', err);
        return { success: false, error: `Word document creation failed: ${err.message}` };
    }

    mainWindow?.webContents?.send('valueCase:progress', { stage: 'chunking', pct: 90 });

    // 6. Auto-chunk the value case doc and merge into corpus (so provoke can use it)
    try {
        const tmpDir = path.join(app.getPath('temp'), 'rstudiogpt-docs');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const vcMdPath = path.join(tmpDir, `valuecase_${Date.now()}.md`);
        fs.writeFileSync(vcMdPath, markdown, 'utf8');

        const vcDoc = await documentChunker.processDocument(vcMdPath, `ValueCase_${clientName || 'Client'}.md`, {});

        if (appState.supportingDocsCorpus) {
            appState.supportingDocsCorpus.documents.push(vcDoc);
            appState.supportingDocsCorpus.totalChunks += vcDoc.chunks.length;
            appState.supportingDocsCorpus.totalDocuments += 1;
            appState.supportingDocsCorpus.successfulDocuments += 1;
        }
        emitAiConsoleLog('system', `Value case doc chunked (${vcDoc.chunks.length} chunks) and added to corpus`, 'success');
    } catch (err) {
        console.warn('[ValueCase] Auto-chunking failed (non-fatal):', err.message);
    }

    // 7. Store result
    const sanitized = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${sanitized}_Value_Case_${ts}.docx`;

    appState.lastValueCaseDoc = {
        markdown,
        docxBuffer: Buffer.from(docxBuffer),
        fileName
    };

    mainWindow?.webContents?.send('valueCase:progress', { stage: 'done', pct: 100 });

    auditLogger.log('VALUE_CASE', 'DOC_GENERATED', {
        clientName,
        markdownLength: markdown.length,
        docxSize: docxBuffer.length,
        chunksUsed: includedChunks
    });

    return {
        success: true,
        markdown,
        fileName,
        corpusSummary: getSafeCorpusSummary()
    };
});

// Download the generated value case docx
ipcMain.handle('valueCase:download', async () => {
    if (!appState.lastValueCaseDoc) {
        return { success: false, error: 'No value case document to download' };
    }

    // Lazy-rebuild docx if only markdown is available (e.g. restored from history)
    if (!appState.lastValueCaseDoc.docxBuffer && appState.lastValueCaseDoc.markdown) {
        try {
            loadHeavyModules();
            const buf = await buildQualificationDocx(appState.lastValueCaseDoc.markdown, 'Client', { pageBreakOnSections: true });
            appState.lastValueCaseDoc.docxBuffer = Buffer.from(buf);
        } catch (err) {
            return { success: false, error: 'Failed to rebuild document: ' + err.message };
        }
    }

    if (!appState.lastValueCaseDoc.docxBuffer) {
        return { success: false, error: 'No value case document to download' };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: appState.lastValueCaseDoc.fileName,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
    });

    if (result.canceled) return { success: false, canceled: true };

    try {
        fs.writeFileSync(result.filePath, appState.lastValueCaseDoc.docxBuffer);
        emitAiConsoleLog('system', `Value case doc saved: ${path.basename(result.filePath)}`, 'success');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Extract and rate assumptions from the value case
ipcMain.handle('valueCase:extractAssumptions', async (event, { clientName }) => {
    console.log('[ValueCase] Extracting assumptions...');
    emitAiConsoleLog('system', 'Analysing value case for assumptions...', 'info');

    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }

    const vcMarkdown = appState.lastValueCaseDoc?.markdown;
    if (!vcMarkdown) {
        return { success: false, error: 'No value case document found. Generate one first.' };
    }

    const model = openaiCreds.model || 'gpt-5.2';

    const systemMessage = `You are a senior strategy analyst reviewing a value case document. Your task is to identify every assumption made in the document and rate each one.

For each assumption, assess:
1. IMPACT: How much does this assumption affect the overall value case conclusions? If this assumption were wrong, how badly would it undermine the business case?
   - Red: Critical impact. If wrong, the value case fundamentally falls apart.
   - Amber: Significant impact. If wrong, key figures or conclusions would need substantial revision.
   - Green: Low impact. If wrong, the value case still broadly holds.

2. CONFIDENCE: How confident should we be that this assumption is correct, given publicly available evidence?
   - Red: Low confidence. No supporting evidence, speculative, or contradicted by known data.
   - Amber: Medium confidence. Some supporting evidence but not verified or could vary significantly.
   - Green: High confidence. Well-supported by public data, industry norms, or stated sources.

RULES:
- Return ONLY a JSON array of assumption objects. No preamble, no markdown, no code fences.
- Each object has: "assumption" (the assumption text, 1-2 sentences), "impact" ("red", "amber", or "green"), "confidence" ("red", "amber", or "green")
- Extract ALL meaningful assumptions — typically 8-15 from a value case. Include financial assumptions, market assumptions, capability assumptions, timeline assumptions, competitive assumptions.
- Be specific. Don't say "Revenue will grow" — say "Revenue growth of 8% CAGR assumed for FY2026-2029 based on historical trend".
- Order by impact: most critical assumptions first.

RESPONSE FORMAT:
[
  {"assumption": "The 25% productivity improvement is achievable within 18 months based on comparable implementations at similar-scale retailers", "impact": "red", "confidence": "amber"},
  {"assumption": "Current IT infrastructure can support the proposed AI workloads without major capital expenditure", "impact": "amber", "confidence": "red"}
]`;

    const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `Extract and rate all assumptions from this value case document for client "${clientName || 'Unknown'}":\n\n${vcMarkdown}` }
    ];

    emitAiConsoleLog('system', `Sending to ${model} for assumptions extraction...`, 'thinking');

    let rawResponse;
    try {
        rawResponse = await callOpenAI(openaiCreds.apiKey, model, messages, 4000);
    } catch (err) {
        console.error('[ValueCase] Assumptions extraction failed:', err);
        return { success: false, error: `AI extraction failed: ${err.message}` };
    }

    if (!rawResponse) {
        return { success: false, error: 'AI returned an empty response.' };
    }

    let assumptions = [];
    try {
        let cleaned = rawResponse.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
        }
        const parsed = JSON.parse(cleaned);
        assumptions = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, 20).map((a, i) => ({
            id: `assumption-${i}`,
            assumption: String(a.assumption || '').slice(0, 500),
            impact: ['red', 'amber', 'green'].includes(a.impact) ? a.impact : 'amber',
            confidence: ['red', 'amber', 'green'].includes(a.confidence) ? a.confidence : 'amber'
        }));
    } catch (parseErr) {
        console.error('[ValueCase] Failed to parse assumptions JSON:', parseErr.message);
        return { success: false, error: 'Failed to parse AI response as structured data.' };
    }

    emitAiConsoleLog('system', `Extracted ${assumptions.length} assumptions from value case`, 'success');

    // Store in app state
    appState.valueCaseAssumptions = assumptions;

    return { success: true, assumptions };
});

// ============================================
// Step 6: Provoke — Origination Engine Document
// ============================================

// Initialize provocation prompt from persistent storage
if (!appState.provocationPrompt) {
    appState.provocationPrompt = credentialManager.loadAppData('provocationPrompt') || '';
}

// Initialise provocation document store
if (!appState.lastProvocationDoc) {
    appState.lastProvocationDoc = null; // { markdown, docxBuffer, fileName }
}

// Get / save provocation prompt (settings)
ipcMain.handle('settings:getProvokePrompt', async () => {
    return appState.provocationPrompt || '';
});

ipcMain.handle('settings:saveProvokePrompt', async (event, prompt) => {
    appState.provocationPrompt = prompt || '';
    credentialManager.saveAppData('provocationPrompt', prompt || '');
    auditLogger.log('ADMIN', 'PROVOKE_PROMPT_UPDATED', { promptLength: prompt?.length || 0 });
    return { success: true };
});

// C-Suite review persona prompts (settings)
const DEFAULT_CSUITE_PROMPTS = {
    ceo: `You are reviewing these documents as the CEO. Focus on: overall strategic vision and alignment, competitive positioning, market opportunity sizing, board-level narrative coherence, whether the story is compelling enough to secure investment and executive commitment. Challenge whether the strategy addresses the most critical existential questions facing the business.`,
    cfo: `You are reviewing these documents as the CFO. Focus on: financial rigour of all claims, ROI projections and payback periods, risk quantification and sensitivity analysis, capital allocation implications, whether the business case would withstand investor and analyst scrutiny. Flag any unsubstantiated financial claims or optimistic projections lacking evidence.`,
    coo: `You are reviewing these documents as the COO. Focus on: operational feasibility of proposed transformations, implementation complexity and timeline realism, change management requirements, resource and capability gaps, supply chain and process implications. Challenge whether the execution plan is realistic given current operational constraints.`,
    cto: `You are reviewing these documents as the CTO. Focus on: technology architecture feasibility, AI/data readiness and maturity assessment, integration complexity with existing systems, technical debt implications, cybersecurity and data governance considerations. Evaluate whether technology claims are grounded in reality versus vendor hype.`,
    cmo: `You are reviewing these documents as the CMO. Focus on: market positioning claims and competitive differentiation, customer insight depth and segmentation quality, brand and reputation implications, go-to-market strategy coherence, digital engagement and customer experience considerations. Challenge whether the market narrative resonates with target audiences.`
};

if (!appState.csuitePrompts) {
    const saved = credentialManager.loadAppData('csuitePrompts');
    appState.csuitePrompts = saved || { ...DEFAULT_CSUITE_PROMPTS };
}

ipcMain.handle('settings:getCsuitePrompts', async () => {
    return appState.csuitePrompts || { ...DEFAULT_CSUITE_PROMPTS };
});

ipcMain.handle('settings:saveCsuitePrompts', async (event, prompts) => {
    appState.csuitePrompts = prompts || {};
    credentialManager.saveAppData('csuitePrompts', prompts || {});
    auditLogger.log('ADMIN', 'CSUITE_PROMPTS_UPDATED', { roles: Object.keys(prompts || {}) });
    return { success: true };
});

// Generate provocation document
ipcMain.handle('provocation:generate', async (event, { prompt, clientName, industry, geography }) => {
    console.log('[Provocation] Starting generation...');
    emitAiConsoleLog('system', 'Starting provocation document generation...', 'info');

    // 1. Validate
    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }

    // 2. Build smart context — qualification + value case as prior outputs, relevance-ranked source docs
    const priorOutputs = [];
    if (appState.lastQualificationDoc?.markdown) {
        priorOutputs.push({ label: 'Qualification Assessment', markdown: appState.lastQualificationDoc.markdown });
    }
    if (appState.lastValueCaseDoc?.markdown) {
        priorOutputs.push({ label: 'Value Case', markdown: appState.lastValueCaseDoc.markdown });
    }

    const { contextStr, includedChunks, totalChunks, stats: ctxStats } = buildSmartContext({
        stepName: 'provoke',
        userPrompt: prompt || '',
        clientName,
        industry,
        geography,
        priorOutputs,
        maxContextChars: 120000
    });

    // 3. Interpolate variables
    let userPrompt = (prompt || '').trim();
    userPrompt = userPrompt
        .replace(/\{\{client_name\}\}/gi, clientName || 'the client')
        .replace(/\{\{industry\}\}/gi, industry || 'their industry')
        .replace(/\{\{geography\}\}/gi, geography || 'Global')
        .replace(/\{\{chunk_count\}\}/gi, String(includedChunks));

    // 4. Call OpenAI
    const model = openaiCreds.model || 'gpt-5.2';
    const systemMessage = `You are an elite strategy and AI origination analyst producing a client-specific version of "The Origination Engine" — a boardroom-credible, slightly provocative, CFO-literate strategic document.

ROLE: Produce the document content directly in well-structured Markdown. The system will automatically convert your Markdown into a formatted Word (.docx) file — you must NOT generate code, scripts, instructions, or references to python-docx or any file-creation tools. Just write the document content.

INSTRUCTIONS FOR USING CONTEXT:
- You have been given chunks from supporting documents AND potentially a qualification assessment from Step 4 and a value case from Step 5 about the client.
- SYNTHESIZE and REASON from the evidence. Connect data points, draw inferences, identify patterns, and form strategic conclusions.
- Every answer must be specific to the client: use sector economics, geography, competitive set, regulatory context, operating model realities.
- If a fact is unknown, state a reasonable assumption explicitly and label it "Assumption".
- Use evidence where possible — reference public, reputable sources (annual reports, investor presentations, ONS/OECD/IMF, sector benchmarks).
- Where data is partial, state what IS known, what can be reasonably inferred, and what remains a gap. Do NOT simply say "Insufficient data".
- Be thorough, specific, and analytical. Use actual figures, percentages, and facts from the documents.
- Tone: boardroom-credible, crisp, slightly provocative, CFO-literate.

FORMAT REQUIREMENTS — THIS IS CRITICAL:
Your output is Markdown that will be automatically converted into a formatted Word (.docx) document.
The system handles all document creation — you must NOT generate code, scripts, python-docx instructions, or technical implementation details.

You MUST use these Markdown conventions precisely:
- # for main title (use once)
- ## for major section headings
- ### for subsection headings
- #### for sub-subsection headings
- **bold text** for emphasis, key terms, metrics, and labels
- *italic text* for supporting commentary
- Bullet points using - for lists
- Numbered lists using 1. 2. 3. format
- DO NOT wrap output in code blocks or fences. DO NOT include \`\`\`markdown or \`\`\`python tags.
- DO NOT provide instructions on how to generate files. Just provide the document content.

TABLE FORMATTING — MANDATORY:
Whenever you present structured data, you MUST use Markdown tables. This includes:
- Diagnostic prompts / questions with answers
- Comparisons (e.g., current state vs future state, Lane 1 vs Lane 2)
- Financial data, metrics, KPIs, or benchmarks
- Assessment matrices, scoring, or RAG ratings
- Any side-by-side or multi-attribute analysis

Every table MUST have the header row and separator row (|---|---|).

CRITICAL TABLE FORMAT FOR FRAMEWORK PROMPTS:
When the user's prompt contains numbered frameworks with diagnostic prompts/questions, you MUST format each framework's prompts as a markdown table. Each framework gets its own table. The table has exactly two columns:
- Column 1 (narrow): The prompt number (e.g., "1", "2", "36.1")
- Column 2 (wide): The question in bold on the first line, then a blank line, then the client-specific answer with bullet points, data, and analysis

Example format for a framework table:
| # | Prompt & Response |
|---|---|
| 1 | **What is the structural growth rate of your economy?** <br><br> The UK economy grew 0.1% in Q3 2025... <br> - GDP growth constrained to 1.1% forecast <br> - Sector productivity gap vs US peers: ~25% <br> - Incremental improvement cannot close a structural gap of this magnitude |
| 2 | **What is the productivity differential?** <br><br> UK retail productivity lags US peers by... <br> - Revenue per employee: £X vs $Y <br> - Operating margin differential: X% vs Y% |

Use <br> for line breaks within table cells. Use <br><br> to separate the question from the answer. Put the question text in **bold**. The answer should include specific data, bullet points (using <br> - format), and analytical reasoning.

This table format is MANDATORY for any section that contains numbered diagnostic prompts or questions. Non-prompt sections (like "The Origination Cascade" or "The Dual Commercial Pathway") should use regular markdown headings, paragraphs, and bullet lists.

DOCUMENT STRUCTURE:
The user will provide their specific prompt structure. Follow it precisely. The output should be a complete, narrative strategic document that reads as a cohesive piece — not just a list of answers. Sections that are not tables should flow as prose with appropriate headings, subheadings, and bullet lists.

If the prompt includes sections like "The Origination Cascade" or "The Dual Commercial Pathway", render those as structured markdown (headings, subheadings, bullet lists, bold labels) — NOT as tables.

Include a "Sources Consulted" section at the end as a bullet list.`;

    const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `# Supporting Document Context\n\nThe following excerpts are from ${appState.supportingDocsCorpus?.totalDocuments || 0} uploaded documents (${includedChunks} chunks) for client "${clientName || 'Unknown'}" in the ${industry || 'unspecified'} industry (${geography || 'Global'}).\n\n${contextStr}\n\n---\n\n# Provocation Document: The Origination Engine\n\nUsing the context above, produce the following document for ${clientName || 'the client'}. Write the FULL document content in Markdown — do NOT generate code or scripts.\n\n${userPrompt}` }
    ];

    emitAiConsoleLog('system', `Sending to ${model} (${messages[1].content.length} chars)...`, 'thinking');
    mainWindow?.webContents?.send('provocation:progress', { stage: 'generating', pct: 30 });

    let markdown;
    try {
        markdown = await callOpenAI(openaiCreds.apiKey, model, messages, 16000);
    } catch (err) {
        console.error('[Provocation] OpenAI call failed:', err);
        return { success: false, error: `AI generation failed: ${err.message}` };
    }

    if (!markdown) {
        return { success: false, error: 'AI returned an empty response. Try again or adjust the prompt.' };
    }

    // Post-process: strip code fences if the AI wrapped output in them
    markdown = markdown.trim();
    if (markdown.startsWith('```')) {
        markdown = markdown
            .replace(/^```(?:markdown|md|python|javascript|text)?\s*\n?/i, '')
            .replace(/\n?```\s*$/, '')
            .trim();
    }

    emitAiConsoleLog('system', `Received ${markdown.length} chars of provocation content`, 'success');
    mainWindow?.webContents?.send('provocation:progress', { stage: 'building_doc', pct: 70 });

    // 5. Build Word document (reuse the same builder)
    let docxBuffer;
    try {
        loadHeavyModules();
        docxBuffer = await buildQualificationDocx(markdown, clientName, { pageBreakOnSections: true });
    } catch (err) {
        console.error('[Provocation] DOCX build failed:', err);
        return { success: false, error: `Word document creation failed: ${err.message}` };
    }

    mainWindow?.webContents?.send('provocation:progress', { stage: 'chunking', pct: 90 });

    // 6. Auto-chunk the provocation doc and merge into corpus
    try {
        const tmpDir = path.join(app.getPath('temp'), 'rstudiogpt-docs');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const provMdPath = path.join(tmpDir, `provocation_${Date.now()}.md`);
        fs.writeFileSync(provMdPath, markdown, 'utf8');

        const provDoc = await documentChunker.processDocument(provMdPath, `Provocation_${clientName || 'Client'}.md`, {});

        if (appState.supportingDocsCorpus) {
            appState.supportingDocsCorpus.documents.push(provDoc);
            appState.supportingDocsCorpus.totalChunks += provDoc.chunks.length;
            appState.supportingDocsCorpus.totalDocuments += 1;
            appState.supportingDocsCorpus.successfulDocuments += 1;
        }
        emitAiConsoleLog('system', `Provocation doc chunked (${provDoc.chunks.length} chunks) and added to corpus`, 'success');
    } catch (err) {
        console.warn('[Provocation] Auto-chunking failed (non-fatal):', err.message);
    }

    // 7. Store result
    const sanitized = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${sanitized}_Origination_Engine_${ts}.docx`;

    appState.lastProvocationDoc = {
        markdown,
        docxBuffer: Buffer.from(docxBuffer),
        fileName
    };

    // Save original as version 0
    if (!appState.provokeVersions) appState.provokeVersions = [];
    appState.provokeVersions = [{
        label: 'Original Provoke',
        markdown,
        docxBuffer: Buffer.from(docxBuffer),
        fileName,
        role: null,
        timestamp: Date.now()
    }];

    mainWindow?.webContents?.send('provocation:progress', { stage: 'done', pct: 100 });

    auditLogger.log('PROVOCATION', 'DOC_GENERATED', {
        clientName,
        markdownLength: markdown.length,
        docxSize: docxBuffer.length,
        chunksUsed: includedChunks
    });

    return {
        success: true,
        markdown,
        fileName,
        corpusSummary: getSafeCorpusSummary()
    };
});

// Download the generated provocation docx
ipcMain.handle('provocation:download', async () => {
    if (!appState.lastProvocationDoc) {
        return { success: false, error: 'No provocation document to download' };
    }

    // Lazy-rebuild docx if only markdown is available (e.g. restored from history)
    if (!appState.lastProvocationDoc.docxBuffer && appState.lastProvocationDoc.markdown) {
        try {
            loadHeavyModules();
            const buf = await buildQualificationDocx(appState.lastProvocationDoc.markdown, 'Client', { pageBreakOnSections: true });
            appState.lastProvocationDoc.docxBuffer = Buffer.from(buf);
        } catch (err) {
            return { success: false, error: 'Failed to rebuild document: ' + err.message };
        }
    }

    if (!appState.lastProvocationDoc.docxBuffer) {
        return { success: false, error: 'No provocation document to download' };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: appState.lastProvocationDoc.fileName,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
    });

    if (result.canceled) return { success: false, canceled: true };

    try {
        fs.writeFileSync(result.filePath, appState.lastProvocationDoc.docxBuffer);
        emitAiConsoleLog('system', `Provocation doc saved: ${path.basename(result.filePath)}`, 'success');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Download a specific provoke version by index
ipcMain.handle('provocation:downloadVersion', async (event, { versionIndex }) => {
    if (!appState.provokeVersions || !appState.provokeVersions[versionIndex]) {
        return { success: false, error: 'Version not found' };
    }

    const version = appState.provokeVersions[versionIndex];
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: version.fileName,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
    });

    if (result.canceled) return { success: false, canceled: true };

    try {
        fs.writeFileSync(result.filePath, version.docxBuffer);
        emitAiConsoleLog('system', `Provoke version saved: ${path.basename(result.filePath)}`, 'success');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Rewrite the provocation based on a review
ipcMain.handle('provocation:rewrite', async (event, { clientName, reviewRole, selectedChanges }) => {
    console.log(`[Provocation] Starting rewrite based on ${reviewRole} review (${(selectedChanges || []).length} selected changes)...`);
    emitAiConsoleLog('system', `Rewriting provoke — applying ${(selectedChanges || []).length} ${reviewRole.toUpperCase()} edits...`, 'info');

    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }

    const originalProvoke = appState.lastProvocationDoc?.markdown;

    if (!originalProvoke) {
        return { success: false, error: 'No provocation document found. Generate one first (Step 6).' };
    }
    if (!selectedChanges || selectedChanges.length === 0) {
        return { success: false, error: 'No changes selected. Select at least one change from the review checklist.' };
    }

    const model = openaiCreds.model || 'gpt-5.2';
    const roleLabel = reviewRole.toUpperCase();

    // Build a numbered list of editorial instructions
    const changesText = selectedChanges.map((c, i) =>
        `${i + 1}. INSTRUCTION: "${c.title}"\n   DETAIL: ${c.detail}`
    ).join('\n\n');

    const systemPrompt = `You are an expert strategic consulting document editor. Your task is to apply a specific set of editorial changes to a provocation/origination narrative document.

CRITICAL INSTRUCTIONS:
1. Read the ORIGINAL PROVOKE DOCUMENT carefully.
2. Read the EDITORIAL INSTRUCTIONS listed below. Each one describes a change the user wants made to the document. They were selected from a ${roleLabel} review.
3. Each change has a TITLE and a DETAIL. These are INSTRUCTIONS telling you what to do — they are NOT text to copy into the document. For example, if a change says "Replace vague AI claim with auditable waterfall", you must find the relevant passage, remove or rewrite it, and produce a proper auditable value waterfall in its place. You must NEVER paste the instruction title or detail text literally into the output.
4. Apply ONLY the listed changes — do not make other modifications, even if you notice other issues.
5. For each instruction, use your expert editorial judgement to carry it out. If the instruction says to replace something, write new high-quality content that fulfils the intent. If it says to add or restructure something, do so with original professional prose that fits the document's voice.
6. MAINTAIN the same overall structure, section organization, formatting conventions (headers, bullet points, tables), and professional tone as the original.
7. The output must be a COMPLETE document — not a diff or partial edit. Reproduce the full narrative with the changes integrated seamlessly.
8. Use Markdown formatting. Preserve all table structures using proper Markdown table syntax.
9. Do NOT add meta-commentary about what you changed. Do NOT add a changelog or summary of edits. Do NOT echo the instruction titles anywhere. Just output the improved document.`;

    const userMessage = `ORIGINAL PROVOKE DOCUMENT:

${originalProvoke}

---

EDITORIAL INSTRUCTIONS TO APPLY (${selectedChanges.length} edits from ${roleLabel} review):

${changesText}

---

REMINDER: The items above are editorial INSTRUCTIONS — descriptions of changes to make. Do NOT paste the instruction text into the document. Instead, interpret each instruction and write new, original content that fulfils it. Produce the full provoke document with all ${selectedChanges.length} instructions applied. Output ONLY the document content in Markdown.`;

    mainWindow?.webContents?.send('review:progress', { stage: 'rewriting', pct: 15 });

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ];

    emitAiConsoleLog('system', `Sending to ${model} for provoke rewrite (${userMessage.length} chars)...`, 'thinking');

    let markdown;
    try {
        markdown = await callOpenAI(openaiCreds.apiKey, model, messages, 16000);
    } catch (err) {
        console.error('[Provocation] Rewrite AI call failed:', err);
        return { success: false, error: `AI rewrite failed: ${err.message}` };
    }

    if (!markdown) {
        return { success: false, error: 'AI returned an empty response during rewrite. Try again.' };
    }

    // Strip code fences
    markdown = markdown.trim();
    if (markdown.startsWith('```')) {
        markdown = markdown
            .replace(/^```(?:markdown|md|python|javascript|text)?\s*\n?/i, '')
            .replace(/\n?```\s*$/, '')
            .trim();
    }

    emitAiConsoleLog('system', `Received ${markdown.length} chars of rewritten provoke content`, 'success');
    mainWindow?.webContents?.send('review:progress', { stage: 'building_rewrite', pct: 70 });

    // Build Word document
    let docxBuffer;
    try {
        loadHeavyModules();
        docxBuffer = await buildQualificationDocx(markdown, clientName, { pageBreakOnSections: true });
    } catch (err) {
        console.error('[Provocation] DOCX build on rewrite failed:', err);
        return { success: false, error: `Word document creation failed: ${err.message}` };
    }

    // Store as a new version (do NOT overwrite original)
    const sanitized = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const versionNum = (appState.provokeVersions || []).length + 1;
    const fileName = `${sanitized}_Narrative_Provoke_${roleLabel}_Edits_${ts}.docx`;

    if (!appState.provokeVersions) appState.provokeVersions = [];
    appState.provokeVersions.push({
        label: `Narrative Provoke ${roleLabel} Edits`,
        markdown,
        docxBuffer: Buffer.from(docxBuffer),
        fileName,
        role: reviewRole,
        timestamp: Date.now()
    });

    mainWindow?.webContents?.send('review:progress', { stage: 'done', pct: 100 });

    auditLogger.log('PROVOCATION', 'DOC_REWRITTEN', {
        clientName,
        reviewRole,
        versionNum,
        markdownLength: markdown.length,
        docxSize: docxBuffer.length
    });

    return {
        success: true,
        markdown,
        fileName,
        versionNum
    };
});

// ============================================
// Step 7: Review — Consistency & Accuracy Check
// ============================================

if (!appState.lastReviewDoc) {
    appState.lastReviewDoc = null; // { markdown, docxBuffer, fileName }
}

// Get list of generated assets
ipcMain.handle('review:getAssets', async () => {
    // Estimate docx size from markdown when buffer isn't loaded yet (history restore)
    const docSize = (doc) => doc.docxBuffer?.length || (doc.markdown ? Math.round(doc.markdown.length * 2.5) : 0);

    const assets = [];
    if (appState.lastQualificationDoc) {
        assets.push({
            type: 'qualification',
            label: 'Qualification Assessment',
            fileName: appState.lastQualificationDoc.fileName,
            size: docSize(appState.lastQualificationDoc),
            hasMarkdown: !!appState.lastQualificationDoc.markdown
        });
    }
    if (appState.lastValueCaseDoc) {
        assets.push({
            type: 'valueCase',
            label: 'Value Case',
            fileName: appState.lastValueCaseDoc.fileName,
            size: docSize(appState.lastValueCaseDoc),
            hasMarkdown: !!appState.lastValueCaseDoc.markdown
        });
    }
    if (appState.lastProvocationDoc) {
        assets.push({
            type: 'provocation',
            label: 'Origination Engine (Provoke)',
            fileName: appState.lastProvocationDoc.fileName,
            size: docSize(appState.lastProvocationDoc),
            hasMarkdown: !!appState.lastProvocationDoc.markdown
        });
    }
    // Add rewritten provoke versions (skip index 0 which is the original)
    if (appState.provokeVersions && appState.provokeVersions.length > 1) {
        for (let i = 1; i < appState.provokeVersions.length; i++) {
            const v = appState.provokeVersions[i];
            assets.push({
                type: 'provocation-rewrite',
                label: v.label,
                fileName: v.fileName,
                size: docSize(v),
                versionIndex: i,
                hasMarkdown: !!v.markdown
            });
        }
    }
    // Reviews are now checklists of changes — no downloadable doc.
    // The rewritten provoke versions above are the downloadable outputs.

    return assets;
});

// Generate the review document
ipcMain.handle('review:generate', async (event, { clientName, role, rolePrompt }) => {
    const roleLabel = (role || 'analyst').toUpperCase();
    console.log(`[Review] Starting ${roleLabel} consistency review...`);
    emitAiConsoleLog('system', `Starting ${roleLabel} consistency & accuracy review...`, 'info');

    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds || !openaiCreds.apiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
    }

    const provokeMarkdown = appState.lastProvocationDoc?.markdown;

    if (!provokeMarkdown) {
        return { success: false, error: 'No provocation document to review. Generate the Origination Engine document (Step 6) first.' };
    }

    // Build the review input — provocation only
    const documentsContext = `\n\n========== DOCUMENT: ORIGINATION ENGINE (PROVOKE) ==========\n\n${provokeMarkdown}\n`;

    const model = openaiCreds.model || 'gpt-5.2';

    // Build role persona instruction
    let roleInstruction = '';
    if (rolePrompt && rolePrompt.trim()) {
        roleInstruction = `\n\nC-SUITE PERSONA — ${roleLabel}:\n${rolePrompt.trim()}\nYou MUST adopt this persona throughout your entire review. Frame every finding, recommendation, and assessment through this executive lens. Your review title should reflect this perspective (e.g., "${roleLabel} Review: ...").`;
    }

    const systemMessage = `You are an expert quality assurance analyst reviewing a strategic consulting document for a major professional services firm from the perspective of a C-suite executive.${roleInstruction}

YOUR TASK:
You must produce TWO outputs:

A) CHANGES — Up to 10 SPECIFIC, ACTIONABLE changes to improve the Origination Engine (provocation) document. Each change must be a concrete recommendation — not a vague observation. Focus on changes that would make the biggest impact on document quality, strategic rigour, and boardroom credibility.

B) QUESTIONS — Up to 10 pointed questions that this ${roleLabel} persona would realistically ask the Accenture account lead in a boardroom setting after reading this narrative. These should be tough, direct questions that test the substance behind the claims. They should be specific to the content of this document and reveal gaps, weak logic, or missing evidence.

RULES:
- Return ONLY a JSON object with two arrays: "changes" and "questions". No preamble, no explanation, no markdown.
- Each change object has exactly two fields:
  "title": a short label (5-12 words) summarising the change
  "detail": 1-3 sentences explaining EXACTLY what to change — cite the specific section, data point, or sentence, and state what it should become
- Each question is a plain string — the question itself as the ${roleLabel} would phrase it.
- QUESTION STYLE: Write questions in plain, conversational executive English. Keep them short and blunt. Avoid excessive punctuation, em dashes, semicolons, and parenthetical asides. One question mark per question. No flowery or over-formal language. Think of how a real executive actually talks — direct, slightly impatient, cutting to the point.
- Maximum 10 items in each array. Only include items that genuinely matter — do not pad the lists.
- Order changes by impact (most important first). Order questions by how likely the ${roleLabel} would ask them first.
- Focus areas for changes: factual errors, unsupported claims, missing analysis, strategic gaps, weak arguments, inconsistencies, tone issues.
- Focus areas for questions: ROI substantiation, risk, implementation feasibility, competitive differentiation, timeline credibility, resource commitments, measurement.
- Every item must be specific to THIS document and THIS client. No generic advice or boilerplate questions.

RESPONSE FORMAT (strict JSON, no code fences):
{
  "changes": [
    {"title": "Fix inconsistent revenue figure in Section 3", "detail": "Section 3 cites £12.4B revenue but the executive summary states £11.8B. Use the most recent annual report figure (£12.4B FY2025) consistently throughout."},
    {"title": "Add competitive benchmarking to productivity analysis", "detail": "The productivity gap section (Framework 2) lacks peer comparison. Add Tesco and Walmart productivity metrics (revenue per employee, operating margin) to substantiate the 25% gap claim."}
  ],
  "questions": [
    "Where does the 500M productivity number actually come from",
    "What evidence do you have that AI automation gets us 25% efficiency in our environment given the legacy stack we are running"
  ]
}`;

    const messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `Review this Origination Engine document for client "${clientName || 'Unknown'}" and return your recommended changes and questions as a JSON object with "changes" and "questions" arrays.\n\n${documentsContext}` }
    ];

    emitAiConsoleLog('system', `Sending to ${model} for ${roleLabel} review (${messages[1].content.length} chars)...`, 'thinking');
    mainWindow?.webContents?.send('review:progress', { stage: 'reviewing', pct: 25 });

    let rawResponse;
    try {
        rawResponse = await callOpenAI(openaiCreds.apiKey, model, messages, 4000);
    } catch (err) {
        console.error('[Review] OpenAI call failed:', err);
        return { success: false, error: `AI review failed: ${err.message}` };
    }

    if (!rawResponse) {
        return { success: false, error: 'AI returned an empty response. Try again.' };
    }

    // Parse the JSON response
    let changes = [];
    let questions = [];
    try {
        let cleaned = rawResponse.trim();
        // Strip code fences if AI wrapped the JSON
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
        }
        const parsed = JSON.parse(cleaned);

        // Handle both formats: { changes, questions } or bare array (backwards compat)
        const rawChanges = Array.isArray(parsed) ? parsed : (parsed.changes || []);
        const rawQuestions = Array.isArray(parsed) ? [] : (parsed.questions || []);

        // Validate and cap changes at 10
        changes = rawChanges.slice(0, 10).map((c, i) => ({
            id: `${role}-${i}`,
            title: String(c.title || `Change ${i + 1}`).slice(0, 200),
            detail: String(c.detail || '').slice(0, 1000),
            checked: false
        }));

        // Validate and cap questions at 10
        questions = rawQuestions
            .filter(q => typeof q === 'string' && q.trim().length > 0)
            .slice(0, 10)
            .map((q, i) => ({
                id: `${role}-q${i}`,
                text: String(q).slice(0, 500)
            }));
    } catch (parseErr) {
        console.error('[Review] Failed to parse AI response as JSON:', parseErr.message);
        console.error('[Review] Raw response:', rawResponse.slice(0, 500));
        // Fallback: treat each line as a change
        changes = rawResponse.split('\n')
            .map(l => l.replace(/^[\d\-\.\*]+\s*/, '').trim())
            .filter(l => l.length > 10)
            .slice(0, 10)
            .map((line, i) => ({
                id: `${role}-${i}`,
                title: line.slice(0, 120),
                detail: line,
                checked: false
            }));
    }

    emitAiConsoleLog('system', `${roleLabel} review: ${changes.length} changes, ${questions.length} questions`, 'success');
    mainWindow?.webContents?.send('review:progress', { stage: 'done', pct: 100 });

    // Store result
    appState.lastReviewDoc = {
        changes,
        questions,
        role: role
    };

    // Also store per-role
    if (!appState.reviewsByRole) appState.reviewsByRole = {};
    appState.reviewsByRole[role] = {
        changes,
        questions,
        role,
        label: `${roleLabel} Review`,
        timestamp: Date.now()
    };

    auditLogger.log('REVIEW', 'CHANGES_GENERATED', {
        clientName,
        role: roleLabel,
        changeCount: changes.length,
        questionCount: questions.length
    });

    return {
        success: true,
        changes,
        questions,
        role
    };
});

// Download questions for a specific role as a Word document
ipcMain.handle('review:downloadQuestions', async (event, { role }) => {
    const reviewData = appState.reviewsByRole?.[role];
    if (!reviewData || !reviewData.questions || reviewData.questions.length === 0) {
        return { success: false, error: `No questions found for role: ${role}` };
    }

    const roleLabel = (role || 'analyst').toUpperCase();
    const questions = reviewData.questions;

    try {
        loadHeavyModules();

        const FONT_HEADING = 'Arial';
        const FONT_BODY = 'Cambria';

        const children = [];

        // Title
        children.push(new Paragraph({
            children: [new TextRun({ text: `Likely ${roleLabel} Questions`, bold: true, size: 32, color: '1F2937', font: { name: FONT_HEADING } })],
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 }
        }));
        children.push(new Paragraph({
            children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, italics: true, color: '6B7280', size: 20, font: { name: FONT_HEADING } })],
            spacing: { after: 400 }
        }));

        // Each question as a numbered paragraph
        questions.forEach((q, i) => {
            const text = typeof q === 'string' ? q : (q.text || '');
            children.push(new Paragraph({
                children: [new TextRun({ text: `${i + 1}. ${text}`, size: 22, font: { name: FONT_BODY } })],
                spacing: { after: 200 }
            }));
        });

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);

        const sanitized = (appState.selectedClient || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const defaultName = `${sanitized}_${roleLabel}_Questions_${ts}.docx`;

        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: [{ name: 'Word Document', extensions: ['docx'] }]
        });

        if (result.canceled) return { success: false, canceled: true };

        fs.writeFileSync(result.filePath, buffer);
        emitAiConsoleLog('system', `${roleLabel} questions saved: ${path.basename(result.filePath)}`, 'success');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        console.error('[Review] Questions DOCX build failed:', err);
        return { success: false, error: err.message };
    }
});

// Build a Word document from markdown content
async function buildQualificationDocx(markdown, clientName, options = {}) {
    const children = [];
    const pageBreakOnSections = options.pageBreakOnSections || false;
    let sectionCount = 0; // track headings so we skip page-break on the very first one

    // Font constants
    const FONT_HEADING = 'Arial';
    const FONT_BODY = 'Cambria';

    // Title
    children.push(new Paragraph({
        children: [new TextRun({ text: `Qualification Assessment: ${clientName || 'Client'}`, bold: true, size: 32, color: '1F2937', font: { name: FONT_HEADING } })],
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 }
    }));
    children.push(new Paragraph({
        children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, italics: true, color: '6B7280', size: 20, font: { name: FONT_HEADING } })],
        spacing: { after: 400 }
    }));

    const lines = markdown.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) {
            children.push(new Paragraph({ text: '' }));
            i++;
            continue;
        }

        // Markdown table detection
        if (trimmed.includes('|') && trimmed.startsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }
            // Parse table
            const tableChildren = parseMarkdownTable(tableLines);
            if (tableChildren) {
                children.push(tableChildren);
                children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
            }
            continue;
        }

        // Headings — Arial bold
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
            sectionCount++;
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed.replace(/^#\s+/, ''), FONT_HEADING, true),
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 },
                pageBreakBefore: pageBreakOnSections && sectionCount > 1
            }));
        } else if (trimmed.startsWith('## ')) {
            sectionCount++;
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed.replace(/^##\s+/, ''), FONT_HEADING, true),
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 360, after: 160 },
                pageBreakBefore: pageBreakOnSections && sectionCount > 1
            }));
        } else if (trimmed.startsWith('### ')) {
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed.replace(/^###\s+/, ''), FONT_HEADING, true),
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 120 }
            }));
        } else if (trimmed.startsWith('#### ')) {
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed.replace(/^####\s+/, ''), FONT_HEADING, true),
                spacing: { before: 240, after: 100 }
            }));
        }
        // Bold label with content (- **Key**: Value)
        else if (trimmed.startsWith('- **') && trimmed.includes('**:')) {
            const match = trimmed.match(/^-\s*\*\*(.+?)\*\*:(.*)$/);
            if (match) {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: '\u2022 ' }),
                        new TextRun({ text: match[1] + ': ', bold: true }),
                        ...parseInlineFormatting(match[2].trim())
                    ],
                    spacing: { after: 80 },
                    indent: { left: 360 }
                }));
            } else {
                children.push(new Paragraph({
                    children: parseInlineFormatting(trimmed),
                    spacing: { after: 80 }
                }));
            }
        }
        // Bullet points
        else if (/^[-*]\s+/.test(trimmed)) {
            const text = trimmed.replace(/^[-*]\s+/, '');
            children.push(new Paragraph({
                children: parseInlineFormatting('\u2022 ' + text),
                spacing: { after: 80 },
                indent: { left: 360 }
            }));
        }
        // Numbered list
        else if (/^\d+[\.\)]\s+/.test(trimmed)) {
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed),
                spacing: { after: 80 },
                indent: { left: 360 }
            }));
        }
        // Horizontal rule
        else if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
            children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        }
        // Regular paragraph
        else {
            children.push(new Paragraph({
                children: parseInlineFormatting(trimmed),
                spacing: { after: 100 }
            }));
        }
        i++;
    }

    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: {
                        font: FONT_BODY,
                        size: 22  // 11pt
                    }
                },
                heading1: {
                    run: {
                        font: FONT_HEADING,
                        bold: true,
                        size: 28,
                        color: '1a1a2e'
                    }
                },
                heading2: {
                    run: {
                        font: FONT_HEADING,
                        bold: true,
                        size: 24,
                        color: '2d2d44'
                    }
                },
                title: {
                    run: {
                        font: FONT_HEADING,
                        bold: true,
                        size: 32,
                        color: '1F2937'
                    }
                }
            }
        },
        sections: [{
            properties: {
                page: {
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            children
        }]
    });

    return await Packer.toBuffer(doc);
}

// Parse inline bold/italic in a line into TextRun array
// fontOverride: explicit font name (e.g. 'Arial' for headings)
// forceBold: force all runs bold (for heading lines)
function parseInlineFormatting(text, fontOverride, forceBold) {
    // Pre-clean: strip leading heading markers (## etc.) that leaked into inline text
    let cleaned = text.replace(/^#{1,6}\s+/, '');
    const runs = [];
    const fontOpt = fontOverride ? { name: fontOverride } : undefined;
    const parts = cleaned.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);
    for (const part of parts) {
        if (part.startsWith('**') && part.endsWith('**')) {
            runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: fontOpt }));
        } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            runs.push(new TextRun({ text: part.slice(1, -1), italics: true, bold: forceBold || false, font: fontOpt }));
        } else if (part) {
            // Strip any remaining unpaired ** or * artifacts
            const clean = part.replace(/\*\*/g, '').replace(/(?<![\w])\*(?![\w])/g, '');
            if (clean) runs.push(new TextRun({ text: clean, bold: forceBold || false, font: fontOpt }));
        }
    }
    return runs.length > 0 ? runs : [new TextRun({ text: cleaned.replace(/\*\*/g, '').replace(/\*/g, ''), bold: forceBold || false, font: fontOpt })];
}

// Modern table styling constants
const TABLE_HEADER_BG = '1a1a2e';    // Dark navy header
const TABLE_HEADER_TEXT = 'FFFFFF';   // White header text
const TABLE_ROW_EVEN = 'F8F9FA';     // Light grey alternating row
const TABLE_ROW_ODD = 'FFFFFF';      // White alternating row
const TABLE_BORDER_COLOR = 'DEE2E6'; // Subtle grey border
const TABLE_ACCENT_LEFT = 'A855F7';  // Purple accent (left border on row hover)

function makeTableBorders(color) {
    const border = { style: BorderStyle.SINGLE, size: 1, color: color || TABLE_BORDER_COLOR };
    return {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border
    };
}

// Parse a markdown table into a docx Table
function parseMarkdownTable(tableLines) {
    if (tableLines.length < 2) return null;

    // Parse rows (skip separator line)
    const rows = [];
    for (let r = 0; r < tableLines.length; r++) {
        const line = tableLines[r];
        // Skip separator row (|---|---|) — test the raw line directly;
        // the character class [\s\-:|] only matches pipes/dashes/colons/spaces,
        // so data rows with letters or numbers will NOT match.
        if (/^\|[\s\-:|]+\|$/.test(line)) continue;
        const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim());
        if (cells.length > 0) rows.push(cells);
    }
    if (rows.length < 1) return null;

    const colCount = Math.max(...rows.map(r => r.length));

    // Detect if this is a "# | Prompt & Response" style table (narrow first col)
    const isPromptTable = colCount === 2 && rows.length > 1 &&
        rows.slice(1).every(r => /^\d/.test((r[0] || '').trim()));
    // Column widths: if prompt-table, give col1 ~8% and col2 ~92%
    const colWidths = isPromptTable
        ? [700, 8300]   // 700 + 8300 = 9000 DXA (~6.25 inches)
        : Array(colCount).fill(Math.floor(9000 / colCount));

    try {
        const tableRows = rows.map((row, rowIdx) => {
            const tableCells = [];
            const isHeader = rowIdx === 0;
            const isEvenRow = rowIdx % 2 === 0;
            for (let c = 0; c < colCount; c++) {
                const cellText = row[c] || '';
                // Build cell paragraphs: split on <br> for multi-line cell content
                const cellParagraphs = buildCellParagraphs(cellText, isHeader);

                // Determine cell shading
                let cellShading;
                if (isHeader) {
                    cellShading = { fill: TABLE_HEADER_BG, color: 'auto' };
                } else if (isEvenRow) {
                    cellShading = { fill: TABLE_ROW_EVEN, color: 'auto' };
                }
                // Odd data rows get no shading (white)

                tableCells.push(new TableCell({
                    children: cellParagraphs,
                    width: { size: colWidths[c] || colWidths[0], type: WidthType.DXA },
                    shading: cellShading,
                    verticalAlign: c === 0 && isPromptTable ? 'top' : undefined,
                    margins: {
                        top: 60,
                        bottom: 60,
                        left: 120,
                        right: 120
                    }
                }));
            }
            return new TableRow({ children: tableCells });
        });

        return new Table({
            rows: tableRows,
            width: { size: 9000, type: WidthType.DXA },
            borders: makeTableBorders(TABLE_BORDER_COLOR)
        });
    } catch (e) {
        console.warn('[Qualification] Table parse failed:', e.message);
        return new Paragraph({ text: tableLines.join('\n'), spacing: { after: 100 } });
    }
}

/**
 * Build an array of Paragraph objects for a table cell.
 * Handles <br> line breaks and inline formatting.
 */
function buildCellParagraphs(cellText, isHeader) {
    // Split on <br> tags (with optional whitespace)
    const segments = cellText.split(/<br\s*\/?>\s*/gi);
    const paragraphs = [];
    const cellFont = isHeader ? 'Arial' : 'Cambria';
    const cellTextColor = isHeader ? TABLE_HEADER_TEXT : undefined;
    const cellSize = isHeader ? 19 : 20; // 9.5pt header, 10pt body
    for (const seg of segments) {
        const trimmed = seg.trim();
        if (!trimmed) {
            // Empty segment = blank line (spacing). Add a small spacer.
            paragraphs.push(new Paragraph({ text: '', spacing: { after: 40 } }));
            continue;
        }
        // Detect bullet lines: starts with "- " or "• "
        const isBullet = /^[-•]\s+/.test(trimmed);
        const bulletText = isBullet ? trimmed.replace(/^[-•]\s+/, '') : trimmed;

        let runs;
        if (isHeader) {
            // For header cells: Arial, bold, white text
            runs = [new TextRun({ text: bulletText.replace(/\*\*/g, ''), bold: true, font: { name: cellFont }, color: cellTextColor, size: cellSize })];
        } else {
            // Body cells: Cambria, normal size — use parseInlineFormatting with font override
            runs = parseInlineFormatting(bulletText, cellFont);
        }

        if (isBullet) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: '\u2022 ', font: { name: cellFont }, size: cellSize, color: cellTextColor }), ...runs],
                spacing: { after: 30 },
                indent: { left: 180 }
            }));
        } else {
            paragraphs.push(new Paragraph({
                children: runs,
                spacing: { after: 40 }
            }));
        }
    }
    return paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })];
}


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
        const intelPackContent = await callOpenAI(openaiCreds.apiKey, openaiCreds.model || 'gpt-5.2', [
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
                                new TextRun({ text: 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ' }),
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
                            new TextRun({ text: 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ' + trimmedLine.substring(2) })
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
ipcMain.handle('workshop:generate', async (event, { client, strategicQuestion }) => {
    const requestId = 'workshop_' + Date.now();
    
    console.log('[Workshop] Starting workshop materials generation...');
    
    // Store strategic question for placeholder generation (narrative is NOT used for workshops)
    appState.currentStrategicQuestion = strategicQuestion || '';
    
    if (strategicQuestion) {
        mainWindow.webContents.send('ai-console-log', {
            agent: 'workshop',
            message: `Strategic question provided: "${strategicQuestion.substring(0, 100)}..."`,
            type: 'info'
        });
    }
    
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
                                new TextRun({ text: 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ', size: 22 }),
                                new TextRun({ text: 'Action item 1', size: 22, color: '666666' })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ', size: 22 }),
                                new TextRun({ text: 'Action item 2', size: 22, color: '666666' })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ', size: 22 }),
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
        console.log(`[Workshop] Read ${type} template file: ${filename}, size: ${content.length} bytes`);
        
        const base64Content = content.toString('base64');
        console.log(`[Workshop] Base64 encoded size: ${base64Content.length} chars`);
        
        const template = {
            filename: filename,
            content: base64Content,
            uploadedAt: new Date().toISOString()
        };
        
        appState.workshopTemplates[type] = template;
        console.log(`[Workshop] Template stored in appState for ${type}`);
        console.log(`[Workshop] Template filename: ${template.filename}, content length: ${template.content.length}`);
        
        // Persist to disk IMMEDIATELY (templates are critical, don't debounce)
        credentialManager.saveAppData('workshopTemplates', appState.workshopTemplates);
        credentialManager.flushAppDataImmediate();
        console.log(`[Workshop] Template persisted to disk immediately`);
        
        // Verify it was saved BY READING DIRECTLY FROM DISK (not cache)
        const reloadedFromDisk = credentialManager.loadAppDataFromDisk('workshopTemplates');
        console.log(`[Workshop] DISK VERIFICATION - ${type} template exists:`, !!reloadedFromDisk?.[type]?.content);
        if (reloadedFromDisk?.[type]) {
            console.log(`[Workshop] DISK VERIFICATION - ${type} filename: ${reloadedFromDisk[type].filename}`);
            console.log(`[Workshop] DISK VERIFICATION - ${type} content length: ${reloadedFromDisk[type].content?.length || 0}`);
        } else {
            console.error(`[Workshop] CRITICAL ERROR - Template NOT saved to disk!`);
        }
        
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
    
    // Persist to disk immediately
    credentialManager.saveAppData('workshopTemplates', appState.workshopTemplates);
    credentialManager.flushAppDataImmediate();
    
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
    console.log('[Workshop] Getting templates status...');
    console.log('[Workshop] PPTX template exists:', !!appState.workshopTemplates?.pptx?.content);
    console.log('[Workshop] DOCX template exists:', !!appState.workshopTemplates?.docx?.content);
    
    if (appState.workshopTemplates?.pptx) {
        console.log('[Workshop] PPTX filename:', appState.workshopTemplates.pptx.filename);
        console.log('[Workshop] PPTX content length:', appState.workshopTemplates.pptx.content?.length || 0);
    }
    
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
        considerStrategicQuestion: placeholder.considerStrategicQuestion || false,
        considerStrategy: placeholder.considerStrategy || false,
        research: placeholder.research || false,
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
        considerStrategicQuestion: placeholder.considerStrategicQuestion || false,
        considerStrategy: placeholder.considerStrategy || false,
        research: placeholder.research || false,
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
        'max_chars_body': p.maxCharsBody || '',
        'consider_strategic_question': p.considerStrategicQuestion ? 'TRUE' : 'FALSE',
        'consider_client_strategy': p.considerStrategy ? 'TRUE' : 'FALSE',
        'research': p.research ? 'TRUE' : 'FALSE'
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
        { wch: 15 },  // max_chars_body
        { wch: 25 },  // consider_strategic_question
        { wch: 22 },  // consider_client_strategy
        { wch: 12 }   // research
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
            const considerStrategicQuestionVal = row['consider_strategic_question'] || row['Consider_Strategic_Question'] || row['CONSIDER_STRATEGIC_QUESTION'] || row['consider strategic question'] || row['Consider Strategic Question'];
            const considerStrategyVal = row['consider_client_strategy'] || row['Consider_Client_Strategy'] || row['CONSIDER_CLIENT_STRATEGY'] || row['consider client strategy'] || row['Consider Client Strategy'];
            const researchVal = row['research'] || row['Research'] || row['RESEARCH'];
            
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
            const considerStrategicQuestion = considerStrategicQuestionVal === true || considerStrategicQuestionVal === 'TRUE' || considerStrategicQuestionVal === 'true' || considerStrategicQuestionVal === '1' || considerStrategicQuestionVal === 1;
            const considerStrategy = considerStrategyVal === true || considerStrategyVal === 'TRUE' || considerStrategyVal === 'true' || considerStrategyVal === '1' || considerStrategyVal === 1;
            const research = researchVal === true || researchVal === 'TRUE' || researchVal === 'true' || researchVal === '1' || researchVal === 1;
            
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
                considerStrategicQuestion: considerStrategicQuestion,
                considerStrategy: considerStrategy,
                research: research,
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
        // Note: client_name uses commonName (short/known-as name) for deck output
        // The full official name is kept in client.name for internal tool use
        const builtInData = {
            client_name: client?.commonName || client?.name || 'Client',
            client_full_name: client?.name || 'Client',
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
        let strategyDocumentContent = '';
        
        if (sourcePack?.documents) {
            for (const [filename, content] of Object.entries(sourcePack.documents)) {
                if (typeof content === 'string' && content.length > 0) {
                    sourcePackContent += `\n\n=== ${filename} ===\n${content.substring(0, 5000)}`;
                    
                    // Extract strategy document specifically for considerStrategy flag
                    if (filename.includes('Strategy_Report') || filename.includes('strategy')) {
                        strategyDocumentContent += content;
                    }
                }
            }
            
            // Store strategy content in appState for use by generatePlaceholderContent
            appState.currentStrategyContent = strategyDocumentContent;
            
            mainWindow.webContents.send('ai-console-log', {
                agent: 'workshop',
                message: `Source pack has ${Object.keys(sourcePack.documents).length} documents for AI context${strategyDocumentContent ? ' (strategy document found)' : ''}`,
                type: 'info'
            });
        } else {
            appState.currentStrategyContent = '';
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
                    message: `ÃƒÂ¢Ã…Â¡Ã‚Â  Circular dependency detected for {{${placeholderName}}} - skipping`,
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
                        sourcePackContent,
                        placeholder.considerStrategicQuestion || false,
                        placeholder.considerStrategy || false,
                        placeholder.research || false
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const items = parseListTitleBodyContent(aiContent, placeholder.listCount);
                        listPlaceholderData[placeholderName] = items;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Generated ${items.length} title/body items for {{${placeholderName}}}`,
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
                        sourcePackContent,
                        placeholder.considerStrategicQuestion || false,
                        placeholder.considerStrategy || false,
                        placeholder.research || false
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const items = parseListContent(aiContent, placeholder.listCount);
                        listPlaceholderData[placeholderName] = items;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Generated ${items.length} list items for {{${placeholderName}}}`,
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
                            message: `ÃƒÂ¢Ã…Â¡Ã‚Â  AI error for list {{${placeholderName}}}: ${aiContent}`,
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
                        sourcePackContent,
                        placeholder.considerStrategicQuestion || false,
                        placeholder.considerStrategy || false,
                        placeholder.research || false
                    );
                    
                    if (aiContent && !aiContent.startsWith('[Error:')) {
                        const parsed = parseTitleBodyContent(aiContent);
                        titleBodyPlaceholderData[placeholderName] = parsed;
                        
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Generated title/body for {{${placeholderName}}}`,
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
                        sourcePackContent,
                        placeholder.considerStrategicQuestion || false,
                        placeholder.considerStrategy || false,
                        placeholder.research || false
                    );
                    
                    if (aiContent && aiContent.startsWith('[Error:')) {
                        data[placeholderName] = aiContent;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…Â¡Ã‚Â  AI error for {{${placeholderName}}}: ${aiContent}`,
                            type: 'error'
                        });
                    } else {
                        data[placeholderName] = aiContent || `[No content generated for ${placeholderName}]`;
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Generated ${aiContent?.length || 0} chars for {{${placeholderName}}}`,
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
                                    message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced ${pattern} in ${path.basename(xmlFile)}`,
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
                                    message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced ${pattern} in ${path.basename(xmlFile)}`,
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
                                message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${listName}[${i + 1}]}} in ${path.basename(xmlFile)}`,
                                type: 'success'
                            });
                        }
                        
                        if (content.includes(indexedWithSpace)) {
                            content = content.split(indexedWithSpace).join(safeValue);
                            modified = true;
                            mainWindow.webContents.send('ai-console-log', {
                                agent: 'workshop',
                                message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${listName} [${i + 1}]}} in ${path.basename(xmlFile)}`,
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
                        message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${listName}}} #${itemIndex + 1} with "${previewText}..." in ${path.basename(xmlFile)}`,
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
                        message: `ÃƒÂ¢Ã…Â¡Ã‚Â  Extra {{${listName}}} placeholder - no more items available`,
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
                                message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${listName}[title]}} #${titleIndex + 1} with "${item.title.substring(0, 30)}..." in ${path.basename(xmlFile)}`,
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
                                message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${listName}[body]}} #${bodyIndex + 1} in ${path.basename(xmlFile)}`,
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
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced ${pattern} in ${path.basename(xmlFile)}`,
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
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced ${pattern} in ${path.basename(xmlFile)}`,
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
                        message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${tbName}}} (combined title/body) in ${path.basename(xmlFile)}`,
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
                        message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Replaced {{${key}}} in ${path.basename(xmlFile)}`,
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
async function generatePlaceholderContent(prompt, client, sourcePackContent, considerStrategicQuestion = false, considerStrategy = false, research = false) {
    console.log('[Workshop] generatePlaceholderContent called with prompt:', prompt);
    console.log('[Workshop] considerStrategicQuestion:', considerStrategicQuestion);
    console.log('[Workshop] considerStrategy:', considerStrategy);
    console.log('[Workshop] research:', research);
    
    const openaiCreds = credentialManager.getCredentials('openai');
    if (!openaiCreds?.apiKey) {
        console.log('[Workshop] No OpenAI API key configured');
        return '[Error: OpenAI API key not configured]';
    }
    
    console.log('[Workshop] Using model:', openaiCreds.model || 'gpt-5.2');
    console.log('[Workshop] Source pack content length:', sourcePackContent?.length || 0);
    
    // Get strategic question - only used if placeholder has considerStrategicQuestion flag
    const strategicQuestion = appState.currentStrategicQuestion || '';
    
    // Get strategy document content - only used if placeholder has considerStrategy flag
    const strategyContent = appState.currentStrategyContent || '';
    
    if (considerStrategicQuestion && strategicQuestion) {
        console.log('[Workshop] Strategic question will be considered as a factor for this placeholder');
    }
    
    if (considerStrategy && strategyContent) {
        console.log('[Workshop] Client strategy document will be used as context for this placeholder');
    }
    
    try {
        const systemPrompt = `You are an expert business analyst helping prepare workshop materials. 
Generate content based on the user's prompt, using information from the provided source pack.
Be concise and professional. Format for presentation/document use.

Client: ${client?.name || 'Unknown'}
Industry: ${client?.industry || 'Unknown'}
Geography: ${client?.geography || 'Unknown'}

CRITICAL - DIVERSITY FOR PERSONAS/SCENARIOS:
When generating personas, scenarios, or any content with personal details:

NAMES:
- Use DIVERSE names from different cultural backgrounds (Western, Asian, African, Latin, Middle Eastern, etc.)
- NEVER use similar-sounding names like Mia/Mira/Mara or John/Jon/Johan in the same output
- Vary name lengths and styles (e.g., Priya, Marcus, Yuki, Oluwaseun, Elena, Jin-Ho, Ahmed, Chidera)

AGES:
- Use a WIDE range of ages appropriate to the persona role (22-65 for professionals)
- NEVER repeat the same age - vary by at least 5-10 years between personas
- Include young professionals (22-30), mid-career (31-45), and senior (46-65)
- Avoid defaulting to 34 - use specific varied ages like 27, 38, 52, 41, 29, 56, 33, 48

LOCATIONS:
- Use DIVERSE global cities, not just Berlin or major capitals
- Match locations to the client's actual geographic footprint and markets
- Include tier-2 cities, not just London/NYC/Berlin (e.g., Lyon, Osaka, Austin, Mumbai, Cape Town, SÃƒÆ’Ã‚Â£o Paulo, Melbourne, Rotterdam)
- Vary across regions: Europe, Americas, Asia-Pacific, Middle East, Africa
- NEVER repeat the same city within a set of personas

Match diversity to the client's geography - if global, reflect global diversity.

CRITICAL - USE SPECIFIC DATA FROM SOURCE PACK:
- Extract and USE specific brand names, product names, and service names mentioned in the source pack
- Include specific data points: percentages, market sizes, growth rates, financial figures
- Reference the client's actual strategy, priorities, and initiatives mentioned in the documents
- Mention specific competitors, partners, or customers if referenced in the source pack
- Use real numbers and facts - never make up generic statistics
- If the source pack mentions specific capabilities, technologies, or solutions, name them explicitly`;

        // Limit source pack content to avoid token limits
        const truncatedSourcePack = sourcePackContent ? sourcePackContent.substring(0, 30000) : '';

        // Build strategic context injection - ONLY if placeholder flag is set
        // This is a FACTOR in the output, not the main topic
        let strategicContextInjection = '';
        if (considerStrategicQuestion && strategicQuestion) {
            strategicContextInjection = `
STRATEGIC CONTEXT (consider as a factor, not the main topic):
The workshop is informed by this strategic question: "${strategicQuestion}"

When relevant, incorporate themes from this question into your response. However:
- Your response should primarily focus on what the prompt asks for
- The strategic question is CONTEXT, not the main subject
- Only reference strategic themes where they naturally fit
- Do NOT make the entire response about the strategic question

`;
        }
        
        // Build client strategy context injection - ONLY if placeholder flag is set
        let strategyContextInjection = '';
        if (considerStrategy && strategyContent) {
            // Truncate strategy content if too long
            const truncatedStrategy = strategyContent.substring(0, 8000);
            strategyContextInjection = `
CLIENT STRATEGY CONTEXT (use as grounding, not the main topic):
The following is the client's strategy document. Use it to ground your response in the client's actual priorities and direction:

${truncatedStrategy}

When generating content:
- Reference the client's stated strategic priorities where relevant
- Align your response with their transformation initiatives and goals
- Use their terminology and stated focus areas
- Do NOT summarize the strategy - use it to inform your response to the prompt

`;
        }

        // Perform web research if enabled
        let webResearchContent = '';
        if (research) {
            console.log('[Workshop] Performing web research for placeholder...');
            
            // Emit progress to UI
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-console-log', {
                    agent: 'workshop',
                    message: `ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Researching online: "${prompt.substring(0, 80)}..."`,
                    type: 'info'
                });
            }
            
            try {
                // Build a research query from the prompt and client context
                const researchQuery = `Research the following for ${client?.name || 'the company'} (${client?.industry || 'business'}):
                
${prompt}

Provide current, factual information including:
- Recent developments and news
- Market data and statistics
- Industry trends relevant to this topic
- Specific facts, figures, and dates

Focus on actionable insights. Include sources where possible.`;
                
                // Use the existing web search function
                const webResults = await callOpenAIWebSearchForResearch(openaiCreds.apiKey, researchQuery, client);
                
                if (webResults && webResults.length > 0) {
                    webResearchContent = `
WEB RESEARCH FINDINGS (from online sources):
${webResults}

`;
                    console.log('[Workshop] Web research completed, found content');
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Web research completed - found current information`,
                            type: 'success'
                        });
                    }
                } else {
                    console.log('[Workshop] No web research results found');
                }
            } catch (researchError) {
                console.error('[Workshop] Web research error:', researchError.message);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-console-log', {
                        agent: 'workshop',
                        message: `ÃƒÂ¢Ã…Â¡Ã‚Â  Web research unavailable, using source pack only`,
                        type: 'warning'
                    });
                }
            }
        }

        const userPrompt = `${strategicContextInjection}${strategyContextInjection}${webResearchContent}${prompt}

SOURCE PACK CONTENT:
${truncatedSourcePack || 'No source pack content available.'}

ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
IMPORTANT: MINE THE SOURCE PACK FOR SPECIFICS
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
Before generating content, scan the source pack above and extract:
1. Specific brand/product names (use them by name, not generically)
2. Actual data points (market share %, revenue figures, growth rates)
3. Named strategies or initiatives the client has mentioned
4. Specific competitor names if relevant
5. Real numbers and benchmarks

Your response MUST include these specific details - not generic placeholders.
If the source pack mentions "Product X achieved 23% growth", say that - don't say "strong growth".
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â

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
        
        // Retry logic for transient network errors
        const maxRetries = 3;
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
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
            } catch (apiError) {
                lastError = apiError;
                const errorCode = apiError.code || '';
                const errorMessage = apiError.message || '';
                
                // Check if this is a retryable network error
                const isNetworkError = 
                    errorCode === 'ENOTFOUND' ||
                    errorCode === 'ETIMEDOUT' ||
                    errorCode === 'ECONNRESET' ||
                    errorCode === 'ECONNREFUSED' ||
                    errorCode === 'EAI_AGAIN' ||
                    errorMessage.includes('getaddrinfo') ||
                    errorMessage.includes('socket hang up') ||
                    errorMessage.includes('network') ||
                    (apiError.response?.status >= 500 && apiError.response?.status < 600);
                
                // Check for rate limiting (429) - also retryable
                const isRateLimited = apiError.response?.status === 429;
                
                if ((isNetworkError || isRateLimited) && attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
                    console.log(`[Workshop] Retryable error on attempt ${attempt}/${maxRetries}: ${errorMessage}. Retrying in ${delay/1000}s...`);
                    
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('ai-console-log', {
                            agent: 'workshop',
                            message: `ÃƒÂ¢Ã…Â¡Ã‚Â  Network issue, retrying (${attempt}/${maxRetries})...`,
                            type: 'warning'
                        });
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                // Non-retryable error or max retries reached - break out
                break;
            }
        }
        
        // If we got here, all retries failed
        console.error('[Workshop] AI generation error after retries:', lastError.message);
        if (lastError.response) {
            console.error('[Workshop] API response status:', lastError.response.status);
            console.error('[Workshop] API response data:', JSON.stringify(lastError.response.data));
        }
        // Return error with more detail
        const errorDetail = lastError.response?.data?.error?.message || lastError.message;
        return `[Error: ${errorDetail}]`;
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
    emitLog('analyst', 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â Analyst Agent: Beginning comprehensive source analysis...', 'thinking');
    
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
        emitLog('analyst', 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Warning: Very little content found in source pack!', 'warning');
        return `No substantive content found in source pack. Documents checked: ${Object.keys(documents).join(', ')}. All were either placeholders or empty.`;
    }
    
    console.log(`[Analyst] Total content length: ${allContent.length} chars from ${docList.length} documents`);
    
    const analysisPrompt = `You are a senior research analyst. Your job is to thoroughly analyze all provided source documents and extract every piece of valuable information.

CLIENT: ${client?.name || 'Unknown'}
INDUSTRY: ${client?.industry || 'Unknown'}

ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
CRITICAL FIRST STEP: STAKEHOLDER ANALYSIS
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â

FIRST, look for any Point of Contact (POC) information in the documents.
Search for files containing "poc", "point_of_contact", "stakeholder", or from folder "3.0".
If found, extract:
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Stakeholder names, titles, and roles
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Seniority levels and decision-making authority  
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Known priorities, interests, and communication preferences
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Any stated concerns or strategic focus areas

This audience analysis is CRITICAL for tailoring the narrative.

ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
SOURCE DOCUMENTS
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â
${allContent}
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â

Perform a comprehensive extraction across ALL documents. For EACH category below, extract ALL relevant information found ANYWHERE in the documents:

## 1. STAKEHOLDER PROFILE (from POC/contact files if present)
- Who are the target audience members?
- What are their roles, priorities, and preferences?

## 2. SPECIFIC BRANDS, PRODUCTS & SERVICES
- Extract ALL brand names, product names, and service names mentioned
- Note product categories and portfolio structure
- Identify flagship products or priority brands
- Include any specific product metrics (market share, revenue, growth)

## 3. KEY FACTS & STATISTICS (USE EXACT NUMBERS)
- Numbers, percentages, financial figures, market sizes - EXACT VALUES ONLY
- Growth rates, benchmarks, quantitative data points
- Revenue figures, market share percentages, customer counts
- Include the source document for each
- NEVER paraphrase "strong growth" - extract the actual number like "23% growth"

## 4. CLIENT-SPECIFIC STRATEGY & PRIORITIES
- Information about ${client?.name || 'the client'}'s stated strategy
- Named initiatives, programs, or transformation efforts
- Specific priorities mentioned by leadership
- Competitive positioning and stated differentiators

## 5. INDUSTRY & MARKET DYNAMICS
- Trends, disruptions, competitive landscape
- Regulatory factors, technology shifts
- Named competitors and their positioning

## 6. PROBLEMS & PAIN POINTS
- Challenges, risks, inefficiencies
- Capability gaps, threats, barriers

## 7. OPPORTUNITIES & VALUE DRIVERS
- Growth opportunities, efficiency gains
- Transformation potential, competitive advantages

## 8. SOLUTIONS & CAPABILITIES
- Specific solutions, technologies, methodologies
- Assets or capabilities that could address challenges

## 9. POWERFUL QUOTES & STATEMENTS
- Impactful phrases, executive statements
- Quotable insights with source attribution

## 10. CROSS-CUTTING THEMES
- Themes appearing across multiple documents
- These are often the most important strategic threads

CRITICAL: When you extract data, use EXACT VALUES from the documents:
- DON'T say "significant market share" - say "23% market share"
- DON'T say "leading brand" - say "Brand X, the #2 player in category Y"
- DON'T paraphrase - quote the specific numbers and names

Be exhaustive. Extract EVERYTHING of value. Note which document each insight came from.`;

    const model = openaiCreds.model || 'gpt-5.2';
    
    console.log(`[Analyst] Calling OpenAI with model: ${model}, prompt length: ${analysisPrompt.length}`);
    emitLog('analyst', `Calling ${model} with ${Math.round(analysisPrompt.length / 1000)}k chars...`, 'thinking');
    
    try {
        const analysis = await callOpenAI(openaiCreds.apiKey, model, [
            { role: 'system', content: 'You are a meticulous research analyst who extracts every valuable insight from documents. You extract EXACT data points, brand names, product names, and statistics - never paraphrasing numbers into vague descriptions. You always cite your sources.' },
            { role: 'user', content: analysisPrompt }
        ], 6000);
        
        console.log(`[Analyst] OpenAI returned: ${analysis?.length || 0} chars`);
        
        if (!analysis || analysis.length < 100) {
            emitLog('analyst', `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Warning: Analysis returned minimal content (${analysis?.length || 0} chars)`, 'warning');
        } else {
            emitLog('analyst', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Analysis complete - ${analysis.length} chars of insights extracted`, 'success');
        }
        
        return analysis || 'Analysis returned empty - documents may not have contained extractable content.';
    } catch (err) {
        console.error('[Analyst] OpenAI call failed:', err);
        emitLog('analyst', `ÃƒÂ¢Ã‚ÂÃ…â€™ Error calling OpenAI: ${err.message}`, 'error');
        return `Analysis failed: ${err.message}. The source documents were: ${docList.join(', ')}`;
    }
}

/**
 * Agent 2: STRATEGIST - Maps insights to narrative structure  
 */
async function runStrategistAgent(analysisOutput, agentPrompt, client, openaiCreds, emitLog) {
    emitLog('strategist', 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã…Â  Strategist Agent: Mapping insights to narrative architecture...', 'thinking');
    
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
            emitLog('strategist', `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Warning: Strategy returned minimal content (${strategy?.length || 0} chars)`, 'warning');
        } else {
            emitLog('strategist', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Strategic mapping complete - ${strategy.length} chars`, 'success');
        }
        
        return strategy || 'Strategy mapping returned empty.';
    } catch (err) {
        console.error('[Strategist] OpenAI call failed:', err);
        emitLog('strategist', `ÃƒÂ¢Ã‚ÂÃ…â€™ Error calling OpenAI: ${err.message}`, 'error');
        return `Strategy mapping failed: ${err.message}`;
    }
}

/**
 * Agent 3: NARRATOR - Writes the final executive narrative
 */
async function runNarratorAgent(analysisOutput, strategyOutput, agentPrompt, client, context, openaiCreds, emitLog) {
    emitLog('narrator', 'ÃƒÂ¢Ã…â€œÃ‚ÂÃƒÂ¯Ã‚Â¸Ã‚Â Narrator Agent: Crafting executive narrative...', 'thinking');
    
    // Handle missing or null inputs
    const safeAnalysis = analysisOutput || 'No analysis available - the source pack may not have contained substantive content.';
    const safeStrategy = strategyOutput || 'No strategic mapping available.';
    
    // Log what we received
    console.log(`[Narrator] Analysis length: ${safeAnalysis?.length || 0}, Strategy length: ${safeStrategy?.length || 0}`);
    
    // Extract length constraints from the user's prompt and calculate word limit
    const lengthConstraint = extractLengthConstraint(agentPrompt);
    const wordLimit = lengthConstraint.wordLimit;
    
    console.log(`[Narrator] Detected length constraint: ${wordLimit} words max (${lengthConstraint.fontSize}pt font)`);
    
    // Calculate approximate section budget to help AI plan
    const sectionBudget = Math.floor(wordLimit / 4);
    
    const narrativePrompt = `
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬â€
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â  MANDATORY LENGTH CONSTRAINT - READ FIRST  ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â                            ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â£
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  MAXIMUM: ${wordLimit} WORDS (${Math.ceil(wordLimit / 500)} pages A4 at ${lengthConstraint.fontSize}pt)                                    ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  This is a HARD LIMIT from the user's brief. You MUST:                       ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Write COMPLETE sentences and sections (never cut off mid-thought)         ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Stay UNDER ${wordLimit} words total                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Budget roughly ${sectionBudget} words per major section                            ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Use TABLES to compress data (tables are more concise than prose)          ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Be ruthlessly concise - every word must earn its place                    ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ  Exceeding ${wordLimit} words makes the output UNACCEPTABLE to the user.            ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ                                                                              ÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬Ëœ
ÃƒÂ¢Ã¢â‚¬Â¢Ã…Â¡ÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â

CLIENT: ${client?.name || 'Unknown'}
INDUSTRY: ${client?.industry || 'Unknown'}
CONTEXT: ${context?.outputIntent || 'Executive Narrative'}

=== YOUR WRITING BRIEF (from user) ===
${agentPrompt}
=== END OF BRIEF ===

=== ANALYST'S SOURCE INSIGHTS ===
${safeAnalysis}
=== END OF INSIGHTS ===

=== STRATEGIST'S NARRATIVE ARCHITECTURE ===
${safeStrategy}
=== END OF ARCHITECTURE ===
ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â

NOW WRITE THE NARRATIVE.

Remember:
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ MAXIMUM ${wordLimit} words - this is from the user's brief, not negotiable
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Complete every section fully - never stop mid-sentence
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Use markdown tables for data (they're more concise than prose)
ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ If running long, cut CONTENT not STRUCTURE

Begin writing:`;

    const model = openaiCreds.model || 'gpt-5.2';
    
    // Use generous max_tokens to ensure narrative completes - length is enforced via prompt instructions
    const maxTokens = 8000;
    console.log(`[Narrator] Target word limit: ${wordLimit} words (enforced via prompt, not token limit)`);
    
    const narrative = await callOpenAI(openaiCreds.apiKey, model, [
        { role: 'system', content: `You are an elite executive writer crafting board-ready narratives.

CRITICAL RULES:
1. WORD LIMIT: Stay under ${wordLimit} words. Be concise.
2. COMPLETE ALL SECTIONS: Never create a heading without substantial content beneath it.
3. USE TABLES: When presenting structured data, comparisons, or stakeholder analysis, use markdown tables.
4. NEVER REFERENCE SOURCES: Don't mention "source pack", "sources", or "documents". Write as a consultant, not an AI.
5. CLEAN HEADINGS: Never include parenthetical instructions in headings.
6. FOLLOW THE BRIEF EXACTLY: Every section they request must have substantial content.

SPECIFICITY RULE (CRITICALLY IMPORTANT):
- USE SPECIFIC BRAND NAMES: If the source mentions "Brand X" or "Product Y", use those exact names
- USE EXACT DATA: If the analyst found "23% market share", write "23% market share" - not "significant share"
- REFERENCE REAL INITIATIVES: If the client has named strategies (e.g., "Project Phoenix", "Vision 2030"), use those names
- NAME COMPETITORS: If competitive data is provided, name the actual competitors
- CITE SPECIFIC METRICS: Revenue figures, growth percentages, customer counts - use the real numbers
- NEVER BE VAGUE: Replace every "significant", "substantial", "leading" with the actual data point

Your narrative should read like someone who has DEEP knowledge of the client's business, brands, and market position.

STRATEGIC QUESTION FRAMING (THIS IS THE MOST IMPORTANT RULE):

If the prompt includes a "strategic question" or "exam question", you MUST:

1. EXTRACT THE KEY THEMES from the question. For example, if the question is:
   "How might we build upon customer data, route to market, and product innovation to win with the shopper and retailer in an AI-led market?"
   
   Key themes are: "customer data", "route to market", "product innovation", "win with shopper", "win with retailer", "AI-led market"

2. THESE THEMES BECOME YOUR VOCABULARY. Use these exact phrases repeatedly throughout the narrative:
   - The Opening Belief should directly address the core challenge (e.g., "winning with the shopper and retailer")
   - The Strategy section should name the foundations as pillars (e.g., "four foundations: customer data, route to market, product innovation, consumer research")
   - The Shifts should be framed as transformations OF these foundations
   - The Conclusion should return to the question's language

3. STRUCTURE THE NARRATIVE AS AN ANSWER:
   - If the question asks "how might we win with shoppers and retailers", then EVERY section should be about shopper/retailer outcomes
   - Don't write a generic "AI transformation" narrative with occasional references
   - Write a "winning with shoppers and retailers through AI" narrative from start to finish

4. TEST YOURSELF: After writing, a reader should be able to reverse-engineer the strategic question from your narrative. If they can't tell what question you were answering, you've failed.

Do NOT mention "strategic question" or "exam question" in output. The themes should be woven naturally.

You always complete the full narrative. Never stop mid-section.` },
        { role: 'user', content: narrativePrompt }
    ], maxTokens);
    
    // Log actual word count
    const actualWordCount = narrative?.split(/\s+/).length || 0;
    console.log(`[Narrator] Generated narrative: ${actualWordCount} words (target: ${wordLimit})`);
    
    if (actualWordCount > wordLimit * 1.2) {
        emitLog('narrator', `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Narrative is ${actualWordCount} words (target: ${wordLimit}) - consider iterating to condense`, 'info');
    }
    
    emitLog('narrator', 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Executive narrative complete', 'success');
    return narrative;
}

/**
 * Extract length constraints from user prompt and calculate appropriate word limit
 */
function extractLengthConstraint(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Pattern 1: "no more than X pages" or "maximum X pages"
    const pageMatch = lowerPrompt.match(/(?:no more than|maximum|max|under|within)\s*(\d+)\s*pages?(?:\s*(?:of\s*)?a4)?/i) ||
                      lowerPrompt.match(/(\d+)\s*pages?\s*(?:of\s*)?a4/i) ||
                      lowerPrompt.match(/(\d+)\s*a4\s*pages?/i);
    
    // Pattern 2: Explicit word limits
    const wordMatch = lowerPrompt.match(/(?:maximum|max|no more than|under|within)\s*(\d+)\s*words?/i) ||
                      lowerPrompt.match(/(\d+)\s*words?\s*(?:max|maximum|limit)/i);
    
    // Pattern 3: Font size detection for more accurate page calculation
    const fontMatch = lowerPrompt.match(/(?:size\s*)?(\d+(?:\.\d+)?)\s*(?:pt|font)/i);
    const fontSize = fontMatch ? parseFloat(fontMatch[1]) : 11; // Default 11pt
    
    // Words per page calculation based on font size (A4 with normal margins)
    // Conservative estimates accounting for headers, spacing, tables, bullet points
    let wordsPerPage = 450; // Default for 11pt
    if (fontSize <= 10) {
        wordsPerPage = 550;
    } else if (fontSize <= 10.5) {
        wordsPerPage = 500;
    } else if (fontSize <= 11) {
        wordsPerPage = 450;
    } else if (fontSize <= 12) {
        wordsPerPage = 400;
    } else {
        wordsPerPage = 350;
    }
    
    let wordLimit = 1000; // Default: ~2 pages
    let instruction = 'Maximum 1000 words (approximately 2 pages A4).';
    
    if (wordMatch) {
        wordLimit = parseInt(wordMatch[1]);
        instruction = `Maximum ${wordLimit} words as specified in your brief.`;
    } else if (pageMatch) {
        const pages = parseInt(pageMatch[1]);
        wordLimit = pages * wordsPerPage;
        instruction = `Maximum ${wordLimit} words (${pages} pages A4 at ${fontSize}pt font).`;
    }
    
    console.log(`[LengthConstraint] Detected: ${wordLimit} words (font: ${fontSize}pt, ${wordsPerPage} words/page)`);
    
    return {
        wordLimit,
        instruction,
        wordsPerPage,
        fontSize
    };
}

// ============================================
// Narrative Builder - Step 6 Guided Prompt Creation
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
- Start by sharing 2-3 interesting insights you found in the source documents (use bullet points ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ for listing insights)
- Use these insights to naturally lead into questions about their preferences
- Be conversational and helpful, not robotic
- Ask ONE question at a time - never multiple questions in the same message
- Build on their answers to refine your understanding
- Reference specific content from the sources when relevant

FORMATTING RULES:
- For listing insights or observations: use bullet points (ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ or -)
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
        const model = openaiCreds.model || 'gpt-5.2';
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
2. Mentions 2-3 interesting insights or themes you spotted in their source documents (use bullet points ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ for these)
3. Asks ONE opening question about what kind of narrative angle interests them

Be conversational and engaging. Don't be robotic. Make the user excited about the narrative possibilities.

CRITICAL FORMATTING:
- Use bullet points (ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ or -) for listing insights/observations
- Use bold letters **a)** **b)** **c)** ONLY for the question options the user should choose from
- Put EACH option on its own line for readability (never in a paragraph)
- Ask only ONE question, don't combine multiple questions
- Keep the message focused and not overwhelming`;

        const messages = [{ role: 'system', content: systemPrompt }];
        
        const model = openaiCreds.model || 'gpt-5.2';
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
// Narrative Chat - Step 7 Q&A with Sources + Narrative
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
    const model = openaiCreds.model || 'gpt-5.2';
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
    const model = openaiCreds.model || 'gpt-5.2';
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

// Set source pack from history (when user views a history entry)
ipcMain.handle('narrativeChat:setSourcePack', async (event, sourcePack) => {
    if (sourcePack && sourcePack.documents) {
        appState.pendingSourcePack = sourcePack;
        appState.lastSourcePack = sourcePack;
        console.log('[NarrativeChat] Source pack restored from history with', Object.keys(sourcePack.documents).length, 'documents');
        return { success: true, documentCount: Object.keys(sourcePack.documents).length };
    } else {
        console.log('[NarrativeChat] No valid source pack provided');
        return { success: false, error: 'Invalid source pack' };
    }
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
    
    emitLog('system', `ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬ Starting multi-agent narrative generation for ${client?.name || 'Unknown'}...`, 'info');
    emitLog('system', 'Pipeline: Analyst ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Strategist ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Narrator', 'info');
    
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
            emitLog('system', 'ÃƒÂ¢Ã‚ÂÃ…â€™ No source pack found! Generate a source pack first.', 'error');
            return { 
                success: false, 
                error: 'No source pack found. Please generate a source pack first.' 
            };
        }
        
        if (!sourcePack.documents) {
            emitLog('system', 'ÃƒÂ¢Ã‚ÂÃ…â€™ Source pack has no documents object!', 'error');
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
        
        emitLog('system', `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¦ Found source pack with ${docCount} documents`, 'success');
        emitLog('system', `Documents: ${docKeys.slice(0, 5).join(', ')}${docKeys.length > 5 ? '...' : ''}`, 'info');
        
        // ========== AGENT 1: ANALYST ==========
        if (appState.narrativeCancelled) {
            emitLog('system', 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Generation cancelled', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', 'ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â', 'info');
        emitLog('system', 'PHASE 1/3: Deep Analysis', 'info');
        const analysisOutput = await runAnalystAgent(
            sourcePack.documents, 
            client, 
            openaiCreds, 
            emitLog
        );
        
        // ========== AGENT 2: STRATEGIST ==========
        if (appState.narrativeCancelled) {
            emitLog('system', 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Generation cancelled after analysis', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', 'ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â', 'info');
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
            emitLog('system', 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Generation cancelled after strategy', 'warning');
            return { success: false, canceled: true };
        }
        emitLog('system', 'ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â', 'info');
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
        
        emitLog('system', 'ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒÂ¢Ã¢â‚¬ÂÃ‚Â', 'info');
        emitLog('system', 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ All agents complete - preparing document...', 'success');
        
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
            } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ')) {
                // Bullet point
                docChildren.push(new Paragraph({
                    text: trimmedLine.replace(/^[-ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢]\s*/, ''),
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
        message: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Cancellation requested - stopping generation...',
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
    const model = openaiCreds.model || 'gpt-5.2';
    
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
        emitAiConsoleLog('analyst', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ ${section} research complete (${comprehensiveAnalysis.length} chars)`, 'success');
        
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
            emitAiConsoleLog('narrator', `ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ Executive narrative complete (${executiveNarrative.length} chars)`, 'success');
        } else {
            emitAiConsoleLog('system', `Using research directly (narrative polish skipped)`, 'info');
        }
        
        emitAiConsoleLog('system', `${section} Deep Research complete! Total: 2 steps executed`, 'success');
        emitAiConsoleLog('system', `ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬`, 'info');
        
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
        return generateFallbackReport(section, client, context, openaiCreds.model || 'gpt-5.2');
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

// Helper function to make OpenAI API calls with rate limiting and retry.
// NO fallback to older models - all generation must use GPT-5 series.
async function callOpenAI(apiKey, model, messages, maxTokens = 2000) {
    const result = await openAIRateLimiter.enqueue(() => callOpenAIWithRetry(apiKey, model, messages, maxTokens));
    
    if (result === null) {
        console.error(`[OpenAI] Model ${model} returned empty/failed. No fallback - returning null.`);
        emitAiConsoleLog('system', `GPT-5 model (${model}) is currently unavailable. Please try again.`, 'error');
    }
    
    return result;
}

// Internal function with retry logic
async function callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount = 0) {
    const https = require('https');
    
    // Determine if this model uses the new Responses API (gpt-5.x models)
    const useResponsesAPI = model.startsWith('gpt-5');
    
    // GPT-5 with large context needs much more time than 3 minutes.
    // Scale timeout based on payload size AND model family.
    const BASE_TIMEOUT_MS = useResponsesAPI ? 480000 : 180000; // 8 min for GPT-5, 3 min for others
    
    return new Promise((resolve, reject) => {
        // Settled guard — prevents the timeout→destroy→error double-fire from
        // spawning zombie retry chains that run for minutes in the background.
        let settled = false;
        function settle(value) {
            if (settled) return;
            settled = true;
            resolve(value);
        }

        let requestBody;
        let apiPath;
        
        if (useResponsesAPI) {
            // Use the Responses API for GPT-5.x models
            // Use the dedicated 'instructions' field for system messages so they
            // retain their authority; 'input' carries only the user content.
            const sysMsg = messages.find(m => m.role === 'system')?.content || '';
            const userContent = messages.filter(m => m.role !== 'system')
                .map(m => m.content)
                .join('\n\n');
            
            const body = {
                model: model,
                input: userContent,
                max_output_tokens: maxTokens,
            };
            if (sysMsg) body.instructions = sysMsg;
            
            requestBody = JSON.stringify(body);
            apiPath = '/v1/responses';
            
            console.log(`[OpenAI] Using Responses API for ${model} (instructions: ${sysMsg.length} chars, input: ${userContent.length} chars, timeout: ${BASE_TIMEOUT_MS / 1000}s)`);
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
            timeout: BASE_TIMEOUT_MS
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', async () => {
                if (settled) return; // guard against late delivery after timeout
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
                                settle(retryResult);
                            } catch (retryError) {
                                settle(null);
                            }
                            return;
                        }
                        
                        // Check if it's a server error (5xx) — retryable
                        const isServerError = res.statusCode >= 500 && res.statusCode < 600;
                        if (isServerError && retryCount < openAIRateLimiter.maxRetries) {
                            const waitTime = openAIRateLimiter.retryDelayMs * Math.pow(2, retryCount);
                            console.log(`[OpenAI] Server error ${res.statusCode}. Retry ${retryCount + 1}/${openAIRateLimiter.maxRetries} in ${waitTime}ms...`);
                            emitAiConsoleLog('system', `Server error (${res.statusCode}). Retrying in ${Math.round(waitTime/1000)}s...`, 'warning');
                            
                            await new Promise(r => setTimeout(r, waitTime));
                            try {
                                const retryResult = await callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount + 1);
                                settle(retryResult);
                            } catch (retryError) {
                                settle(null);
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
                        
                        settle(null);
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
                        settle(null);
                        return;
                    }
                    
                    // Log successful call
                    const tokensUsed = response.usage?.total_tokens || 'unknown';
                    console.log(`[OpenAI] Success. Model: ${model}, Tokens: ${tokensUsed}`);
                    
                    settle(content);
                } catch (parseError) {
                    console.error(`[OpenAI] Parse error:`, parseError);
                    console.error(`[OpenAI] Raw data:`, data.substring(0, 500));
                    emitAiConsoleLog('system', `OpenAI response parse error: ${parseError.message}`, 'error');
                    settle(null);
                }
            });
        });

        req.on('error', async (error) => {
            // If already settled (e.g. by timeout handler), do nothing.
            // This prevents zombie retry chains spawned by req.destroy().
            if (settled) return;
            
            console.error(`[OpenAI] Request error:`, error.message);
            
            // Retry on genuine network errors (not destroy-triggered)
            if (retryCount < openAIRateLimiter.maxRetries) {
                const waitTime = openAIRateLimiter.retryDelayMs * Math.pow(2, retryCount);
                console.log(`[OpenAI] Network error. Retry ${retryCount + 1}/${openAIRateLimiter.maxRetries} in ${waitTime}ms...`);
                emitAiConsoleLog('system', `Network error. Retrying in ${Math.round(waitTime/1000)}s...`, 'warning');
                
                await new Promise(r => setTimeout(r, waitTime));
                
                try {
                    const retryResult = await callOpenAIWithRetry(apiKey, model, messages, maxTokens, retryCount + 1);
                    settle(retryResult);
                } catch (retryError) {
                    settle(null);
                }
                return;
            }
            
            emitAiConsoleLog('system', `OpenAI request error: ${error.message}`, 'error');
            settle(null);
        });

        const timeoutMinutes = Math.round(BASE_TIMEOUT_MS / 60000);
        req.setTimeout(BASE_TIMEOUT_MS, () => {
            console.error(`[OpenAI] Request timed out after ${timeoutMinutes} minutes (model: ${model})`);
            emitAiConsoleLog('system', `OpenAI request timed out after ${timeoutMinutes} minutes`, 'error');
            settle(null);  // settle FIRST so the error handler from destroy is a no-op
            req.destroy();
        });

        req.write(requestBody);
        req.end();
    });
}

// Audit logs
ipcMain.handle('audit:getLogs', async (event, { limit = 100, category } = {}) => {
    return auditLogger.getLogs({ limit, category });
});

// Restore document state from history (markdown only — docx rebuilt lazily on download)
ipcMain.handle('session:restoreDocState', async (event, { qualificationMarkdown, valueCaseMarkdown, provocationMarkdown, reviewMarkdown, reviewsByRole, provokeRewriteVersions, clientName }) => {
    const sanitized = (clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');

    if (qualificationMarkdown) {
        appState.lastQualificationDoc = {
            markdown: qualificationMarkdown,
            docxBuffer: null,
            fileName: `${sanitized}_Qualification.docx`
        };
    } else {
        appState.lastQualificationDoc = null;
    }

    if (valueCaseMarkdown) {
        appState.lastValueCaseDoc = {
            markdown: valueCaseMarkdown,
            docxBuffer: null,
            fileName: `${sanitized}_Value_Case.docx`
        };
    } else {
        appState.lastValueCaseDoc = null;
    }

    if (provocationMarkdown) {
        appState.lastProvocationDoc = {
            markdown: provocationMarkdown,
            docxBuffer: null,
            fileName: `${sanitized}_Origination_Engine.docx`
        };
        appState.provokeVersions = [{
            label: 'Original Provoke',
            markdown: provocationMarkdown,
            docxBuffer: null,
            fileName: `${sanitized}_Origination_Engine.docx`,
            role: null,
            timestamp: Date.now()
        }];
    } else {
        appState.lastProvocationDoc = null;
        appState.provokeVersions = [];
    }

    if (reviewMarkdown) {
        appState.lastReviewDoc = {
            markdown: reviewMarkdown,
            docxBuffer: null,
            fileName: `${sanitized}_Review.docx`
        };
    } else {
        appState.lastReviewDoc = null;
    }

    // Restore per-role reviews
    appState.reviewsByRole = {};
    if (reviewsByRole && typeof reviewsByRole === 'object') {
        for (const [role, md] of Object.entries(reviewsByRole)) {
            if (!md) continue;
            appState.reviewsByRole[role] = {
                markdown: md,
                docxBuffer: null,
                fileName: `${sanitized}_${role.toUpperCase()}_Review.docx`,
                role,
                label: `${role.toUpperCase()} Review`,
                timestamp: Date.now()
            };
        }
        // Set lastReviewDoc to the most recent if we have any
        const roles = Object.keys(appState.reviewsByRole);
        if (roles.length > 0) {
            const lastRole = roles[roles.length - 1];
            appState.lastReviewDoc = appState.reviewsByRole[lastRole];
        }
    }

    // Restore provoke rewrite versions
    if (provokeRewriteVersions && Array.isArray(provokeRewriteVersions)) {
        for (const v of provokeRewriteVersions) {
            if (!v.markdown) continue;
            appState.provokeVersions.push({
                label: v.label || `Provoke v${appState.provokeVersions.length + 1}`,
                markdown: v.markdown,
                docxBuffer: null,
                fileName: v.fileName || `${sanitized}_Origination_Engine_v${appState.provokeVersions.length + 1}.docx`,
                role: v.role || null,
                timestamp: Date.now()
            });
        }
    }

    console.log('[Session] Restored doc state from history for', clientName);
    return { success: true };
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
${sourcePack.alphasense_consensus.key_quotes.map(q => `> "${q.quote}" ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â *${q.source}*`).join('\n\n')}

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

app.whenReady().then(() => {
    // Show splash screen IMMEDIATELY (before any heavy loading)
    createSplashWindow();
    
    // Use setImmediate to let splash render before heavy imports
    setImmediate(() => {
        // Load heavy modules in background while splash is visible
        loadHeavyModules();
        
        // Create main window (will show when ready)
        createWindow();
    });
});

app.on('window-all-closed', () => {
    // Save any pending data before quitting
    credentialManager.flushAppDataImmediate();
    
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

/**
 * R/StudioGPT
 * Frontend Application Logic - Electron Desktop App
 * 
 * This application uses Electron IPC for all backend communication
 * instead of HTTP fetch calls for standalone desktop operation.
 */

// ============================================
// State Management
// ============================================
const state = {
    user: null,
    currentView: 'dashboard',
    clients: [],
    selectedClient: null,
    generatedPacks: [],
    currentSourcePack: null,
    isGenerating: false,
    generationStartTime: null,
    isElectron: typeof window.electronAPI !== 'undefined',
    // Step 2: Client Point of Contact file
    pocFile: null,
    // Step 4: Additional documents
    additionalFiles: [],
    // Step 4: Placeholder sections that need replacement
    placeholderSections: [],
    // Step 4: Source results (new simplified structure)
    sourceResults: {},
    failedSources: [],
    pendingGenerationResult: null,
    pendingGenerationContext: null,
    // Step 5: Narrative Builder generated prompt
    narrativeBuilderPrompt: null,
    // Narrative storage
    clientNarratives: [],
    currentDisplayedNarrative: null
};

// ============================================
// DOM Elements
// ============================================
const elements = {
    // Screens
    loginScreen: document.getElementById('loginScreen'),
    mainApp: document.getElementById('mainApp'),
    
    // Login
    loginForm: document.getElementById('loginForm'),
    loginError: document.getElementById('loginError'),
    
    // Navigation
    navItems: document.querySelectorAll('.nav-item'),
    logoutBtn: document.getElementById('logoutBtn'),
    
    // User info
    userName: document.getElementById('userName'),
    userRole: document.getElementById('userRole'),
    userAvatar: document.getElementById('userAvatar'),
    welcomeName: document.getElementById('welcomeName'),
    
    // Views
    dashboardView: document.getElementById('dashboardView'),
    generateView: document.getElementById('generateView'),
    historyView: document.getElementById('historyView'),
    adminView: document.getElementById('adminView'),
    
    // Dashboard
    quickGenerateBtn: document.getElementById('quickGenerateBtn'),
    btnNewSourcePack: document.getElementById('btnNewSourcePack'),
    btnViewClients: document.getElementById('btnViewClients'),
    btnViewSchema: document.getElementById('btnViewSchema'),
    activityList: document.getElementById('activityList'),
    
    // Generate
    clientSearch: document.getElementById('clientSearch'),
    clientGrid: document.getElementById('clientGrid'),
    aiCreateClientBtn: document.getElementById('aiCreateClientBtn'),
    aiClientCreation: document.getElementById('aiClientCreation'),
    aiCreationTitle: document.getElementById('aiCreationTitle'),
    aiCreationSubtitle: document.getElementById('aiCreationSubtitle'),
    aiProgressFill: document.getElementById('aiProgressFill'),
    contextForm: document.getElementById('contextForm'),
    selectedClientBanner: document.getElementById('selectedClientBanner'),
    selectedClientName: document.getElementById('selectedClientName'),
    selectedClientMeta: document.getElementById('selectedClientMeta'),
    changeClientBtn: document.getElementById('changeClientBtn'),
    backToStep1: document.getElementById('backToStep1'),
    proceedToGenerate: document.getElementById('proceedToGenerate'),
    progressStages: document.getElementById('progressStages'),
    progressMessage: document.getElementById('progressMessage'),
    elapsedTime: document.getElementById('elapsedTime'),
    reviewContainer: document.getElementById('reviewContainer'),
    
    // Add Documents (Step 4)
    documentDropZone: document.getElementById('documentDropZone'),
    browseFilesBtn: document.getElementById('browseFilesBtn'),
    addedFilesSection: document.getElementById('addedFilesSection'),
    addedFilesList: document.getElementById('addedFilesList'),
    addedFileCount: document.getElementById('addedFileCount'),
    proceedWithDocs: document.getElementById('proceedWithDocs'),
    proceedWithDocsText: document.getElementById('proceedWithDocsText'),
    
    // History
    historyEmpty: document.getElementById('historyEmpty'),
    historyList: document.getElementById('historyList'),
    historyGenerateBtn: document.getElementById('historyGenerateBtn'),
    
    // Admin
    alphasenseCredForm: document.getElementById('alphasenseCredForm'),
    arcCredForm: document.getElementById('arcCredForm'),
    openaiCredForm: document.getElementById('openaiCredForm'),
    internetCredForm: document.getElementById('internetCredForm'),
    refreshLogsBtn: document.getElementById('refreshLogsBtn'),
    auditLogBody: document.getElementById('auditLogBody'),
    
    // Modal
    schemaModal: document.getElementById('schemaModal'),
    closeSchemaModal: document.getElementById('closeSchemaModal'),
    schemaCode: document.getElementById('schemaCode'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('R/StudioGPT - Initializing...');
    console.log('Running in Electron:', state.isElectron);
    
    // Load persisted generated packs history
    if (state.isElectron && window.electronAPI.appData) {
        try {
            const savedPacks = await window.electronAPI.appData.loadGeneratedPacks();
            if (savedPacks && Array.isArray(savedPacks)) {
                state.generatedPacks = savedPacks;
                console.log(`Loaded ${savedPacks.length} saved Source Packs from history`);
            }
        } catch (e) {
            console.warn('Could not load saved packs:', e);
        }
    }
    
    // Check session
    await checkSession();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup POC Upload listeners (Step 2)
    setupPocUploadListeners();
    
    // Setup Add Documents step listeners
    setupAddDocumentsListeners();
    
    // Setup Narrative step listeners
    setupNarrativeListeners();
    
    // Setup Video Generation
    setupVideoGeneration();
    
    // Setup Narration Generation
    setupNarrationGeneration();
    
    // Setup Narrative Audio Generation (Step 6)
    setupNarrativeAudioGeneration();
    
    // Setup Video Narrative Generation (Step 6)
    setupVideoNarrativeGeneration();
    
    // Setup Template Management (Admin)
    setupTemplateManagement();
    
    // Setup AI Console (admin only)
    aiConsole.init();
    
    // Setup demo credential buttons
    setupDemoCredentials();
    
    // Setup menu action listeners (Electron only)
    if (state.isElectron && window.electronAPI.onMenuAction) {
        window.electronAPI.onMenuAction(handleMenuAction);
    }
    
    console.log('R/StudioGPT - Ready');
});

// ============================================
// Menu Action Handler (Electron)
// ============================================
function handleMenuAction(action) {
    switch (action) {
        case 'new-source-pack':
            resetWizard();
            switchView('generate');
            break;
        case 'export-json':
            if (state.currentSourcePack) exportJSON();
            break;
        case 'export-markdown':
            if (state.currentSourcePack) exportMarkdown();
            break;
        case 'view-dashboard':
            switchView('dashboard');
            break;
        case 'view-generate':
            switchView('generate');
            break;
        case 'view-history':
            switchView('history');
            break;
        case 'view-schema':
            showSchemaModal();
            break;
    }
}

// ============================================
// Authentication
// ============================================
async function checkSession() {
    try {
        if (state.isElectron) {
            const result = await window.electronAPI.auth.getSession();
            if (result.authenticated) {
                state.user = result.user;
                showMainApp();
            } else {
                showLoginScreen();
            }
        } else {
            // Fallback for non-Electron (development)
            showLoginScreen();
        }
    } catch (error) {
        console.error('Session check failed:', error);
        showLoginScreen();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        let result;
        
        if (state.isElectron) {
            result = await window.electronAPI.auth.login(username, password);
        } else {
            // Fallback for non-Electron
            result = { success: false, message: 'Electron API not available' };
        }
        
        if (result.success) {
            state.user = result.user;
            elements.loginError.textContent = '';
            showMainApp();
            showToast('Welcome back, ' + result.user.name, 'success');
        } else {
            elements.loginError.textContent = result.message || 'Login failed';
            shakeLoginForm();
        }
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = 'Login failed. Please try again.';
        shakeLoginForm();
    }
}

function shakeLoginForm() {
    const loginCard = document.querySelector('.login-card');
    loginCard.classList.add('shake');
    setTimeout(() => loginCard.classList.remove('shake'), 500);
}

async function handleLogout() {
    try {
        if (state.isElectron) {
            await window.electronAPI.auth.logout();
        }
        state.user = null;
        // Don't clear generatedPacks - they are persisted and should survive logout
        state.currentSourcePack = null;
        state.selectedClient = null;
        showLoginScreen();
        showToast('Signed out successfully', 'info');
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

function showLoginScreen() {
    elements.loginScreen.classList.remove('hidden');
    elements.mainApp.classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    elements.loginError.textContent = '';
}

async function showMainApp() {
    elements.loginScreen.classList.add('hidden');
    elements.mainApp.classList.remove('hidden');
    
    // Reload persisted generated packs (in case of re-login)
    if (state.isElectron && window.electronAPI.appData) {
        try {
            const savedPacks = await window.electronAPI.appData.loadGeneratedPacks();
            if (savedPacks && Array.isArray(savedPacks)) {
                state.generatedPacks = savedPacks;
                console.log(`Loaded ${savedPacks.length} saved Source Packs from history`);
            }
        } catch (e) {
            console.warn('Could not load saved packs:', e);
        }
    }
    
    // Update user info
    updateUserInfo();
    
    // Show/hide admin nav based on role
    const adminNav = document.querySelector('.nav-item.admin-only');
    if (state.user?.role === 'admin') {
        adminNav.classList.remove('hidden');
        // Show floating AI console for admin
        aiConsole.show();
    } else {
        adminNav.classList.add('hidden');
        // Hide floating AI console for non-admin
        aiConsole.hide();
    }
    
    // Load initial data
    loadClients();
    updateDashboardStats();
    updateApiStatus();
    
    // Show dashboard
    switchView('dashboard');
}

function updateUserInfo() {
    if (state.user) {
        elements.userName.textContent = state.user.name;
        elements.userRole.textContent = formatRole(state.user.role);
        elements.welcomeName.textContent = state.user.name.split(' ')[0];
        elements.userAvatar.textContent = getInitials(state.user.name);
    }
}

function formatRole(role) {
    return role.split('_').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ============================================
// Navigation
// ============================================
function switchView(viewName) {
    state.currentView = viewName;
    
    // Update nav items
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });
    
    // Update views
    const views = ['dashboard', 'generate', 'video', 'history', 'admin'];
    views.forEach(view => {
        const el = document.getElementById(`${view}View`);
        if (el) {
            el.classList.toggle('hidden', view !== viewName);
        }
    });
    
    // Load view-specific data
    if (viewName === 'admin' && state.user?.role === 'admin') {
        loadAuditLogs();
        loadCredentialStatus();
        loadWorkshopTemplatesStatus();
        loadPlaceholders();
    }
    
    if (viewName === 'history') {
        updateHistoryView();
    }
    
    if (viewName === 'dashboard') {
        updateApiStatus();
    }
}

// ============================================
// Client Management
// ============================================
async function loadClients() {
    try {
        if (state.isElectron) {
            state.clients = await window.electronAPI.clients.list();
        } else {
            // Fallback demo clients
            state.clients = [
                { id: 'cl-001', name: 'Accenture Global', industry: 'Technology & Consulting', geography: 'Global', sector: 'Professional Services' },
                { id: 'cl-002', name: 'TechCorp Industries', industry: 'Technology', geography: 'North America', sector: 'Software & Cloud' }
            ];
        }
        renderClientGrid();
    } catch (error) {
        console.error('Failed to load clients:', error);
        showToast('Failed to load clients', 'error');
    }
}

function renderClientGrid(filter = '') {
    const filteredClients = state.clients.filter(client => {
        const searchTerm = filter.toLowerCase();
        return client.name.toLowerCase().includes(searchTerm) ||
               client.industry.toLowerCase().includes(searchTerm) ||
               client.geography.toLowerCase().includes(searchTerm);
    });
    
    // Show/hide AI create button based on search input
    const searchTerm = filter.trim();
    const hasExactMatch = state.clients.some(c => c.name.toLowerCase() === searchTerm.toLowerCase());
    
    if (searchTerm.length > 2 && !hasExactMatch && filteredClients.length === 0) {
        // No matches - show prominent AI create option
        elements.aiCreateClientBtn?.classList.remove('hidden');
        elements.clientGrid.innerHTML = `
            <div class="empty-clients ai-suggest">
                <div class="ai-suggest-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <p>No client found for "<strong>${filter}</strong>"</p>
                <p class="ai-suggest-hint">Click "Create with AI" to automatically set up this client</p>
            </div>
        `;
        return;
    } else if (searchTerm.length > 2 && !hasExactMatch) {
        // Has partial matches but no exact - show AI button
        elements.aiCreateClientBtn?.classList.remove('hidden');
    } else {
        elements.aiCreateClientBtn?.classList.add('hidden');
    }
    
    if (filteredClients.length === 0) {
        elements.clientGrid.innerHTML = `
            <div class="empty-clients">
                <p>No clients found${filter ? ' matching "' + filter + '"' : ''}</p>
            </div>
        `;
        return;
    }
    
    elements.clientGrid.innerHTML = filteredClients.map(client => `
        <div class="client-card ${state.selectedClient?.id === client.id ? 'selected' : ''} ${client.aiGenerated ? 'new-client' : ''}" 
             data-client-id="${client.id}">
            <div class="client-card-header">
                <span class="client-name">${client.name}</span>
                <button class="client-delete-btn" data-client-id="${client.id}" data-client-name="${client.name}" title="Delete client">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
                <div class="client-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <path d="M5 13l4 4L19 7"/>
                    </svg>
                </div>
            </div>
            <div class="client-meta">
                <span class="client-tag">${client.industry}</span>
                <span class="client-tag">${client.geography}</span>
                <span class="client-tag">${client.sector}</span>
            </div>
        </div>
    `).join('');
    
    // Add click handlers for selecting clients
    document.querySelectorAll('.client-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't select if clicking delete button
            if (e.target.closest('.client-delete-btn')) return;
            selectClient(card.dataset.clientId);
        });
    });
    
    // Add click handlers for delete buttons
    document.querySelectorAll('.client-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const clientId = btn.dataset.clientId;
            const clientName = btn.dataset.clientName;
            deleteClient(clientId, clientName);
        });
    });
}

// Delete a client
async function deleteClient(clientId, clientName) {
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${clientName}"?\n\nThis action cannot be undone.`)) {
        return;
    }
    
    try {
        const result = await window.electronAPI.clients.delete(clientId);
        
        if (result.success) {
            showToast(`Deleted client: ${result.clientName}`, 'success');
            
            // If the deleted client was selected, clear selection
            if (state.selectedClient?.id === clientId) {
                state.selectedClient = null;
            }
            
            // Refresh client list
            await loadClients();
            renderClientGrid(elements.clientSearch.value);
        } else {
            showToast(`Failed to delete client: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting client:', error);
        showToast('Error deleting client', 'error');
    }
}

function selectClient(clientId) {
    const client = state.clients.find(c => c.id === clientId);
    if (client) {
        state.selectedClient = client;
        renderClientGrid(elements.clientSearch.value);
        
        // Update form with client data
        document.getElementById('industry').value = client.industry;
        document.getElementById('geography').value = client.geography;
        
        // Reset POC file when selecting a new client
        state.pocFile = null;
        resetPocUploadUI();
        
        // Move to step 2
        goToStep(2);
    }
}

// ============================================
// AI Client Creation
// ============================================
async function createClientWithAI() {
    const companyName = elements.clientSearch.value.trim();
    
    if (!companyName || companyName.length < 2) {
        showToast('Please enter a company name', 'warning');
        return;
    }
    
    // Show AI creation panel
    elements.aiClientCreation?.classList.remove('hidden');
    elements.aiCreateClientBtn?.classList.add('hidden');
    elements.clientGrid.innerHTML = '';
    
    // Reset progress
    elements.aiProgressFill.style.width = '0%';
    document.querySelectorAll('.ai-step').forEach(step => {
        step.classList.remove('active', 'complete');
    });
    
    const steps = ['analyze', 'industry', 'geography', 'sector', 'complete'];
    const stepMessages = {
        analyze: { title: 'Analyzing company...', subtitle: 'Searching business intelligence databases' },
        industry: { title: 'Detecting industry...', subtitle: 'Classifying sector and vertical' },
        geography: { title: 'Determining geography...', subtitle: 'Identifying primary markets' },
        sector: { title: 'Mapping sub-sector...', subtitle: 'Refining industry classification' },
        complete: { title: 'Client profile ready!', subtitle: 'AI analysis complete' }
    };
    
    // Animate progress steps
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 2;
        if (progress <= 90) {
            elements.aiProgressFill.style.width = `${progress}%`;
            
            // Update active step
            const stepIndex = Math.floor(progress / 25);
            steps.forEach((step, idx) => {
                const stepEl = document.querySelector(`.ai-step[data-step="${step}"]`);
                if (idx < stepIndex) {
                    stepEl?.classList.remove('active');
                    stepEl?.classList.add('complete');
                } else if (idx === stepIndex) {
                    stepEl?.classList.add('active');
                    const msg = stepMessages[step];
                    elements.aiCreationTitle.textContent = msg.title;
                    elements.aiCreationSubtitle.textContent = msg.subtitle;
                }
            });
        }
    }, 50);
    
    try {
        let result;
        
        if (state.isElectron) {
            result = await window.electronAPI.clients.aiCreate(companyName);
        } else {
            // Fallback simulation
            await sleep(2500);
            result = {
                success: true,
                client: {
                    id: `cl-${Date.now()}`,
                    name: companyName,
                    industry: 'Technology',
                    geography: 'Global',
                    sector: 'General Business',
                    aiGenerated: true
                },
                aiAnalysis: { confidence: 0.7 }
            };
        }
        
        clearInterval(progressInterval);
        
        if (result.success) {
            // Complete the progress
            elements.aiProgressFill.style.width = '100%';
            steps.forEach(step => {
                const stepEl = document.querySelector(`.ai-step[data-step="${step}"]`);
                stepEl?.classList.remove('active');
                stepEl?.classList.add('complete');
            });
            
            elements.aiCreationTitle.textContent = 'Client profile ready!';
            elements.aiCreationSubtitle.textContent = `Created ${result.client.name} with ${Math.round(result.aiAnalysis.confidence * 100)}% confidence`;
            
            // Add to local clients list
            if (!state.clients.find(c => c.id === result.client.id)) {
                state.clients.unshift(result.client);
            }
            
            // Wait a moment then auto-select
            await sleep(1000);
            
            // Hide AI panel and show clients
            elements.aiClientCreation?.classList.add('hidden');
            elements.clientSearch.value = '';
            renderClientGrid();
            
            // Auto-select the new client
            selectClient(result.client.id);
            
            showToast(`Client "${result.client.name}" created successfully!`, 'success');
            addActivity(`AI created client: ${result.client.name}`, 'success');
        } else {
            throw new Error(result.error || 'Failed to create client');
        }
    } catch (error) {
        clearInterval(progressInterval);
        console.error('AI client creation failed:', error);
        
        elements.aiClientCreation?.classList.add('hidden');
        renderClientGrid(elements.clientSearch.value);
        
        showToast(`Failed to create client: ${error.message}`, 'error');
    }
}

// ============================================
// Step Navigation
// ============================================
function goToStep(stepNumber) {
    // Update step indicators
    document.querySelectorAll('.step').forEach((step, idx) => {
        const stepNum = idx + 1;
        step.classList.remove('active', 'completed');
        if (stepNum < stepNumber) {
            step.classList.add('completed');
        } else if (stepNum === stepNumber) {
            step.classList.add('active');
        }
    });
    
    // Update step panels
    document.querySelectorAll('.step-panel').forEach(panel => {
        panel.classList.toggle('active', parseInt(panel.dataset.step) === stepNumber);
    });
    
    // Update selected client banner
    if (stepNumber === 2 && state.selectedClient) {
        elements.selectedClientName.textContent = state.selectedClient.name;
        elements.selectedClientMeta.textContent = 
            `${state.selectedClient.industry} • ${state.selectedClient.geography}`;
    }
    
    // Trigger C-suite web research when entering step 3 (generation starts)
    // This runs in background so results are ready by the time user reaches Step 6
    if (stepNumber === 3 && state.selectedClient) {
        // Pass full client context and POC file (if available) for contact extraction
        researchClientContacts(state.selectedClient, state.pocFile);
    }
}

// Research C-suite contacts for the selected client
// Current stakeholders: extracted from POC if available, otherwise web search
// Exited leaders: ALWAYS web search (POC won't have this info)
async function researchClientContacts(client, pocFile = null) {
    // Show loading state for both grids
    const currentLoading = document.getElementById('currentContactsLoading');
    const exitedLoading = document.getElementById('exitedContactsLoading');
    const currentGrid = document.getElementById('currentContactsGrid');
    const exitedGrid = document.getElementById('exitedContactsGrid');
    const currentTitle = document.getElementById('currentContactsTitle');
    const exitedTitle = document.getElementById('exitedContactsTitle');
    const currentHint = document.getElementById('currentContactsHint');
    const exitedHint = document.getElementById('exitedContactsHint');
    
    if (currentLoading) currentLoading.classList.remove('hidden');
    if (exitedLoading) exitedLoading.classList.remove('hidden');
    
    // Exited leaders: ALWAYS use web search (POC won't have departures info)
    // Reset exited section titles/hints to web search mode
    if (exitedTitle) exitedTitle.textContent = 'Recently Exited Senior Leaders';
    if (exitedHint) exitedHint.textContent = 'Live web search for recent C-suite departures';
    resetContactGrid(exitedGrid, 'Searching web...');
    
    // Start exited research immediately (runs in parallel)
    const exitedPromise = (async () => {
        try {
            const exitedResult = await window.electronAPI.clients.researchContacts(client, 'exited');
            if (exitedResult.success && exitedResult.contacts.length > 0) {
                populateContactGrid(exitedGrid, exitedResult.contacts, 'exited');
            } else {
                resetContactGrid(exitedGrid, 'No recent departures found');
            }
        } catch (error) {
            console.error('Error researching exited contacts:', error);
            resetContactGrid(exitedGrid, 'Research failed');
        }
        if (exitedLoading) exitedLoading.classList.add('hidden');
    })();
    
    // Current stakeholders: Check if we have a POC file
    if (pocFile && pocFile.content) {
        // Update titles and hints to reflect POC source
        if (currentTitle) currentTitle.textContent = 'Key Stakeholders (from POC)';
        if (currentHint) currentHint.textContent = 'Contacts extracted from your uploaded POC document';
        
        // Reset grid to loading state
        resetContactGrid(currentGrid, 'Extracting from POC...');
        
        try {
            // Pass the whole pocFile object (includes name, content, path)
            const result = await window.electronAPI.clients.extractContactsFromPOC(pocFile, client);
            
            if (result.success && result.currentContacts && result.currentContacts.length > 0) {
                populateContactGrid(currentGrid, result.currentContacts, 'current');
            } else {
                resetContactGrid(currentGrid, 'No stakeholders found in POC');
            }
        } catch (error) {
            console.error('Error extracting contacts from POC:', error);
            resetContactGrid(currentGrid, 'Extraction failed');
        }
        
        if (currentLoading) currentLoading.classList.add('hidden');
        
        // Wait for exited research to complete
        await exitedPromise;
        return;
    }
    
    // No POC file - use web search for current executives too
    if (currentTitle) currentTitle.textContent = 'Current C-Suite Executives';
    if (currentHint) currentHint.textContent = 'Live web search for current leadership (researched in background)';
    resetContactGrid(currentGrid, 'Searching web...');
    
    // Research current executives - pass full client context
    try {
        const currentResult = await window.electronAPI.clients.researchContacts(client, 'current');
        if (currentResult.success && currentResult.contacts.length > 0) {
            populateContactGrid(currentGrid, currentResult.contacts, 'current');
        } else {
            resetContactGrid(currentGrid, 'Could not find contacts');
        }
    } catch (error) {
        console.error('Error researching current contacts:', error);
        resetContactGrid(currentGrid, 'Research failed');
    }
    if (currentLoading) currentLoading.classList.add('hidden');
    
    // Wait for exited research to complete
    await exitedPromise;
}

// Reset a contact grid to show placeholder messages
function resetContactGrid(grid, message) {
    if (!grid) return;
    
    const cards = grid.querySelectorAll('.contact-card');
    cards.forEach(card => {
        card.innerHTML = `
            <div class="contact-placeholder">
                <span class="contact-placeholder-text">${message}</span>
            </div>
        `;
    });
}

// Populate a contact grid with researched contacts
function populateContactGrid(grid, contacts, type) {
    if (!grid) return;
    
    const cards = grid.querySelectorAll('.contact-card');
    
    contacts.forEach((contact, index) => {
        if (index >= cards.length) return;
        
        const card = cards[index];
        
        if (type === 'current') {
            card.innerHTML = `
                <div class="contact-content">
                    <div class="contact-name">${escapeHtml(contact.name)}</div>
                    <div class="contact-role">${escapeHtml(contact.title)}</div>
                    <div class="contact-bio">${escapeHtml(contact.bio || '')}</div>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="contact-content">
                    <div class="contact-name">${escapeHtml(contact.name)}</div>
                    <div class="contact-role">${escapeHtml(contact.title)}</div>
                    <div class="contact-bio">${escapeHtml(contact.bio || '')}</div>
                    ${contact.departureDate ? `<div class="contact-date">Left: ${escapeHtml(contact.departureDate)}</div>` : ''}
                </div>
            `;
        }
    });
    
    // Fill remaining cards with "not found" message
    for (let i = contacts.length; i < cards.length; i++) {
        cards[i].innerHTML = `
            <div class="contact-not-found">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <span class="contact-not-found-text">Could not find contact</span>
            </div>
        `;
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Reset wizard to initial state for starting a new generation
function resetWizard() {
    // Reset generation state
    state.isGenerating = false;
    state.selectedClient = null;
    state.currentSourcePack = null;
    state.pocFile = null;
    state.additionalFiles = [];
    state.placeholderSections = [];
    state.sourceResults = {};
    state.failedSources = [];
    state.pendingGenerationResult = null;
    state.pendingGenerationContext = null;
    state.generationStartTime = null;
    
    // Reset UI elements
    const clientSearch = document.getElementById('clientSearch');
    if (clientSearch) clientSearch.value = '';
    
    // Reset client grid selection
    document.querySelectorAll('.client-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Reset context form
    const contextForm = document.getElementById('contextForm');
    if (contextForm) contextForm.reset();
    
    // Reset POC file display
    const pocEmpty = document.getElementById('pocEmpty');
    const pocFileInfo = document.getElementById('pocFileInfo');
    if (pocEmpty) pocEmpty.classList.remove('hidden');
    if (pocFileInfo) pocFileInfo.classList.add('hidden');
    
    // Reset contact grids (now in Step 6)
    const currentContactsGrid = document.getElementById('currentContactsGrid');
    const exitedContactsGrid = document.getElementById('exitedContactsGrid');
    resetContactGrid(currentContactsGrid, 'Searching...');
    resetContactGrid(exitedContactsGrid, 'Searching...');
    
    // Reset additional files section
    const addedFilesSection = document.getElementById('addedFilesSection');
    const addedFilesList = document.getElementById('addedFilesList');
    if (addedFilesSection) addedFilesSection.classList.add('hidden');
    if (addedFilesList) addedFilesList.innerHTML = '';
    
    // Reset progress stages
    document.querySelectorAll('.progress-stage .stage-indicator').forEach(indicator => {
        indicator.className = 'stage-indicator pending';
    });
    document.querySelectorAll('.progress-stage .stage-status').forEach(status => {
        status.textContent = '';
    });
    
    // Reset review container
    const reviewContainer = document.getElementById('reviewContainer');
    if (reviewContainer) reviewContainer.innerHTML = '';
    
    // Reset narrative container
    const narrativeContainer = document.getElementById('narrativeContainer');
    if (narrativeContainer) narrativeContainer.innerHTML = '';
    
    // Reset elapsed time
    if (elements.elapsedTime) elements.elapsedTime.textContent = '0:00';
    
    // Reset progress message
    if (elements.progressMessage) elements.progressMessage.textContent = 'Initializing...';
    
    // Render client grid fresh
    renderClientGrid();
    
    // Go back to step 1
    goToStep(1);
    
    console.log('Wizard reset - ready for new generation');
}

// ============================================
// Source Pack Generation
// ============================================
async function startGeneration() {
    if (!state.selectedClient) {
        showToast('Please select a client first', 'error');
        return;
    }
    
    state.isGenerating = true;
    state.generationStartTime = Date.now();
    
    // Go to step 3
    goToStep(3);
    
    // Reset progress stages
    document.querySelectorAll('.progress-stage .stage-indicator').forEach(indicator => {
        indicator.className = 'stage-indicator pending';
    });
    document.querySelectorAll('.progress-stage .stage-status').forEach(status => {
        status.textContent = '';
    });
    
    // Start timer
    const timerInterval = setInterval(() => {
        if (!state.isGenerating) {
            clearInterval(timerInterval);
            return;
        }
        const elapsed = Math.floor((Date.now() - state.generationStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        elements.elapsedTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
    
    // Listen for progress updates from main process
    if (state.isElectron && window.electronAPI.onGenerationProgress) {
        window.electronAPI.onGenerationProgress((data) => {
            elements.progressMessage.textContent = data.message;
            // Update progress bar visually
            const progressFill = document.querySelector('.progress-bar-fill');
            if (progressFill) {
                progressFill.style.width = `${data.percent}%`;
            }
            // Update stage based on type with progress
            if (data.stage === 'alphasense') {
                // Check if message indicates real API usage or placeholder
                const isPlaceholder = data.message && data.message.includes('PLACEHOLDER');
                updateStageStatus('alphasense', isPlaceholder ? 'placeholder' : 'in-progress', data.stageProgress || 50);
            } else if (data.stage === 'arc') {
                updateStageStatus('arc', 'placeholder', 50);
            } else if (data.stage === 'deepresearch') {
                updateStageStatus('internet', 'in-progress', data.stageProgress || 0);
            } else if (data.stage === 'normalize') {
                updateStageStatus('normalize', 'in-progress', data.stageProgress || 0);
            } else if (data.stage === 'additional') {
                updateStageStatus('normalize', 'complete', 100);
                updateStageStatus('complete', 'in-progress', data.stageProgress || 0);
            } else if (data.stage === 'complete') {
                updateStageStatus('complete', 'complete', 100);
            }
        });
    }
    
    try {
        // Get form data
        const formData = new FormData(elements.contextForm);
        const context = {
            industry: formData.get('industry') || state.selectedClient.industry,
            subSector: state.selectedClient.sector,
            geography: formData.get('geography') || state.selectedClient.geography,
            timeHorizon: parseInt(formData.get('timeHorizon')) || 90,
            outputIntent: formData.get('outputIntent') || 'CEO Narrative',
            fastGenerate: document.getElementById('fastGenerateCheckbox')?.checked || false
        };
        
        // Log fast generate mode
        if (context.fastGenerate) {
            console.log('[Generation] Fast Generate mode enabled - using cheaper models');
        }
        
        // Show initial stages with progress animation
        updateStageStatus('auth', 'in-progress', 0);
        elements.progressMessage.textContent = 'Authenticating to data sources...';
        await sleep(200);
        updateStageProgress('auth', 50);
        await sleep(300);
        updateStageStatus('auth', 'complete', 100);
        
        // AlphaSense - Check if configured (progress updates will show actual status)
        updateStageStatus('alphasense', 'in-progress', 0);
        elements.progressMessage.textContent = 'Initialising AlphaSense...';
        await sleep(150);
        
        updateStageStatus('arc', 'in-progress', 0);
        elements.progressMessage.textContent = 'ARC Database [PLACEHOLDER - API not configured]';
        await sleep(150);
        updateStageStatus('arc', 'placeholder', 50);
        
        // Make IPC call to generate ZIP source pack
        let result;
        
        if (state.isElectron) {
            updateStageStatus('internet', 'in-progress', 0);
            elements.progressMessage.textContent = 'Compiling deep research report...';
            
            result = await window.electronAPI.sourcePack.generateZip(
                state.selectedClient.id,
                context
            );
        } else {
            // Fallback simulation
            result = await simulateSourcePackGeneration(context);
        }
        
        if (result.success) {
            updateStageStatus('internet', 'complete', 100);
            updateStageStatus('normalize', 'complete', 100);
            updateStageStatus('complete', 'complete', 100);
            
            // Store pending generation info
            state.pendingGenerationResult = result;
            state.pendingGenerationContext = context;
            
            // Store placeholder sections for manual replacement
            state.placeholderSections = result.placeholderSections || [];
            
            // Store source results for Step 4 status display
            state.sourceResults = result.sourceResults || {};
            state.failedSources = result.failedSources || [];
            
            // Add POC file to source pack if one was uploaded in Step 2
            if (state.pocFile && state.isElectron) {
                try {
                    const pocResult = await window.electronAPI.sourcePack.addPocFile({
                        name: state.pocFile.name,
                        content: state.pocFile.content
                    });
                    if (pocResult.success) {
                        console.log('[SourcePack] POC file added:', pocResult.fileName);
                    } else {
                        console.error('[SourcePack] Failed to add POC file:', pocResult.error);
                    }
                } catch (pocError) {
                    console.error('[SourcePack] Error adding POC file:', pocError);
                }
            }
            
            // Move to Step 4 (Add Documents)
            goToStep(4);
            resetAddDocumentsStep();
            
            showToast('Research complete! Add any additional documents or continue.', 'success');
        } else if (result.canceled) {
            showToast('Generation cancelled', 'info');
            goToStep(2);
        } else {
            throw new Error(result.error || 'Generation failed');
        }
        
    } catch (error) {
        console.error('Generation failed:', error);
        showToast('Generation failed: ' + error.message, 'error');
        goToStep(2);
    } finally {
        state.isGenerating = false;
        clearInterval(timerInterval);
    }
}

// ============================================
// Step 4: Add Documents
// ============================================
function resetAddDocumentsStep() {
    state.additionalFiles = [];
    updateAddedFilesList();
    updateProceedButtonText();
    
    // Reset drop zone state
    if (elements.documentDropZone) {
        elements.documentDropZone.classList.remove('drag-over');
    }
    
    // Render source status cards
    renderSourceStatusGrid();
    
    // Render placeholder sections that need replacement
    renderPlaceholderItems();
}

// Render the source status grid showing which sources succeeded/failed
function renderSourceStatusGrid() {
    const sourceStatusGrid = document.getElementById('sourceStatusGrid');
    if (!sourceStatusGrid) return;
    
    // Get source results from state (set during generation)
    const sourceResults = state.sourceResults || {};
    const hasPoc = !!state.pocFile;
    
    // Define the 4 expected sources
    const sources = [
        { 
            id: 'chatgpt', 
            name: 'ChatGPT Research', 
            icon: 'sparkles',
            result: sourceResults.chatgpt 
        },
        { 
            id: 'arc', 
            name: 'ARC Assets', 
            icon: 'cube',
            result: sourceResults.arc 
        },
        { 
            id: 'alphasense', 
            name: 'AlphaSense Market', 
            icon: 'chart',
            result: sourceResults.alphasense 
        },
        { 
            id: 'poc', 
            name: 'Client PoC Document', 
            icon: 'user',
            result: { success: hasPoc, error: hasPoc ? null : 'Not uploaded' }
        }
    ];
    
    sourceStatusGrid.innerHTML = sources.map(source => {
        const isSuccess = source.result?.success;
        const statusClass = isSuccess ? 'success' : 'warning';
        const statusIcon = isSuccess ? 
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' :
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01"></path></svg>';
        const statusText = isSuccess ? 'Generated' : (source.result?.error || 'Failed');
        
        // Source-specific icons
        const icons = {
            sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/></svg>',
            cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
            chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18M7 12v5M12 8v9M17 14v3"/></svg>',
            user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>'
        };
        
        return `
            <div class="source-status-card ${statusClass}">
                <div class="source-status-icon">
                    ${icons[source.icon]}
                </div>
                <div class="source-status-info">
                    <span class="source-status-name">${source.name}</span>
                    <span class="source-status-result ${statusClass}">
                        ${statusIcon}
                        ${statusText}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function renderPlaceholderItems() {
    const placeholderSection = document.getElementById('placeholderReplacementSection');
    const placeholderList = document.getElementById('placeholderItemsList');
    
    if (!placeholderSection || !placeholderList) return;
    
    // Hide section if no placeholders
    if (!state.placeholderSections || state.placeholderSections.length === 0) {
        placeholderSection.classList.add('hidden');
        return;
    }
    
    // Show section and populate items
    placeholderSection.classList.remove('hidden');
    placeholderList.innerHTML = '';
    
    state.placeholderSections.forEach(placeholder => {
        const item = document.createElement('div');
        item.className = 'placeholder-item';
        item.dataset.placeholderId = placeholder.id;
        item.dataset.fileName = placeholder.fileName;
        
        // Get error reason if available
        const errorReason = placeholder.error || 'Not generated';
        
        item.innerHTML = `
            <div class="placeholder-info">
                <div class="placeholder-name">${placeholder.name}</div>
                <div class="placeholder-error">${errorReason}</div>
                <div class="placeholder-filename">${placeholder.fileName}</div>
            </div>
            <div class="placeholder-actions">
                <input type="file" class="placeholder-file-input" id="placeholder-file-${placeholder.id}" style="display: none;">
                <button class="placeholder-upload-btn" data-placeholder-id="${placeholder.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    Upload Replacement
                </button>
            </div>
        `;
        
        placeholderList.appendChild(item);
        
        // Add event listeners
        const fileInput = item.querySelector('.placeholder-file-input');
        const uploadBtn = item.querySelector('.placeholder-upload-btn');
        
        uploadBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                // Read file content as ArrayBuffer for binary files
                const content = await readFileAsArrayBuffer(file);
                
                // Replace placeholder via IPC - pass the ORIGINAL filename for proper extraction
                const result = await window.electronAPI.sourcePack.replacePlaceholder(
                    placeholder.id,
                    file.name,  // Use actual uploaded filename for proper extraction
                    content
                );
                
                if (result.success) {
                    // Update UI to show replaced state
                    item.classList.add('replaced');
                    item.querySelector('.placeholder-actions').innerHTML = `
                        <div class="placeholder-replaced-status">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Replaced with: ${file.name}
                        </div>
                    `;
                    
                    // Update the placeholder in state to mark as replaced
                    const idx = state.placeholderSections.findIndex(p => p.id === placeholder.id);
                    if (idx !== -1) {
                        state.placeholderSections[idx].replaced = true;
                        state.placeholderSections[idx].replacedWith = file.name;
                    }
                    
                    showToast(`Replaced ${placeholder.source} with ${file.name}`, 'success');
                } else {
                    showToast(`Failed to replace: ${result.error}`, 'error');
                }
            } catch (error) {
                console.error('Error replacing placeholder:', error);
                showToast(`Error: ${error.message}`, 'error');
            }
        });
    });
}

// Helper function to read file as text
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
    });
}

function updateAddedFilesList() {
    if (!elements.addedFilesList || !elements.addedFilesSection || !elements.addedFileCount) return;
    
    if (state.additionalFiles.length === 0) {
        elements.addedFilesSection.classList.add('hidden');
        return;
    }
    
    elements.addedFilesSection.classList.remove('hidden');
    elements.addedFileCount.textContent = `${state.additionalFiles.length} file${state.additionalFiles.length !== 1 ? 's' : ''}`;
    
    elements.addedFilesList.innerHTML = state.additionalFiles.map((file, index) => `
        <div class="added-file-item" data-index="${index}">
            <div class="added-file-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <span class="added-file-name">${file.name}</span>
                <span class="added-file-size">${formatFileSize(file.size)}</span>
            </div>
            <button type="button" class="remove-file-btn" data-index="${index}" title="Remove file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `).join('');
    
    // Add remove handlers
    elements.addedFilesList.querySelectorAll('.remove-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.index);
            state.additionalFiles.splice(index, 1);
            updateAddedFilesList();
            updateProceedButtonText();
        });
    });
}

function updateProceedButtonText() {
    if (!elements.proceedWithDocsText) return;
    
    if (state.additionalFiles.length > 0) {
        elements.proceedWithDocsText.textContent = `Continue with ${state.additionalFiles.length} Selected Document${state.additionalFiles.length !== 1 ? 's' : ''}`;
    } else {
        elements.proceedWithDocsText.textContent = 'Continue Without Additional Documents';
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function browseAndAddFiles() {
    if (!state.isElectron) {
        showToast('File selection requires Electron', 'warning');
        return;
    }
    
    try {
        const result = await window.electronAPI.sourcePack.addFiles();
        
        if (result.success && result.addedFiles) {
            // Add to local state
            result.addedFiles.forEach(file => {
                state.additionalFiles.push(file);
            });
            
            updateAddedFilesList();
            updateProceedButtonText();
            
            showToast(`Added ${result.addedFiles.length} file${result.addedFiles.length !== 1 ? 's' : ''}`, 'success');
        } else if (result.canceled) {
            // User cancelled, do nothing
        } else if (result.error) {
            showToast('Failed to add files: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error adding files:', error);
        showToast('Error adding files: ' + error.message, 'error');
    }
}

async function finalizeSourcePack() {
    if (!state.isElectron) {
        showToast('Finalization requires Electron', 'warning');
        return;
    }
    
    try {
        showToast('Creating ZIP file...', 'info');
        
        const result = await window.electronAPI.sourcePack.finalizeZip();
        
        if (result.success) {
            // Store result info for narrative generation
            state.sourcePackResult = result;
            
            // Store in history
            state.generatedPacks.unshift({
                id: result.requestId,
                client: state.selectedClient,
                filePath: result.filePath,
                documentCount: result.documentCount,
                additionalFilesCount: result.additionalFilesCount || 0,
                context: state.pendingGenerationContext,
                sourcePack: { context: state.pendingGenerationContext },
                validation: { status: 'ready', statusLabel: '✅ Ready' },
                generatedAt: new Date().toISOString()
            });
            
            // Persist generated packs to disk
            if (window.electronAPI.appData) {
                window.electronAPI.appData.saveGeneratedPacks(state.generatedPacks);
            }
            
            // Add to activity
            const docText = result.additionalFilesCount > 0 
                ? `${result.documentCount} documents including ${result.additionalFilesCount} additional`
                : `${result.documentCount} documents`;
            addActivity(`Exported Source Pack ZIP for ${state.selectedClient.name} (${docText})`, 'success');
            updateDashboardStats();
            updateHistoryView();
            
            // Clear additional files from state (they're now in the ZIP)
            state.additionalFiles = [];
            
            showToast('Source Pack exported to: ' + result.filePath, 'success');
        } else if (result.canceled) {
            showToast('Export cancelled', 'info');
        } else {
            throw new Error(result.error || 'Export failed');
        }
    } catch (error) {
        console.error('Error exporting source pack:', error);
        showToast('Error creating ZIP: ' + error.message, 'error');
    }
}

// Set up POC Upload listeners (Step 2)
function setupPocUploadListeners() {
    const browsePocBtn = document.getElementById('browsePocBtn');
    const removePocBtn = document.getElementById('removePocBtn');
    const pocEmpty = document.getElementById('pocEmpty');
    const pocFileInfo = document.getElementById('pocFileInfo');
    const pocFileName = document.getElementById('pocFileName');
    const pocFileSize = document.getElementById('pocFileSize');
    
    if (browsePocBtn) {
        browsePocBtn.addEventListener('click', async () => {
            if (!state.isElectron) {
                showToast('File upload requires Electron app', 'error');
                return;
            }
            
            try {
                const result = await window.electronAPI.files.open({
                    title: 'Select Client Point of Contact File',
                    filters: [
                        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt'] }
                    ],
                    properties: ['openFile']
                });
                
                if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    const originalFileName = filePath.split(/[\\/]/).pop();
                    
                    // Extract file extension and rename to poc_info.[ext]
                    const fileExtension = originalFileName.includes('.') 
                        ? originalFileName.substring(originalFileName.lastIndexOf('.'))
                        : '';
                    const renamedFileName = `poc_info${fileExtension}`;
                    
                    // Read file content
                    const fileContent = await window.electronAPI.files.read(filePath);
                    
                    // Store in state with renamed filename
                    state.pocFile = {
                        name: renamedFileName,
                        originalName: originalFileName,
                        path: filePath,
                        content: fileContent,
                        size: fileContent.length || fileContent.byteLength || 0
                    };
                    
                    // Update UI - show original name with rename indicator
                    if (pocEmpty) pocEmpty.classList.add('hidden');
                    if (pocFileInfo) pocFileInfo.classList.remove('hidden');
                    if (pocFileName) pocFileName.textContent = `${originalFileName} → ${renamedFileName}`;
                    if (pocFileSize) pocFileSize.textContent = formatFileSize(state.pocFile.size);
                    
                    showToast('POC file added', 'success');
                }
            } catch (error) {
                console.error('Error adding POC file:', error);
                showToast('Error adding file: ' + error.message, 'error');
            }
        });
    }
    
    if (removePocBtn) {
        removePocBtn.addEventListener('click', () => {
            // Clear state
            state.pocFile = null;
            
            // Update UI
            if (pocEmpty) pocEmpty.classList.remove('hidden');
            if (pocFileInfo) pocFileInfo.classList.add('hidden');
            if (pocFileName) pocFileName.textContent = '';
            if (pocFileSize) pocFileSize.textContent = '';
            
            showToast('POC file removed', 'info');
        });
    }
}

// Format file size for display
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Reset POC upload UI to empty state
function resetPocUploadUI() {
    const pocEmpty = document.getElementById('pocEmpty');
    const pocFileInfo = document.getElementById('pocFileInfo');
    const pocFileName = document.getElementById('pocFileName');
    const pocFileSize = document.getElementById('pocFileSize');
    
    if (pocEmpty) pocEmpty.classList.remove('hidden');
    if (pocFileInfo) pocFileInfo.classList.add('hidden');
    if (pocFileName) pocFileName.textContent = '';
    if (pocFileSize) pocFileSize.textContent = '';
}

// Set up Step 4 event listeners
function setupAddDocumentsListeners() {
    // Browse files button
    if (elements.browseFilesBtn) {
        elements.browseFilesBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drop zone click from also firing
            browseAndAddFiles();
        });
    }
    
    // Drop zone click (but not on the button)
    if (elements.documentDropZone) {
        elements.documentDropZone.addEventListener('click', (e) => {
            // Only trigger if clicking the drop zone itself, not the button
            if (e.target.closest('#browseFilesBtn')) return;
            if (e.target === elements.documentDropZone || e.target.closest('.drop-zone-content')) {
                browseAndAddFiles();
            }
        });
        
        // Drag and drop handlers
        elements.documentDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            elements.documentDropZone.classList.add('drag-over');
        });
        
        elements.documentDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            elements.documentDropZone.classList.remove('drag-over');
        });
        
        elements.documentDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            elements.documentDropZone.classList.remove('drag-over');
            // Note: Direct file drop requires more complex handling in Electron
            // For now, prompt user to use the browse button
            showToast('Please use the Browse Files button to add documents', 'info');
        });
    }
    
    // Proceed button - just moves to review, doesn't finalize/download
    if (elements.proceedWithDocs) {
        elements.proceedWithDocs.addEventListener('click', proceedToSourceChat);
    }
}

// Move from step 4 to step 5 (Source Chat)
function proceedToSourceChat() {
    // Move to Step 5 (Source Chat)
    goToStep(5);
    
    // Initialize the source chat
    initializeSourceChat();
    
    // Save to history (so it appears even if user doesn't export)
    saveToHistory();
}

// Save current source pack to history
function saveToHistory() {
    if (!state.pendingGenerationResult || !state.selectedClient) return;
    
    // Check if this pack is already in history
    const existingIndex = state.generatedPacks.findIndex(p => 
        p.id === state.pendingGenerationResult.requestId
    );
    
    if (existingIndex >= 0) {
        // Already in history, skip
        return;
    }
    
    // Add to history
    const historyEntry = {
        id: state.pendingGenerationResult.requestId || 'pack_' + Date.now(),
        client: state.selectedClient,
        context: state.pendingGenerationContext,
        sourcePack: { context: state.pendingGenerationContext },
        validation: { status: 'ready', statusLabel: '✅ Ready' },
        generatedAt: new Date().toISOString()
    };
    
    state.generatedPacks.unshift(historyEntry);
    
    // Persist to disk
    if (state.isElectron && window.electronAPI?.appData) {
        window.electronAPI.appData.saveGeneratedPacks(state.generatedPacks);
    }
    
    // Update UI
    updateDashboardStats();
    updateHistoryView();
    
    console.log('[History] Saved pack to history:', historyEntry.id);
}

// ============================================
// Step 5: Narrative Builder - Guided Prompt Creation
// ============================================

// Narrative Builder state
const sourceChat = {
    messages: [],
    isProcessing: false,
    initialized: false,
    generatedPrompt: null  // Will hold the final generated prompt
};

// Initialize Narrative Builder for Step 5
function initializeSourceChat() {
    console.log('[NarrativeBuilder] Initializing...');
    
    // Update context display
    const sourceCountEl = document.getElementById('chatSourceCount');
    const clientNameEl = document.getElementById('chatClientName');
    
    // Count sources
    let sourceCount = 0;
    if (state.sourceResults?.chatgpt?.success) sourceCount++;
    if (state.sourceResults?.arc?.success) sourceCount++;
    if (state.sourceResults?.alphasense?.success) sourceCount++;
    if (state.pocFile) sourceCount++;
    sourceCount += state.additionalFiles?.length || 0;
    
    if (sourceCountEl) {
        sourceCountEl.textContent = `${sourceCount} source${sourceCount !== 1 ? 's' : ''} loaded`;
    }
    
    if (clientNameEl) {
        clientNameEl.textContent = state.selectedClient?.name || '--';
    }
    
    // Store doc count for later
    state.sourcePackDocCount = `${sourceCount} documents`;
    state.sourcePackGenDate = new Date().toLocaleString();
    
    // Setup event listeners (only once)
    if (!sourceChat.initialized) {
        setupSourceChatListeners();
        sourceChat.initialized = true;
    }
    
    // Reset and start the guided conversation
    resetChatMessages();
    startNarrativeBuilderConversation();
}

// Setup Narrative Builder event listeners
function setupSourceChatListeners() {
    const sendBtn = document.getElementById('sourceChatSendBtn');
    const input = document.getElementById('sourceChatInput');
    const backBtn = document.getElementById('backToAddDocsBtn');
    const exportBtn = document.getElementById('exportSourcePackBtn');
    const skipBtn = document.getElementById('skipBuilderBtn');
    const usePromptBtn = document.getElementById('usePromptBtn');
    const editPromptBtn = document.getElementById('editPromptBtn');
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendSourceChatMessage);
    }
    
    if (input) {
        // Enter to send, Shift+Enter for new line
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendSourceChatMessage();
            }
        });
        
        // Auto-resize textarea
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
    }
    
    if (backBtn) {
        backBtn.addEventListener('click', () => goToStep(4));
    }
    
    if (exportBtn) {
        exportBtn.addEventListener('click', finalizeSourcePack);
    }
    
    if (skipBtn) {
        skipBtn.addEventListener('click', () => {
            goToStep(6);
            populateNarrativeStep();
        });
    }
    
    if (usePromptBtn) {
        usePromptBtn.addEventListener('click', () => {
            if (sourceChat.generatedPrompt) {
                // Store the generated prompt to inject into Step 6
                state.narrativeBuilderPrompt = sourceChat.generatedPrompt;
                goToStep(6);
                populateNarrativeStep();
            }
        });
    }
    
    if (editPromptBtn) {
        editPromptBtn.addEventListener('click', () => {
            if (sourceChat.generatedPrompt) {
                state.narrativeBuilderPrompt = sourceChat.generatedPrompt;
                goToStep(6);
                populateNarrativeStep();
            }
        });
    }
}

// Reset chat messages to initial state (shows loading while we get AI opening)
function resetChatMessages() {
    const messagesContainer = document.getElementById('sourceChatMessages');
    if (!messagesContainer) return;
    
    sourceChat.messages = [];
    sourceChat.generatedPrompt = null;
    
    // Hide the prompt preview if visible
    const promptPreview = document.getElementById('generatedPromptPreview');
    if (promptPreview) {
        promptPreview.classList.add('hidden');
    }
    
    // Show loading state while we get the AI's opening message
    messagesContainer.innerHTML = `
        <div class="chat-message assistant">
            <div class="chat-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                </svg>
            </div>
            <div class="chat-content">
                <div class="chat-bubble">
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                </div>
            </div>
        </div>
    `;
}

// Start the guided conversation with an AI-generated opening
async function startNarrativeBuilderConversation() {
    const messagesContainer = document.getElementById('sourceChatMessages');
    if (!messagesContainer) return;
    
    try {
        let response;
        
        if (state.isElectron && window.electronAPI?.sourceChat?.startConversation) {
            response = await window.electronAPI.sourceChat.startConversation();
        } else {
            // Fallback for non-Electron
            await sleep(1000);
            response = {
                success: true,
                message: `Hello! I've analyzed your source documents for **${state.selectedClient?.name || 'your client'}** and I'm excited to help you craft the perfect narrative.\n\nI noticed some interesting themes in your sources that we could explore. Before we dive in, I'd love to understand what kind of narrative angle would resonate most with your audience:\n\n• **Value Driver** - Focus on specific business value and growth opportunities\n• **Divergent Scenario** - Explore alternative futures and strategic pivots\n• **Human/C-suite Dynamics** - Center on leadership challenges and organizational dynamics\n\nWhich of these directions interests you most?`
            };
        }
        
        // Clear the loading state
        messagesContainer.innerHTML = '';
        
        if (response.success) {
            addChatMessage('assistant', response.message);
        } else {
            addChatMessage('assistant', `I'm ready to help you build your narrative prompt. Let's start with the basics - what kind of narrative would you like to create?\n\n• **Value Driver** - Focus on business value and growth\n• **Divergent Scenario** - Explore alternative futures\n• **Human/C-suite Dynamics** - Leadership and organizational focus`);
        }
        
    } catch (error) {
        console.error('[NarrativeBuilder] Error starting conversation:', error);
        messagesContainer.innerHTML = '';
        addChatMessage('assistant', `Let's build your narrative prompt together! What kind of narrative angle interests you most?\n\n• **Value Driver** - Business value and growth opportunities\n• **Divergent Scenario** - Alternative futures and strategic pivots\n• **Human/C-suite Dynamics** - Leadership and organizational dynamics`);
    }
}

// Send a message in the Narrative Builder chat
async function sendSourceChatMessage() {
    const input = document.getElementById('sourceChatInput');
    const messagesContainer = document.getElementById('sourceChatMessages');
    
    if (!input || !messagesContainer) return;
    
    const message = input.value.trim();
    if (!message || sourceChat.isProcessing) return;
    
    sourceChat.isProcessing = true;
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Add user message to UI
    addChatMessage('user', message);
    
    // Add typing indicator
    const typingEl = addTypingIndicator();
    
    try {
        let response;
        
        if (state.isElectron && window.electronAPI?.sourceChat) {
            response = await window.electronAPI.sourceChat.sendMessage(message);
        } else {
            // Fallback simulation
            await sleep(1500);
            response = {
                success: true,
                message: "I'm sorry, the Narrative Builder requires the Electron backend to be connected."
            };
        }
        
        // Remove typing indicator
        typingEl?.remove();
        
        if (response.success) {
            // Check if response contains a generated prompt
            if (response.generatedPrompt) {
                sourceChat.generatedPrompt = response.generatedPrompt;
                
                // Clean the message by removing the prompt markers for display
                const cleanMessage = response.message
                    .replace(/===NARRATIVE_PROMPT_START===[\s\S]*?===NARRATIVE_PROMPT_END===/, '')
                    .trim();
                
                if (cleanMessage) {
                    addChatMessage('assistant', cleanMessage);
                }
                
                // Show the generated prompt preview
                showGeneratedPromptPreview(response.generatedPrompt);
            } else {
                addChatMessage('assistant', response.message);
            }
        } else {
            addChatMessage('assistant', `Sorry, I encountered an error: ${response.error || 'Unknown error'}`);
        }
        
    } catch (error) {
        console.error('[NarrativeBuilder] Error:', error);
        typingEl?.remove();
        addChatMessage('assistant', `Sorry, I encountered an error: ${error.message}`);
    } finally {
        sourceChat.isProcessing = false;
    }
}

// Show the generated prompt preview panel
function showGeneratedPromptPreview(prompt) {
    const previewContainer = document.getElementById('generatedPromptPreview');
    const promptContent = document.getElementById('generatedPromptContent');
    
    if (!previewContainer || !promptContent) return;
    
    // Format the prompt for display (convert markdown-like to HTML)
    const formattedPrompt = prompt
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    
    promptContent.innerHTML = formattedPrompt;
    previewContainer.classList.remove('hidden');
    
    // Scroll the preview into view
    previewContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    showToast('Narrative prompt generated! Review and use it below.', 'success');
}

// Add a chat message to the UI
function addChatMessage(role, content) {
    const messagesContainer = document.getElementById('sourceChatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}`;
    
    const avatarIcon = role === 'assistant' 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>';
    
    // Convert markdown-like formatting to HTML
    const formattedContent = formatChatContent(content);
    
    messageEl.innerHTML = `
        <div class="chat-avatar">${avatarIcon}</div>
        <div class="chat-content">
            <div class="chat-bubble">${formattedContent}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Store in messages array
    sourceChat.messages.push({ role, content });
}

// Format chat content (basic markdown support)
function formatChatContent(content) {
    if (!content) return '';
    
    return content
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Line breaks
        .replace(/\n/g, '<br>');
}

// Add typing indicator
function addTypingIndicator() {
    const messagesContainer = document.getElementById('sourceChatMessages');
    if (!messagesContainer) return null;
    
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message assistant typing';
    typingEl.id = 'typingIndicator';
    typingEl.innerHTML = `
        <div class="chat-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
        </div>
        <div class="chat-content">
            <div class="chat-bubble">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(typingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return typingEl;
}

// ============================================
// Step 6: Narrative Generation
// ============================================

// Initialize narrative step
let narrativeListenersSetup = false;  // Prevent duplicate listeners

function setupNarrativeListeners() {
    // Prevent adding duplicate listeners
    if (narrativeListenersSetup) {
        console.log('[Narrative] Listeners already set up, skipping');
        return;
    }
    narrativeListenersSetup = true;
    console.log('[Narrative] Setting up listeners...');
    
    // Back button
    const backBtn = document.getElementById('backToReviewBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => goToStep(5));
    }
    
    // Generate narrative button
    const generateBtn = document.getElementById('generateNarrativeBtn');
    if (generateBtn) {
        console.log('[Narrative] Found generate button, adding click listener');
        generateBtn.addEventListener('click', () => {
            console.log('[Narrative] Button clicked!');
            generateNarrative();
        });
    } else {
        console.warn('[Narrative] Generate button not found!');
    }
    
    // Cancel narrative button
    const cancelNarrativeBtn = document.getElementById('cancelNarrativeBtn');
    if (cancelNarrativeBtn) {
        cancelNarrativeBtn.addEventListener('click', () => {
            console.log('[Narrative] Cancel clicked!');
            cancelNarrativeGeneration();
        });
    }
    
    // Download workshop materials button
    const workshopBtn = document.getElementById('downloadWorkshopBtn');
    if (workshopBtn) {
        console.log('[Workshop] Found workshop button, adding click listener');
        workshopBtn.addEventListener('click', () => {
            console.log('[Workshop] Button clicked!');
            downloadWorkshopMaterials();
        });
    } else {
        console.warn('[Workshop] Workshop button not found!');
    }
    
    // Copy narrative button
    const copyBtn = document.getElementById('copyNarrativeBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyNarrativeToClipboard);
    }
    
    // Download narrative as Word button
    const downloadBtn = document.getElementById('downloadNarrativeBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            // The narrative was already saved as a Word doc during generation
            // This button can trigger a re-download or just notify
            showToast('Use "Generate Narrative" to create a new Word document', 'info');
        });
    }
    
    // Export Source Pack button on Step 6
    const exportBtn = document.getElementById('exportSourcePackBtnStep6');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportSourcePackFromStep6);
    }
    
    // Generate Client Intel Pack button
    const intelPackBtn = document.getElementById('generateIntelPackBtn');
    if (intelPackBtn) {
        console.log('[Intel Pack] Found button, adding click listener');
        intelPackBtn.addEventListener('click', () => {
            console.log('[Intel Pack] Button clicked!');
            generateClientIntelPack();
        });
    }
}

// Populate narrative step with current source pack info
async function populateNarrativeStep() {
    // Update source pack summary
    document.getElementById('narrativeClientName').textContent = state.selectedClient?.name || '--';
    document.getElementById('narrativeDocCount').textContent = state.sourcePackDocCount || '--';
    document.getElementById('narrativeGenDate').textContent = state.sourcePackGenDate || '--';
    
    const promptTextarea = document.getElementById('narrativeAgentPrompt');
    
    // Check if we have a prompt from the Narrative Builder
    if (promptTextarea && state.narrativeBuilderPrompt) {
        promptTextarea.value = state.narrativeBuilderPrompt;
        // Clear the stored prompt so it doesn't persist across sessions
        state.narrativeBuilderPrompt = null;
        showToast('Narrative prompt loaded from builder', 'success');
    } 
    // Otherwise, pre-populate with default from admin settings
    else if (promptTextarea && state.isElectron && window.electronAPI.settings) {
        try {
            const defaultPrompt = await window.electronAPI.settings.getDefaultPrompt();
            if (defaultPrompt) {
                promptTextarea.value = defaultPrompt;
            }
        } catch (error) {
            console.error('Error loading default prompt:', error);
        }
    }
    
    // Load narratives for this client
    if (state.selectedClient?.id) {
        await loadClientNarratives(state.selectedClient.id);
    } else {
        hideNarrativeDisplay();
    }
    
    // Setup listeners if not already done
    setupNarrativeListeners();
}

// (Template functions removed - narrative is now driven by agent prompt only)

// Track if narrative generation should be cancelled
let narrativeGenerationCancelled = false;
let narrativeAbortController = null;

// Cancel narrative generation
function cancelNarrativeGeneration() {
    narrativeGenerationCancelled = true;
    if (narrativeAbortController) {
        narrativeAbortController.abort();
    }
    
    // Notify backend to cancel
    if (state.isElectron && window.electronAPI?.narrative?.cancel) {
        window.electronAPI.narrative.cancel();
    }
    
    // Reset UI
    const btn = document.getElementById('generateNarrativeBtn');
    const btnText = document.getElementById('generateNarrativeText');
    const cancelBtn = document.getElementById('cancelNarrativeBtn');
    
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Generate Narrative';
    if (cancelBtn) cancelBtn.classList.add('hidden');
    
    showToast('Narrative generation cancelled', 'info');
}

// Generate narrative document
async function generateNarrative() {
    console.log('[Narrative] Generate button clicked');
    
    // Reset cancellation flag
    narrativeGenerationCancelled = false;
    narrativeAbortController = new AbortController();
    
    const agentPrompt = document.getElementById('narrativeAgentPrompt')?.value || '';
    
    console.log('[Narrative] Agent prompt length:', agentPrompt?.length || 0);
    
    if (!agentPrompt || agentPrompt.trim().length < 10) {
        showToast('Please enter narrative instructions', 'warning');
        return;
    }
    
    const btn = document.getElementById('generateNarrativeBtn');
    const btnText = document.getElementById('generateNarrativeText');
    const cancelBtn = document.getElementById('cancelNarrativeBtn');
    
    // Immediately show generating state
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Generating...';
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    showToast('Starting narrative generation...', 'info');
    
    console.log('[Narrative] State check - isElectron:', state.isElectron);
    console.log('[Narrative] State check - electronAPI.narrative:', !!window.electronAPI?.narrative);
    console.log('[Narrative] Selected client:', state.selectedClient?.name);
    console.log('[Narrative] Current context:', state.currentContext);
    
    try {
        if (state.isElectron && window.electronAPI?.narrative) {
            console.log('[Narrative] Calling electronAPI.narrative.generate...');
            const result = await window.electronAPI.narrative.generate({
                agentPrompt,
                sourcePackPath: state.sourcePackResult?.filePath,
                client: state.selectedClient,
                context: state.currentContext
            });
            
            console.log('[Narrative] Result:', result);
            
            if (result.success) {
                showToast('Narrative document generated successfully!', 'success');
                
                // Save the narrative for this client
                if (result.content && state.selectedClient?.id) {
                    const newNarrative = {
                        id: 'narr_' + Date.now(),
                        content: result.content,
                        timestamp: new Date().toISOString(),
                        outputIntent: result.outputIntent,
                        wordCount: result.content?.split(/\s+/).length || 0
                    };
                    
                    await saveNarrative(state.selectedClient.id, {
                        content: result.content,
                        outputIntent: result.outputIntent
                    });
                    
                    // Also add to the overall history for quick access
                    addNarrativeToOverallHistory(newNarrative);
                    
                    // Reload narrative history (but don't auto-display)
                    await loadClientNarratives(state.selectedClient.id);
                    
                    // Now display the newly generated narrative
                    displayNarrative(newNarrative);
                }
            } else if (result.canceled) {
                showToast('Narrative generation canceled', 'info');
            } else {
                showToast(result.error || 'Failed to generate narrative', 'error');
            }
        } else {
            console.log('[Narrative] Running in demo mode');
            // Demo mode
            await sleep(2000);
            showToast('Narrative document generated (Demo Mode)', 'success');
        }
    } catch (error) {
        console.error('[Narrative] Error generating narrative:', error);
        if (!narrativeGenerationCancelled) {
            showToast('Failed to generate narrative: ' + error.message, 'error');
        }
    } finally {
        const cancelBtn = document.getElementById('cancelNarrativeBtn');
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'Generate Narrative';
        if (cancelBtn) cancelBtn.classList.add('hidden');
        narrativeGenerationCancelled = false;
        narrativeAbortController = null;
    }
}

// ============================================
// Narrative Display & History
// ============================================

// Save narrative to persistent storage
async function saveNarrative(clientId, narrative) {
    if (!state.isElectron || !window.electronAPI?.narratives) {
        console.log('[Narrative] Demo mode - not saving');
        return;
    }
    
    try {
        const result = await window.electronAPI.narratives.save(clientId, narrative);
        console.log('[Narrative] Saved:', result);
        return result;
    } catch (error) {
        console.error('[Narrative] Error saving:', error);
    }
}

// Export Source Pack from Step 6 (reuses the same logic as Step 5)
async function exportSourcePackFromStep6() {
    if (!state.isElectron || !window.electronAPI?.sourcePack) {
        showToast('Export only available in desktop app', 'info');
        return;
    }
    
    const btn = document.getElementById('exportSourcePackBtnStep6');
    const originalText = btn?.querySelector('span')?.textContent;
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.querySelector('span').textContent = 'Exporting...';
        }
        
        // Additional files are already included in the source pack from Step 4
        // Just finalize and export the zip
        const result = await window.electronAPI.sourcePack.finalizeZip();
        
        if (result.success) {
            state.sourcePackResult = result;
            showToast('Source Pack exported to: ' + result.filePath, 'success');
        } else if (result.canceled) {
            showToast('Export cancelled', 'info');
        } else {
            throw new Error(result.error || 'Export failed');
        }
    } catch (error) {
        console.error('[Export] Error:', error);
        showToast('Export failed: ' + error.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.querySelector('span').textContent = originalText || 'Export Source Pack';
        }
    }
}

// Load narratives for a client
async function loadClientNarratives(clientId) {
    if (!state.isElectron || !window.electronAPI?.narratives) {
        return [];
    }
    
    try {
        const narratives = await window.electronAPI.narratives.getForClient(clientId);
        console.log('[Narrative] Loaded', narratives?.length || 0, 'narratives for client');
        
        // Store in state
        state.clientNarratives = narratives || [];
        
        // Render the history list
        renderNarrativeHistory(narratives);
        
        // Don't auto-display latest narrative - leave blank until user generates or clicks one
        // Only show history section
        hideNarrativeDisplay();
        
        return narratives;
    } catch (error) {
        console.error('[Narrative] Error loading narratives:', error);
        return [];
    }
}

// Display a narrative in the display section
function displayNarrative(narrative) {
    const section = document.getElementById('narrativeDisplaySection');
    const contentDiv = document.getElementById('narrativeDisplayContent');
    const timestampSpan = document.getElementById('narrativeTimestamp');
    const audioSection = document.getElementById('narrativeAudioSection');
    const videoSection = document.getElementById('narrativeVideoSection');
    const intelPackSection = document.getElementById('clientIntelPackSection');
    
    if (!section || !contentDiv) return;
    
    // Show the section
    section.style.display = 'block';
    
    // Show the audio generation section
    if (audioSection) {
        audioSection.style.display = 'block';
        // Reset audio section state
        resetNarrativeAudioSection();
    }
    
    // Show the video narrative generation section
    if (videoSection) {
        videoSection.style.display = 'block';
        // Reset video section state
        resetVideoNarrativeSection();
    }
    
    // Show the Client Intel Pack section
    if (intelPackSection) {
        intelPackSection.style.display = 'block';
        // Reset intel pack section state
        resetIntelPackSection();
    }
    
    // Format timestamp
    if (timestampSpan && narrative.timestamp) {
        const date = new Date(narrative.timestamp);
        timestampSpan.textContent = date.toLocaleString();
    }
    
    // Render markdown content as HTML
    const htmlContent = renderMarkdownToHtml(narrative.content || '');
    contentDiv.innerHTML = htmlContent;
    
    // Store current narrative
    state.currentDisplayedNarrative = narrative;
    
    // Update active state in history list
    updateNarrativeHistoryActiveState(narrative.id);
    
    // Initialize narrative chat
    initializeNarrativeChat(narrative.content);
}

// ============================================
// Narrative Chat - Q&A with Sources + Narrative
// ============================================

const narrativeChat = {
    messages: [],
    isProcessing: false,
    initialized: false,
    currentNarrativeContent: null
};

// Initialize narrative chat for the displayed narrative
function initializeNarrativeChat(narrativeContent) {
    console.log('[NarrativeChat] Initializing...');
    
    narrativeChat.currentNarrativeContent = narrativeContent;
    
    // Setup event listeners (only once)
    if (!narrativeChat.initialized) {
        setupNarrativeChatListeners();
        narrativeChat.initialized = true;
    }
    
    // Reset chat messages
    resetNarrativeChatMessages();
    
    // Reset backend history
    if (state.isElectron && window.electronAPI?.narrativeChat?.reset) {
        window.electronAPI.narrativeChat.reset();
    }
}

// Setup narrative chat event listeners
function setupNarrativeChatListeners() {
    const sendBtn = document.getElementById('narrativeChatSendBtn');
    const input = document.getElementById('narrativeChatInput');
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendNarrativeChatMessage);
    }
    
    if (input) {
        // Enter to send, Shift+Enter for new line
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendNarrativeChatMessage();
            }
        });
        
        // Auto-resize textarea
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 80) + 'px';
        });
    }
}

// Reset narrative chat messages
function resetNarrativeChatMessages() {
    const messagesContainer = document.getElementById('narrativeChatMessages');
    if (!messagesContainer) return;
    
    narrativeChat.messages = [];
    
    messagesContainer.innerHTML = `
        <div class="chat-message assistant">
            <div class="chat-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
                </svg>
            </div>
            <div class="chat-content">
                <div class="chat-bubble">
                    <p>I can answer questions about the narrative and source documents. Ask me anything!</p>
                </div>
            </div>
        </div>
    `;
}

// Send a message in the narrative chat
async function sendNarrativeChatMessage() {
    const input = document.getElementById('narrativeChatInput');
    const messagesContainer = document.getElementById('narrativeChatMessages');
    
    if (!input || !messagesContainer) return;
    
    const message = input.value.trim();
    if (!message || narrativeChat.isProcessing) return;
    
    narrativeChat.isProcessing = true;
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Add user message to UI
    addNarrativeChatMessage('user', message);
    
    // Add typing indicator
    const typingEl = addNarrativeChatTypingIndicator();
    
    try {
        let response;
        
        if (state.isElectron && window.electronAPI?.narrativeChat) {
            response = await window.electronAPI.narrativeChat.sendMessage(
                message, 
                narrativeChat.currentNarrativeContent
            );
        } else {
            // Fallback simulation
            await sleep(1500);
            response = {
                success: true,
                message: "I'm sorry, the narrative chat feature requires the Electron backend to be connected."
            };
        }
        
        // Remove typing indicator
        typingEl?.remove();
        
        if (response.success) {
            addNarrativeChatMessage('assistant', response.message);
        } else {
            addNarrativeChatMessage('assistant', `Sorry, I encountered an error: ${response.error || 'Unknown error'}`);
        }
        
    } catch (error) {
        console.error('[NarrativeChat] Error:', error);
        typingEl?.remove();
        addNarrativeChatMessage('assistant', `Sorry, I encountered an error: ${error.message}`);
    } finally {
        narrativeChat.isProcessing = false;
    }
}

// Add a message to the narrative chat
function addNarrativeChatMessage(role, content) {
    const messagesContainer = document.getElementById('narrativeChatMessages');
    if (!messagesContainer) return;
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}`;
    
    const avatarIcon = role === 'assistant' 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>';
    
    // Format content
    const formattedContent = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    
    messageEl.innerHTML = `
        <div class="chat-avatar">${avatarIcon}</div>
        <div class="chat-content">
            <div class="chat-bubble">${formattedContent}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    narrativeChat.messages.push({ role, content });
}

// Add typing indicator to narrative chat
function addNarrativeChatTypingIndicator() {
    const messagesContainer = document.getElementById('narrativeChatMessages');
    if (!messagesContainer) return null;
    
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-message assistant typing';
    typingEl.id = 'narrativeChatTypingIndicator';
    typingEl.innerHTML = `
        <div class="chat-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
        </div>
        <div class="chat-content">
            <div class="chat-bubble">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(typingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return typingEl;
}

// Render markdown to HTML (basic conversion)
function renderMarkdownToHtml(markdown) {
    if (!markdown) return '<p class="text-muted">No content</p>';
    
    let html = markdown
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Bullet points
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^• (.+)$/gm, '<li>$1</li>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        // Blockquotes
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        // Paragraphs (double newline)
        .replace(/\n\n/g, '</p><p>')
        // Single newlines in paragraphs
        .replace(/\n/g, '<br>');
    
    // Wrap in paragraph
    html = '<p>' + html + '</p>';
    
    // Clean up list items
    html = html.replace(/<\/p><li>/g, '</p><ul><li>');
    html = html.replace(/<\/li><p>/g, '</li></ul><p>');
    html = html.replace(/<\/li><br><li>/g, '</li><li>');
    
    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');
    
    return html;
}

// Hide narrative display section
function hideNarrativeDisplay() {
    const section = document.getElementById('narrativeDisplaySection');
    if (section) {
        section.style.display = 'none';
    }
}

// Reset Intel Pack section to initial state
function resetIntelPackSection() {
    const btn = document.getElementById('generateIntelPackBtn');
    const loading = document.getElementById('intelPackLoading');
    const success = document.getElementById('intelPackSuccess');
    
    if (btn) btn.style.display = 'flex';
    if (loading) loading.style.display = 'none';
    if (success) success.style.display = 'none';
}

// Generate Client Intel Pack
async function generateClientIntelPack() {
    const btn = document.getElementById('generateIntelPackBtn');
    const loading = document.getElementById('intelPackLoading');
    const success = document.getElementById('intelPackSuccess');
    const downloadLink = document.getElementById('intelPackDownloadLink');
    
    // Get current narrative
    const currentNarrative = state.currentDisplayedNarrative;
    if (!currentNarrative || !currentNarrative.content) {
        showNotification('No narrative available. Please generate a narrative first.', 'error');
        return;
    }
    
    // Get POC document content
    if (!state.pocFile || !state.pocFile.content) {
        showNotification('No POC document found. Please upload a POC document in Step 1.', 'error');
        return;
    }
    
    // Show loading state
    if (btn) btn.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (success) success.style.display = 'none';
    
    try {
        // Call the backend to generate the Intel Pack
        const result = await window.electronAPI.intelPack.generate({
            narrative: currentNarrative.content,
            pocContent: state.pocFile.content,
            clientName: state.selectedClient?.name || 'Client'
        });
        
        if (result.success) {
            // Show success state
            if (loading) loading.style.display = 'none';
            if (success) success.style.display = 'flex';
            
            // Update download link
            if (downloadLink && result.filePath) {
                downloadLink.onclick = () => {
                    window.electronAPI.shell.openPath(result.filePath);
                };
            }
            
            showNotification('Client Intel Pack generated successfully!', 'success');
        } else {
            throw new Error(result.error || 'Failed to generate Intel Pack');
        }
    } catch (error) {
        console.error('Error generating Intel Pack:', error);
        showNotification(`Error generating Intel Pack: ${error.message}`, 'error');
        
        // Reset to button state
        resetIntelPackSection();
    }
}

// Render narrative history list
function renderNarrativeHistory(narratives) {
    const historySection = document.getElementById('narrativeHistorySection');
    const historyList = document.getElementById('narrativeHistoryList');
    const historyCount = document.getElementById('narrativeHistoryCount');
    
    if (!historySection || !historyList) return;
    
    // Show/hide based on count (only show if more than 1 narrative)
    if (!narratives || narratives.length <= 1) {
        historySection.style.display = 'none';
        return;
    }
    
    historySection.style.display = 'block';
    historyCount.textContent = narratives.length;
    
    // Render history items (skip first since it's shown as current)
    historyList.innerHTML = narratives.slice(1).map((narrative, index) => {
        const date = new Date(narrative.timestamp);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="narrative-history-item" data-narrative-id="${narrative.id}" onclick="selectNarrativeFromHistory('${narrative.id}')">
                <div class="narrative-history-item-info">
                    <span class="narrative-history-item-date">${dateStr} at ${timeStr}</span>
                    <span class="narrative-history-item-meta">${narrative.wordCount || 0} words • ${narrative.outputIntent || 'Narrative'}</span>
                </div>
                <div class="narrative-history-item-actions">
                    <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); deleteNarrativeFromHistory('${narrative.id}')" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Select a narrative from history
function selectNarrativeFromHistory(narrativeId) {
    const narrative = state.clientNarratives?.find(n => n.id === narrativeId);
    if (narrative) {
        displayNarrative(narrative);
    }
}

// Update active state in history list
function updateNarrativeHistoryActiveState(activeId) {
    const items = document.querySelectorAll('.narrative-history-item');
    items.forEach(item => {
        if (item.dataset.narrativeId === activeId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// Delete a narrative from history
async function deleteNarrativeFromHistory(narrativeId) {
    if (!confirm('Delete this narrative?')) return;
    
    if (state.isElectron && window.electronAPI?.narratives && state.selectedClient?.id) {
        try {
            await window.electronAPI.narratives.delete(state.selectedClient.id, narrativeId);
            showToast('Narrative deleted', 'success');
            
            // Reload narratives
            await loadClientNarratives(state.selectedClient.id);
        } catch (error) {
            console.error('[Narrative] Error deleting:', error);
            showToast('Failed to delete narrative', 'error');
        }
    }
}

// Copy narrative to clipboard
function copyNarrativeToClipboard() {
    const content = state.currentDisplayedNarrative?.content;
    if (content) {
        navigator.clipboard.writeText(content).then(() => {
            showToast('Narrative copied to clipboard', 'success');
        }).catch(err => {
            showToast('Failed to copy', 'error');
        });
    }
}

// Download workshop materials (blank PPTX and DOCX)
async function downloadWorkshopMaterials() {
    console.log('[Workshop] Starting workshop materials download...');
    
    const btn = document.getElementById('downloadWorkshopBtn');
    const btnText = document.getElementById('downloadWorkshopText');
    const btnIcon = btn?.querySelector('svg');
    
    // Show generating state with spinner
    if (btn) {
        btn.disabled = true;
        btn.classList.add('generating');
    }
    if (btnText) btnText.textContent = 'Generating AI Content...';
    
    // Add spinning animation to icon
    if (btnIcon) {
        btnIcon.style.animation = 'spin 1s linear infinite';
    }
    showToast('Generating workshop materials...', 'info');
    
    try {
        if (state.isElectron && window.electronAPI?.workshop) {
            const result = await window.electronAPI.workshop.generate({
                client: state.selectedClient
            });
            
            console.log('[Workshop] Result:', result);
            
            if (result.success) {
                showToast('Workshop materials generated successfully!', 'success');
            } else if (result.error === 'Save location not selected') {
                showToast('Workshop materials download canceled', 'info');
            } else {
                showToast(result.error || 'Failed to generate workshop materials', 'error');
            }
        } else {
            console.log('[Workshop] Running in demo mode');
            await sleep(1000);
            showToast('Workshop materials generated (Demo Mode)', 'success');
        }
    } catch (error) {
        console.error('[Workshop] Error generating materials:', error);
        showToast('Failed to generate workshop materials: ' + error.message, 'error');
    } finally {
        // Reset button state
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('generating');
        }
        if (btnText) btnText.textContent = 'Download Workshop Materials';
        
        // Stop spinning animation
        const btnIcon = btn?.querySelector('svg');
        if (btnIcon) {
            btnIcon.style.animation = '';
        }
    }
}

// ============================================
// Video Generation (Runway ML)
// ============================================
function setupVideoGeneration() {
    const generateBtn = document.getElementById('generateVideoBtn');
    const downloadBtn = document.getElementById('downloadVideoBtn');
    
    if (generateBtn) {
        generateBtn.addEventListener('click', generateVideo);
    }
    
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadGeneratedVideo);
    }
}

async function generateVideo() {
    const promptInput = document.getElementById('videoPromptInput');
    const durationSelect = document.getElementById('videoDuration');
    const ratioSelect = document.getElementById('videoRatio');
    const audioSelect = document.getElementById('videoAudio');
    const generateBtn = document.getElementById('generateVideoBtn');
    const generateText = document.getElementById('generateVideoText');
    
    const prompt = promptInput?.value?.trim();
    
    if (!prompt || prompt.length < 5) {
        showToast('Please enter a video prompt (at least 5 characters)', 'warning');
        return;
    }
    
    // Show loading state
    if (generateBtn) generateBtn.disabled = true;
    if (generateText) generateText.textContent = 'Generating...';
    
    // Show output section with loading state
    const outputSection = document.getElementById('videoOutputSection');
    const loadingState = document.getElementById('videoLoadingState');
    const playerContainer = document.getElementById('videoPlayerContainer');
    const errorState = document.getElementById('videoErrorState');
    const downloadBtn = document.getElementById('downloadVideoBtn');
    
    outputSection?.classList.remove('hidden');
    loadingState?.classList.remove('hidden');
    playerContainer?.classList.add('hidden');
    errorState?.classList.add('hidden');
    downloadBtn?.classList.add('hidden');
    
    try {
        if (!state.isElectron || !window.electronAPI?.video) {
            throw new Error('Video generation requires Electron with Runway ML configured');
        }
        
        const result = await window.electronAPI.video.generate({
            promptText: prompt,
            duration: parseInt(durationSelect?.value || '8'),
            ratio: ratioSelect?.value || '1920:1080',
            audio: audioSelect?.value === 'true'
        });
        
        if (result.success && result.videoUrl) {
            // Show video player
            const videoPlayer = document.getElementById('generatedVideoPlayer');
            if (videoPlayer) {
                videoPlayer.src = result.videoUrl;
            }
            
            // Store video URL for download
            state.generatedVideoUrl = result.videoUrl;
            
            loadingState?.classList.add('hidden');
            playerContainer?.classList.remove('hidden');
            downloadBtn?.classList.remove('hidden');
            
            showToast('Video generated successfully!', 'success');
        } else {
            throw new Error(result.error || 'Video generation failed');
        }
    } catch (error) {
        console.error('[Video] Generation error:', error);
        
        loadingState?.classList.add('hidden');
        errorState?.classList.remove('hidden');
        
        const errorText = document.getElementById('videoErrorText');
        if (errorText) {
            errorText.textContent = error.message || 'Failed to generate video';
        }
        
        showToast('Video generation failed: ' + error.message, 'error');
    } finally {
        if (generateBtn) generateBtn.disabled = false;
        if (generateText) generateText.textContent = 'Generate Video';
    }
}

async function downloadGeneratedVideo() {
    if (!state.generatedVideoUrl) {
        showToast('No video to download', 'warning');
        return;
    }
    
    try {
        // Open the video URL in browser for download
        if (state.isElectron && window.electronAPI?.shell) {
            await window.electronAPI.shell.openExternal(state.generatedVideoUrl);
        } else {
            window.open(state.generatedVideoUrl, '_blank');
        }
    } catch (error) {
        console.error('[Video] Download error:', error);
        showToast('Failed to download video', 'error');
    }
}

// ============================================
// Narration Generation (ElevenLabs)
// ============================================

function setupNarrationGeneration() {
    const textInput = document.getElementById('narrationTextInput');
    const charCount = document.getElementById('narrationCharCount');
    const generateBtn = document.getElementById('generateNarrationBtn');
    const clearHistoryBtn = document.getElementById('clearNarrationHistoryBtn');
    
    // Character count
    if (textInput && charCount) {
        textInput.addEventListener('input', () => {
            const count = textInput.value.length;
            charCount.textContent = count.toLocaleString();
            if (count > 5000) {
                charCount.style.color = 'var(--error)';
            } else {
                charCount.style.color = '';
            }
        });
    }
    
    // Generate button
    if (generateBtn) {
        generateBtn.addEventListener('click', generateNarration);
    }
    
    // Clear history button
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearNarrationHistory);
    }
    
    // Load history on init
    loadNarrationHistory();
}

async function generateNarration() {
    const textInput = document.getElementById('narrationTextInput');
    const voiceSelect = document.getElementById('narrationVoice');
    const modelSelect = document.getElementById('narrationModel');
    const generateBtn = document.getElementById('generateNarrationBtn');
    const generateText = document.getElementById('generateNarrationText');
    const outputSection = document.getElementById('narrationOutputSection');
    const loadingState = document.getElementById('narrationLoadingState');
    const playerContainer = document.getElementById('narrationPlayerContainer');
    const audioPlayer = document.getElementById('generatedNarrationPlayer');
    const downloadBtn = document.getElementById('downloadNarrationBtn');
    const errorState = document.getElementById('narrationErrorState');
    const errorText = document.getElementById('narrationErrorText');
    
    const text = textInput?.value?.trim();
    
    if (!text) {
        showToast('Please enter text to convert to speech', 'warning');
        return;
    }
    
    if (text.length > 5000) {
        showToast('Text is too long. Maximum 5,000 characters.', 'warning');
        return;
    }
    
    // Show loading state
    if (outputSection) outputSection.classList.remove('hidden');
    if (loadingState) loadingState.classList.remove('hidden');
    if (playerContainer) playerContainer.classList.add('hidden');
    if (downloadBtn) downloadBtn.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');
    
    if (generateBtn) generateBtn.disabled = true;
    if (generateText) generateText.textContent = 'Generating...';
    
    try {
        const result = await window.electronAPI.narration.generate({
            text: text,
            voiceId: voiceSelect?.value || '21m00Tcm4TlvDq8ikWAM',
            modelId: modelSelect?.value || 'eleven_multilingual_v2'
        });
        
        if (result.success) {
            // Create audio blob from base64
            const audioBlob = base64ToBlob(result.audioBase64, 'audio/mpeg');
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Store for download
            state.generatedNarrationUrl = audioUrl;
            state.generatedNarrationBase64 = result.audioBase64;
            
            // Show player
            if (loadingState) loadingState.classList.add('hidden');
            if (playerContainer) playerContainer.classList.remove('hidden');
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            
            if (audioPlayer) {
                audioPlayer.src = audioUrl;
                audioPlayer.load();
            }
            
            // Setup download button
            if (downloadBtn) {
                downloadBtn.onclick = () => downloadNarration();
            }
            
            // Reload history
            await loadNarrationHistory();
            
            showToast('Narration generated successfully!', 'success');
        } else {
            // Show error
            if (loadingState) loadingState.classList.add('hidden');
            if (errorState) errorState.classList.remove('hidden');
            if (errorText) errorText.textContent = result.error || 'Failed to generate narration';
            
            showToast('Narration generation failed', 'error');
        }
    } catch (error) {
        console.error('[Narration] Error:', error);
        
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.remove('hidden');
        if (errorText) errorText.textContent = error.message || 'Failed to generate narration';
        
        showToast('Narration generation failed: ' + error.message, 'error');
    } finally {
        if (generateBtn) generateBtn.disabled = false;
        if (generateText) generateText.textContent = 'Generate Narration';
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function downloadNarration() {
    if (!state.generatedNarrationBase64) {
        showToast('No narration to download', 'warning');
        return;
    }
    
    try {
        const blob = base64ToBlob(state.generatedNarrationBase64, 'audio/mpeg');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `narration_${Date.now()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Narration downloaded', 'success');
    } catch (error) {
        console.error('[Narration] Download error:', error);
        showToast('Failed to download narration', 'error');
    }
}

async function loadNarrationHistory() {
    if (!state.isElectron || !window.electronAPI?.narration) return;
    
    const historyEmpty = document.getElementById('narrationHistoryEmpty');
    const historyList = document.getElementById('narrationHistoryList');
    const clearBtn = document.getElementById('clearNarrationHistoryBtn');
    
    try {
        const history = await window.electronAPI.narration.getHistory();
        
        if (!history || history.length === 0) {
            if (historyEmpty) historyEmpty.classList.remove('hidden');
            if (historyList) historyList.classList.add('hidden');
            if (clearBtn) clearBtn.classList.add('hidden');
            return;
        }
        
        if (historyEmpty) historyEmpty.classList.add('hidden');
        if (historyList) historyList.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');
        
        const voiceNames = {
            '21m00Tcm4TlvDq8ikWAM': 'Rachel',
            'EXAVITQu4vr4xnSDxMaL': 'Bella',
            'ErXwobaYiN019PkySvjV': 'Antoni',
            'VR6AewLTigWG4xSOukaG': 'Arnold',
            'pNInz6obpgDQGcFmaJgB': 'Adam',
            'yoZ06aMxZJJ28mfd3POQ': 'Sam'
        };
        
        historyList.innerHTML = history.map(item => `
            <div class="narration-history-item" data-id="${item.id}">
                <div class="narration-history-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                </div>
                <div class="narration-history-info">
                    <div class="narration-history-text">${escapeHtml(item.text)}</div>
                    <div class="narration-history-meta">
                        ${voiceNames[item.voiceId] || 'Voice'} • ${formatFileSize(item.size)} • ${formatRelativeTime(item.createdAt)}
                    </div>
                </div>
                <div class="narration-history-actions">
                    <button class="btn btn-secondary btn-sm play-narration-btn" data-id="${item.id}" title="Play">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-sm delete-narration-btn" data-id="${item.id}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Add event listeners
        historyList.querySelectorAll('.play-narration-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                await playHistoryNarration(id);
            });
        });
        
        historyList.querySelectorAll('.delete-narration-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                await deleteHistoryNarration(id);
            });
        });
    } catch (error) {
        console.error('[Narration] Failed to load history:', error);
    }
}

async function playHistoryNarration(id) {
    try {
        const result = await window.electronAPI.narration.getAudio(id);
        if (result.success && result.audioBase64) {
            const blob = base64ToBlob(result.audioBase64, 'audio/mpeg');
            const url = URL.createObjectURL(blob);
            
            const audioPlayer = document.getElementById('generatedNarrationPlayer');
            const outputSection = document.getElementById('narrationOutputSection');
            const loadingState = document.getElementById('narrationLoadingState');
            const playerContainer = document.getElementById('narrationPlayerContainer');
            const downloadBtn = document.getElementById('downloadNarrationBtn');
            const errorState = document.getElementById('narrationErrorState');
            
            // Store for download
            state.generatedNarrationUrl = url;
            state.generatedNarrationBase64 = result.audioBase64;
            
            // Show player
            if (outputSection) outputSection.classList.remove('hidden');
            if (loadingState) loadingState.classList.add('hidden');
            if (playerContainer) playerContainer.classList.remove('hidden');
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            if (errorState) errorState.classList.add('hidden');
            
            if (audioPlayer) {
                audioPlayer.src = url;
                audioPlayer.load();
                audioPlayer.play();
            }
            
            if (downloadBtn) {
                downloadBtn.onclick = () => downloadNarration();
            }
        } else {
            showToast('Failed to load audio', 'error');
        }
    } catch (error) {
        console.error('[Narration] Failed to play:', error);
        showToast('Failed to play narration', 'error');
    }
}

async function deleteHistoryNarration(id) {
    try {
        await window.electronAPI.narration.deleteHistoryItem(id);
        await loadNarrationHistory();
        showToast('Narration deleted', 'success');
    } catch (error) {
        console.error('[Narration] Failed to delete:', error);
        showToast('Failed to delete narration', 'error');
    }
}

async function clearNarrationHistory() {
    if (!confirm('Are you sure you want to clear all narration history?')) return;
    
    try {
        await window.electronAPI.narration.clearHistory();
        await loadNarrationHistory();
        showToast('Narration history cleared', 'success');
    } catch (error) {
        console.error('[Narration] Failed to clear history:', error);
        showToast('Failed to clear history', 'error');
    }
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// ============================================
// Narrative Audio Generation (Step 6)
// ============================================

function setupNarrativeAudioGeneration() {
    const generateBtn = document.getElementById('generateNarrativeAudioBtn');
    const toggleBtn = document.getElementById('toggleScriptPreview');
    const downloadBtn = document.getElementById('downloadNarrativeAudioBtn');
    
    if (generateBtn) {
        generateBtn.addEventListener('click', generateNarrativeAudio);
    }
    
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleScriptPreviewCollapse);
    }
    
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadNarrativeAudio);
    }
    
    // Listen for progress updates
    if (state.isElectron && window.electronAPI?.onNarrativeAudioProgress) {
        window.electronAPI.onNarrativeAudioProgress(handleNarrativeAudioProgress);
    }
}

function handleNarrativeAudioProgress(data) {
    const loadingTitle = document.getElementById('narrativeAudioLoadingTitle');
    const loadingSubtitle = document.getElementById('narrativeAudioLoadingSubtitle');
    
    if (data.stage === 'script') {
        if (loadingTitle) loadingTitle.textContent = 'Crafting your script...';
        if (loadingSubtitle) loadingSubtitle.textContent = 'AI is transforming your narrative into an executive-ready script';
    } else if (data.stage === 'audio') {
        if (loadingTitle) loadingTitle.textContent = 'Generating audio...';
        if (loadingSubtitle) loadingSubtitle.textContent = 'Converting script to natural speech';
    }
}

async function generateNarrativeAudio() {
    const generateBtn = document.getElementById('generateNarrativeAudioBtn');
    const generateText = document.getElementById('generateNarrativeAudioText');
    const statusSection = document.getElementById('narrativeAudioStatus');
    const scriptPreview = document.getElementById('narrativeScriptPreview');
    const audioPlayer = document.getElementById('narrativeAudioPlayer');
    const errorSection = document.getElementById('narrativeAudioError');
    const voiceSelect = document.getElementById('narrativeAudioVoice');
    const toneSelect = document.getElementById('narrativeAudioTone');
    
    // Get the current narrative content
    const narrativeContent = state.currentDisplayedNarrative?.content;
    
    if (!narrativeContent) {
        showToast('No narrative to convert. Please generate a narrative first.', 'warning');
        return;
    }
    
    // Reset and show loading state
    if (statusSection) statusSection.classList.remove('hidden');
    if (scriptPreview) scriptPreview.classList.add('hidden');
    if (audioPlayer) audioPlayer.classList.add('hidden');
    if (errorSection) errorSection.classList.add('hidden');
    
    if (generateBtn) generateBtn.disabled = true;
    if (generateText) generateText.textContent = 'Generating...';
    
    try {
        const result = await window.electronAPI.narration.generateFromNarrative({
            narrativeContent: narrativeContent,
            clientName: state.selectedClient?.name || 'the company',
            voiceId: voiceSelect?.value || 'pNInz6obpgDQGcFmaJgB',
            tone: toneSelect?.value || 'inspiring'
        });
        
        if (result.success) {
            // Hide loading
            if (statusSection) statusSection.classList.add('hidden');
            
            // Show script preview
            if (scriptPreview) {
                scriptPreview.classList.remove('hidden');
                const scriptContent = document.getElementById('scriptPreviewContent');
                if (scriptContent) {
                    scriptContent.textContent = result.script;
                }
            }
            
            // Show audio player
            if (audioPlayer) {
                audioPlayer.classList.remove('hidden');
                const audioElement = document.getElementById('narrativeAudioElement');
                if (audioElement && result.audioBase64) {
                    const blob = base64ToBlob(result.audioBase64, 'audio/mpeg');
                    const url = URL.createObjectURL(blob);
                    audioElement.src = url;
                    audioElement.load();
                    
                    // Store for download
                    state.narrativeAudioBase64 = result.audioBase64;
                    state.narrativeAudioScript = result.script;
                }
            }
            
            showToast('Executive audio narration generated!', 'success');
        } else {
            // Show error
            if (statusSection) statusSection.classList.add('hidden');
            if (errorSection) {
                errorSection.classList.remove('hidden');
                const errorText = document.getElementById('narrativeAudioErrorText');
                if (errorText) errorText.textContent = result.error || 'Failed to generate audio';
            }
            showToast('Audio generation failed', 'error');
        }
    } catch (error) {
        console.error('[NarrativeAudio] Error:', error);
        
        if (statusSection) statusSection.classList.add('hidden');
        if (errorSection) {
            errorSection.classList.remove('hidden');
            const errorText = document.getElementById('narrativeAudioErrorText');
            if (errorText) errorText.textContent = error.message || 'Failed to generate audio';
        }
        showToast('Audio generation failed: ' + error.message, 'error');
    } finally {
        if (generateBtn) generateBtn.disabled = false;
        if (generateText) generateText.textContent = 'Generate Audio';
    }
}

function resetNarrativeAudioSection() {
    const statusSection = document.getElementById('narrativeAudioStatus');
    const scriptPreview = document.getElementById('narrativeScriptPreview');
    const audioPlayer = document.getElementById('narrativeAudioPlayer');
    const errorSection = document.getElementById('narrativeAudioError');
    const generateBtn = document.getElementById('generateNarrativeAudioBtn');
    const generateText = document.getElementById('generateNarrativeAudioText');
    
    if (statusSection) statusSection.classList.add('hidden');
    if (scriptPreview) scriptPreview.classList.add('hidden');
    if (audioPlayer) audioPlayer.classList.add('hidden');
    if (errorSection) errorSection.classList.add('hidden');
    if (generateBtn) generateBtn.disabled = false;
    if (generateText) generateText.textContent = 'Generate Audio';
    
    // Clear stored audio
    state.narrativeAudioBase64 = null;
    state.narrativeAudioScript = null;
}

function toggleScriptPreviewCollapse() {
    const content = document.getElementById('scriptPreviewContent');
    const toggleBtn = document.getElementById('toggleScriptPreview');
    
    if (content) {
        content.classList.toggle('collapsed');
        
        // Update icon
        if (toggleBtn) {
            const svg = toggleBtn.querySelector('svg');
            if (svg) {
                if (content.classList.contains('collapsed')) {
                    svg.innerHTML = '<path d="M9 18l6-6-6-6"/>';
                } else {
                    svg.innerHTML = '<path d="M19 9l-7 7-7-7"/>';
                }
            }
        }
    }
}

function downloadNarrativeAudio() {
    if (!state.narrativeAudioBase64) {
        showToast('No audio to download', 'warning');
        return;
    }
    
    try {
        const blob = base64ToBlob(state.narrativeAudioBase64, 'audio/mpeg');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${state.selectedClient?.name || 'narrative'}_audio_${Date.now()}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Audio downloaded', 'success');
    } catch (error) {
        console.error('[NarrativeAudio] Download error:', error);
        showToast('Failed to download audio', 'error');
    }
}

// ============================================
// Video Narrative Generation (Script to Video Montage)
// ============================================

function setupVideoNarrativeGeneration() {
    const generateBtn = document.getElementById('generateVideoNarrativeBtn');
    const scriptTextarea = document.getElementById('videoNarrationScript');
    const downloadBtn = document.getElementById('downloadVideoNarrativeBtn');
    
    if (generateBtn) {
        generateBtn.addEventListener('click', generateVideoNarrative);
    }
    
    if (scriptTextarea) {
        scriptTextarea.addEventListener('input', updateVideoScriptInfo);
    }
    
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadVideoNarrative);
    }
    
    // Set up progress listener
    if (window.electronAPI?.onVideoNarrativeProgress) {
        window.electronAPI.onVideoNarrativeProgress((data) => {
            updateVideoNarrativeProgress(data);
        });
    }
    
    console.log('[VideoNarrative] Setup complete');
}

function updateVideoScriptInfo() {
    const textarea = document.getElementById('videoNarrationScript');
    const wordCountEl = document.getElementById('videoScriptWordCount');
    const estimateEl = document.getElementById('videoScriptEstimate');
    
    if (!textarea) return;
    
    const text = textarea.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    
    // Update word count
    if (wordCountEl) {
        wordCountEl.textContent = `${words} words`;
    }
    
    // Estimate segments (~20-25 words per 7-second segment)
    // Average speaking rate is about 150 words per minute = 2.5 words per second
    // 7 seconds = ~17-18 words, let's use 20 for buffer
    const wordsPerSegment = 20;
    const segments = Math.max(1, Math.ceil(words / wordsPerSegment));
    const duration = segments * 7;
    
    if (estimateEl) {
        if (words > 0) {
            estimateEl.textContent = `~${segments} segments, ~${duration}s video`;
        } else {
            estimateEl.textContent = 'Paste your script above';
        }
    }
}

async function generateVideoNarrative() {
    const scriptTextarea = document.getElementById('videoNarrationScript');
    const generateBtn = document.getElementById('generateVideoNarrativeBtn');
    const progressSection = document.getElementById('videoNarrativeProgress');
    const playerSection = document.getElementById('videoNarrativePlayer');
    const errorSection = document.getElementById('videoNarrativeError');
    
    const script = scriptTextarea?.value?.trim();
    
    if (!script) {
        showToast('Please enter a narration script', 'warning');
        return;
    }
    
    // Get options
    const aspectRatio = document.getElementById('videoNarrativeRatio')?.value || '16:9';
    const visualStyle = document.getElementById('videoNarrativeStyle')?.value || 'cinematic';
    
    // Disable button and show progress
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                <path d="M12 6v6l4 2"/>
            </svg>
            Generating...
        `;
    }
    
    // Show progress, hide player and error
    if (progressSection) progressSection.classList.remove('hidden');
    if (playerSection) playerSection.classList.add('hidden');
    if (errorSection) errorSection.classList.add('hidden');
    
    // Reset progress UI
    resetVideoNarrativeProgress();
    
    console.log('[VideoNarrative] Starting generation:', {
        scriptLength: script.length,
        aspectRatio,
        visualStyle
    });
    
    try {
        const result = await window.electronAPI.videoNarrative.generate({
            script,
            aspectRatio,
            visualStyle,
            clientName: state.selectedClient?.name || 'Unknown'
        });
        
        if (result.success) {
            console.log('[VideoNarrative] Generation complete:', result);
            
            // Show the video player
            const videoElement = document.getElementById('videoNarrativeElement');
            if (videoElement && result.videoPath) {
                videoElement.src = `file://${result.videoPath}`;
                videoElement.load();
            }
            
            // Store the path for download
            state.videoNarrativePath = result.videoPath;
            
            if (playerSection) playerSection.classList.remove('hidden');
            showToast('Video narrative generated successfully!', 'success');
        } else {
            throw new Error(result.error || 'Generation failed');
        }
    } catch (error) {
        console.error('[VideoNarrative] Generation error:', error);
        
        // Show error section
        const errorMessage = document.getElementById('videoNarrativeErrorText');
        if (errorMessage) {
            errorMessage.textContent = error.message || 'Failed to generate video narrative';
        }
        if (errorSection) errorSection.classList.remove('hidden');
        
        showToast('Failed to generate video narrative', 'error');
    } finally {
        // Re-enable button
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Generate Video Narrative
            `;
        }
    }
}

function resetVideoNarrativeProgress() {
    const progressBar = document.getElementById('videoProgressBarFill');
    const progressPercent = document.getElementById('videoProgressPercent');
    const progressStage = document.getElementById('videoProgressStage');
    const segmentList = document.getElementById('videoSegmentList');
    
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressStage) progressStage.textContent = 'Initializing...';
    if (segmentList) segmentList.innerHTML = '';
}

function updateVideoNarrativeProgress(data) {
    console.log('[VideoNarrative] Progress update:', data);
    
    const progressBar = document.getElementById('videoProgressBarFill');
    const progressPercent = document.getElementById('videoProgressPercent');
    const progressStage = document.getElementById('videoProgressStage');
    const segmentList = document.getElementById('videoSegmentList');
    
    // Update overall progress
    if (data.percent !== undefined) {
        if (progressBar) progressBar.style.width = `${data.percent}%`;
        if (progressPercent) progressPercent.textContent = `${Math.round(data.percent)}%`;
    }
    
    // Update stage
    if (data.stage && progressStage) {
        progressStage.textContent = data.stage;
    }
    
    // Update segment list
    if (data.segments && segmentList) {
        segmentList.innerHTML = data.segments.map((seg, i) => {
            let iconSvg = '';
            let statusClass = '';
            let statusText = '';
            
            switch (seg.status) {
                case 'pending':
                    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
                    statusClass = 'pending';
                    statusText = 'Pending';
                    break;
                case 'generating-prompt':
                    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M12 6v6l4 2"/></svg>';
                    statusClass = 'processing';
                    statusText = 'Creating prompt...';
                    break;
                case 'generating-video':
                    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M12 6v6l4 2"/></svg>';
                    statusClass = 'processing';
                    statusText = 'Generating video...';
                    break;
                case 'complete':
                    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
                    statusClass = 'complete';
                    statusText = 'Complete';
                    break;
                case 'error':
                    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
                    statusClass = 'error';
                    statusText = 'Error';
                    break;
            }
            
            return `
                <div class="video-segment-item">
                    <span class="video-segment-icon ${statusClass}">${iconSvg}</span>
                    <span class="video-segment-text">Segment ${i + 1}: ${truncateText(seg.text, 50)}</span>
                    <span class="video-segment-status ${statusClass}">${statusText}</span>
                </div>
            `;
        }).join('');
    }
}

function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

async function downloadVideoNarrative() {
    if (!state.videoNarrativePath) {
        showToast('No video to download', 'warning');
        return;
    }
    
    try {
        // Use shell to open the folder containing the video
        // or copy to Downloads
        showToast('Opening video location...', 'info');
        
        // For now, we'll just alert the path - in production you'd copy to Downloads
        if (window.electronAPI?.shell?.openExternal) {
            // Open the folder containing the video
            const folderPath = state.videoNarrativePath.substring(0, state.videoNarrativePath.lastIndexOf('\\'));
            await window.electronAPI.shell.openExternal(`file://${folderPath}`);
        }
    } catch (error) {
        console.error('[VideoNarrative] Download error:', error);
        showToast('Failed to open video location', 'error');
    }
}

function resetVideoNarrativeSection() {
    const progressSection = document.getElementById('videoNarrativeProgress');
    const playerSection = document.getElementById('videoNarrativePlayer');
    const errorSection = document.getElementById('videoNarrativeError');
    const scriptTextarea = document.getElementById('videoNarrationScript');
    const generateBtn = document.getElementById('generateVideoNarrativeBtn');
    
    // Hide progress, player, and error sections
    if (progressSection) progressSection.classList.add('hidden');
    if (playerSection) playerSection.classList.add('hidden');
    if (errorSection) errorSection.classList.add('hidden');
    
    // Reset button state
    if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Generate Video Narrative
        `;
    }
    
    // Clear stored video path
    state.videoNarrativePath = null;
    
    // Reset progress UI
    resetVideoNarrativeProgress();
    
    // Update script info
    updateVideoScriptInfo();
}

// ============================================
// Admin: Template Management
// ============================================

function setupTemplateManagement() {
    const addBtn = document.getElementById('addTemplateBtn');
    if (addBtn) {
        addBtn.addEventListener('click', addAdminTemplate);
    }
    
    // Setup default prompt save button
    const savePromptBtn = document.getElementById('saveDefaultPromptBtn');
    if (savePromptBtn) {
        savePromptBtn.addEventListener('click', saveDefaultPrompt);
    }
    
    // Setup source prompts save button
    const saveSourcePromptsBtn = document.getElementById('saveSourcePromptsBtn');
    if (saveSourcePromptsBtn) {
        saveSourcePromptsBtn.addEventListener('click', saveSourcePrompts);
    }
    
    // Load existing templates, default prompt, and source prompts
    loadAdminTemplates();
    loadDefaultPrompt();
    loadSourcePrompts();
}

async function loadDefaultPrompt() {
    const textarea = document.getElementById('adminDefaultPrompt');
    if (!textarea) return;
    
    try {
        if (state.isElectron && window.electronAPI.settings) {
            const prompt = await window.electronAPI.settings.getDefaultPrompt();
            textarea.value = prompt || '';
        }
    } catch (error) {
        console.error('Error loading default prompt:', error);
    }
}

async function saveDefaultPrompt() {
    const textarea = document.getElementById('adminDefaultPrompt');
    const btn = document.getElementById('saveDefaultPromptBtn');
    
    if (!textarea) return;
    
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; margin-right: 6px;" class="spin">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Saving...
        `;
        btn.disabled = true;
    }
    
    try {
        if (state.isElectron && window.electronAPI.settings) {
            const result = await window.electronAPI.settings.saveDefaultPrompt(textarea.value);
            if (result.success) {
                showToast('Default agent prompt saved', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving default prompt:', error);
        showToast('Failed to save default prompt', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// ============================================
// Source Prompts Management
// ============================================

async function loadSourcePrompts() {
    const chatgptTextarea = document.getElementById('sourcePromptChatgpt');
    const arcTextarea = document.getElementById('sourcePromptArc');
    const alphasenseTextarea = document.getElementById('sourcePromptAlphasense');
    
    if (!chatgptTextarea || !arcTextarea || !alphasenseTextarea) return;
    
    try {
        if (state.isElectron && window.electronAPI.settings) {
            const prompts = await window.electronAPI.settings.getSourcePrompts();
            chatgptTextarea.value = prompts?.chatgpt || '';
            arcTextarea.value = prompts?.arc || '';
            alphasenseTextarea.value = prompts?.alphasense || '';
        }
    } catch (error) {
        console.error('Error loading source prompts:', error);
    }
}

async function saveSourcePrompts() {
    const chatgptTextarea = document.getElementById('sourcePromptChatgpt');
    const arcTextarea = document.getElementById('sourcePromptArc');
    const alphasenseTextarea = document.getElementById('sourcePromptAlphasense');
    const btn = document.getElementById('saveSourcePromptsBtn');
    
    if (!chatgptTextarea || !arcTextarea || !alphasenseTextarea) return;
    
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; margin-right: 6px;" class="spin">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Saving...
        `;
        btn.disabled = true;
    }
    
    try {
        if (state.isElectron && window.electronAPI.settings) {
            const prompts = {
                chatgpt: chatgptTextarea.value,
                arc: arcTextarea.value,
                alphasense: alphasenseTextarea.value
            };
            
            const result = await window.electronAPI.settings.saveSourcePrompts(prompts);
            if (result.success) {
                showToast('Source prompts saved successfully', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving source prompts:', error);
        showToast('Failed to save source prompts', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

async function loadAdminTemplates() {
    const listEl = document.getElementById('templatesList');
    const emptyEl = document.getElementById('emptyTemplates');
    
    if (!listEl) return;
    
    try {
        let templates = [];
        if (state.isElectron && window.electronAPI.templates) {
            templates = await window.electronAPI.templates.getAll();
        }
        
        if (templates && templates.length > 0) {
            if (emptyEl) emptyEl.style.display = 'none';
            
            // Clear existing items (except empty state)
            const existingItems = listEl.querySelectorAll('.template-item');
            existingItems.forEach(item => item.remove());
            
            templates.forEach(template => {
                const item = document.createElement('div');
                item.className = 'template-item glass-card';
                item.innerHTML = `
                    <div class="template-item-header">
                        <div class="template-item-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                        </div>
                        <div class="template-item-info">
                            <span class="template-item-title">${template.title}</span>
                            <span class="template-item-filename">${template.filename || 'No file'}</span>
                        </div>
                        <button class="btn btn-ghost btn-sm template-delete-btn" data-id="${template.id}" title="Delete template">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                        </button>
                    </div>
                    ${template.description ? `<p class="template-item-description">${template.description}</p>` : ''}
                `;
                listEl.appendChild(item);
                
                // Add delete listener
                item.querySelector('.template-delete-btn')?.addEventListener('click', () => deleteAdminTemplate(template.id));
            });
        } else {
            if (emptyEl) emptyEl.style.display = 'flex';
        }
    } catch (error) {
        console.error('Error loading admin templates:', error);
    }
}

async function addAdminTemplate() {
    if (!state.isElectron || !window.electronAPI.templates) {
        showToast('Template management is only available in the desktop app', 'info');
        return;
    }
    
    try {
        const result = await window.electronAPI.templates.addAdmin();
        if (result && result.success) {
            showToast(`Template "${result.title}" added successfully`, 'success');
            await loadAdminTemplates();
        }
    } catch (error) {
        console.error('Error adding template:', error);
        showToast('Failed to add template', 'error');
    }
}

async function deleteAdminTemplate(templateId) {
    if (!state.isElectron || !window.electronAPI.templates) {
        return;
    }
    
    if (!confirm('Are you sure you want to delete this template?')) {
        return;
    }
    
    try {
        const result = await window.electronAPI.templates.delete(templateId);
        if (result && result.success) {
            showToast('Template deleted', 'success');
            await loadAdminTemplates();
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        showToast('Failed to delete template', 'error');
    }
}

// Render review preview (before export)
function renderReviewPreview() {
    const reviewContainer = document.getElementById('reviewContainer');
    if (!reviewContainer) return;
    
    const hasPocFile = state.pocFile !== null;
    const additionalFilesCount = state.additionalFiles?.length || 0;
    
    // POC section (3.0)
    const pocFilesHtml = hasPocFile 
        ? `<li class="generated"><strong>3.0</strong> Client Point of Contact Info (${state.pocFile.name}) ✓</li>`
        : '';
    
    // Additional files section (now 4.0)
    const additionalFilesHtml = additionalFilesCount > 0 
        ? `<li class="generated"><strong>4.0</strong> Additional Client Materials (${additionalFilesCount} file${additionalFilesCount !== 1 ? 's' : ''}) ✓</li>`
        : '';
    
    // Estimate document count (3 sections x 4 docs each + POC + additional)
    const pocCount = hasPocFile ? 1 : 0;
    const estimatedDocCount = 12 + pocCount + additionalFilesCount;
    const docCountText = (pocCount + additionalFilesCount) > 0 
        ? `~${estimatedDocCount} files (including ${pocCount > 0 ? 'POC' : ''}${pocCount > 0 && additionalFilesCount > 0 ? ' + ' : ''}${additionalFilesCount > 0 ? additionalFilesCount + ' additional' : ''})`
        : `~${estimatedDocCount} files`;
    
    // Store for narrative generation
    state.sourcePackDocCount = docCountText;
    state.sourcePackGenDate = new Date().toLocaleString();
    
    reviewContainer.innerHTML = `
        <div class="review-header">
            <div class="review-status">
                <div class="status-icon ready">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <div class="status-info">
                    <h3>Review Source Pack</h3>
                    <p>Export your Source Pack or continue to narrative generation</p>
                </div>
            </div>
        </div>
        
        <div class="review-content">
            <div class="zip-details-card glass-card">
                <h4>Source Pack Details</h4>
                <div class="detail-grid">
                    <div class="detail-row">
                        <span class="detail-label">Client:</span>
                        <span class="detail-value">${state.selectedClient?.name || 'Unknown'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Documents:</span>
                        <span class="detail-value">${docCountText}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value">Ready to export</span>
                    </div>
                </div>
            </div>
            
            <div class="zip-schema-card glass-card">
                <h4>Source Pack Contents</h4>
                <ul class="schema-list compact">
                    <li><strong>0.0</strong> Situation Summary</li>
                    <li class="placeholder"><strong>0.1</strong> Situation AlphaSense [PLACEHOLDER]</li>
                    <li class="placeholder"><strong>0.2</strong> Situation ARC [PLACEHOLDER]</li>
                    <li class="generated"><strong>0.3</strong> Situation DeepResearch ✓</li>
                    <li><strong>1.0</strong> Complication Summary</li>
                    <li class="placeholder"><strong>1.1</strong> Complication AlphaSense [PLACEHOLDER]</li>
                    <li class="placeholder"><strong>1.2</strong> Complication ARC [PLACEHOLDER]</li>
                    <li class="generated"><strong>1.3</strong> Complication DeepResearch ✓</li>
                    <li><strong>2.0</strong> Value Summary</li>
                    <li class="placeholder"><strong>2.1</strong> Value AlphaSense [PLACEHOLDER]</li>
                    <li class="placeholder"><strong>2.2</strong> Value ARC [PLACEHOLDER]</li>
                    <li class="generated"><strong>2.3</strong> Value DeepResearch ✓</li>
                    ${pocFilesHtml}
                    ${additionalFilesHtml}
                </ul>
            </div>
        </div>
        
        <div class="panel-actions review-actions">
            <button class="btn btn-secondary" id="exportSourcePackBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 8px;">
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                <span id="exportBtnText">Export Source Pack</span>
            </button>
            <button class="btn btn-primary" id="continueToNarrativeBtn">
                <span>Continue to Narrative</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-left: 8px;">
                    <path d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                </svg>
            </button>
        </div>
    `;
    
    // Export button - actually creates and downloads the ZIP
    document.getElementById('exportSourcePackBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('exportSourcePackBtn');
        const btnText = document.getElementById('exportBtnText');
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Exporting...';
        
        try {
            await finalizeSourcePack();
        } finally {
            if (btn) btn.disabled = false;
            if (btnText) btnText.textContent = 'Export Source Pack';
        }
    });
    
    // Continue button - goes to narrative step
    document.getElementById('continueToNarrativeBtn')?.addEventListener('click', () => {
        goToStep(6);
        populateNarrativeStep();
    });
}

// Simulation fallback for non-Electron mode
async function simulateSourcePackGeneration(context) {
    await sleep(1000);
    return {
        success: true,
        requestId: 'demo-' + Date.now(),
        sourcePack: {
            client: state.selectedClient,
            context: context,
            company_profile: {
                name: state.selectedClient.name,
                executive_summary: 'Demo executive summary for ' + state.selectedClient.name,
                strategic_priorities: ['Digital transformation', 'Operational excellence', 'Market expansion']
            },
            alphasense_consensus: {
                themes: [
                    { theme: 'Digital Transformation', confidence: 85 },
                    { theme: 'AI Adoption', confidence: 78 }
                ],
                key_quotes: [
                    { quote: 'Strong market positioning expected', source: 'Analyst Report' }
                ],
                sentiment: { overall: 'positive', trend: 'improving' }
            },
            competitor_moves: [
                { competitor: 'Competitor A', move: 'Expanded cloud services', impact: 'Medium' }
            ],
            industry_kpis: {
                'Revenue Growth': { value: '12%', trend: 'up', trend_indicator: '↑', benchmark: '10%' }
            },
            regulatory_events: [
                { title: 'New Data Privacy Regulation', impact: 'High', regulator: 'SEC' }
            ],
            confidence_scores: {
                overall: 78,
                data_completeness: 82,
                source_quality: 75,
                timeliness: 80
            },
            sources: [
                { name: 'AlphaSense Report', type: 'analyst', source: 'AlphaSense' }
            ],
            metadata: {
                request_id: 'demo-' + Date.now(),
                generated_at: new Date().toISOString(),
                generated_by: state.user?.name || 'Demo User',
                processing_time_ms: 3500,
                schema_version: '1.0.0'
            }
        },
        validation: {
            status: 'ready',
            statusLabel: '✅ Ready',
            statusDescription: 'Source Pack meets all validation requirements'
        }
    };
}

function updateStageStatus(stage, status, progress = null) {
    const stageEl = document.querySelector(`.progress-stage[data-stage="${stage}"]`);
    if (stageEl) {
        const indicator = stageEl.querySelector('.stage-indicator');
        indicator.className = `stage-indicator ${status}`;
        
        // Update progress ring
        const progressRing = indicator.querySelector('.progress-ring-fill');
        if (progressRing) {
            const circumference = 97.4; // 2 * PI * 15.5
            if (status === 'complete') {
                progressRing.style.strokeDashoffset = '0';
            } else if (status === 'in-progress' && progress !== null) {
                const offset = circumference - (progress / 100) * circumference;
                progressRing.style.strokeDashoffset = offset;
            } else if (status === 'placeholder') {
                progressRing.style.strokeDashoffset = circumference / 2; // 50%
            } else {
                progressRing.style.strokeDashoffset = circumference; // 0%
            }
        }
        
        const statusEl = stageEl.querySelector('.stage-status');
        if (status === 'complete') {
            statusEl.textContent = '✓';
        } else if (status === 'in-progress') {
            statusEl.textContent = progress !== null ? `${Math.round(progress)}%` : '...';
        } else if (status === 'placeholder') {
            statusEl.textContent = 'N/A';
        } else {
            statusEl.textContent = '';
        }
    }
}

function updateStageProgress(stage, progress) {
    const stageEl = document.querySelector(`.progress-stage[data-stage="${stage}"]`);
    if (stageEl) {
        const progressRing = stageEl.querySelector('.progress-ring-fill');
        const statusEl = stageEl.querySelector('.stage-status');
        
        if (progressRing) {
            const circumference = 97.4;
            const offset = circumference - (progress / 100) * circumference;
            progressRing.style.strokeDashoffset = offset;
        }
        
        if (statusEl) {
            statusEl.textContent = `${Math.round(progress)}%`;
        }
    }
}

function getStageMessage(stage) {
    const messages = {
        auth: 'Authenticating to data sources...',
        alphasense: 'Retrieving AlphaSense insights...',
        arc: 'Fetching ARC benchmarks...',
        internet: 'Compiling deep research report...',
        normalize: 'Normalising and validating data...',
        complete: 'Finalising Source Pack...'
    };
    return messages[stage] || 'Processing...';
}

// ============================================
// Review Rendering
// ============================================
function renderReview(sourcePack, validation) {
    const statusConfig = {
        'ready': { icon: 'check', class: 'ready', label: '✅ Ready' },
        'ready_with_caveats': { icon: 'warning', class: 'caveats', label: '⚠️ Ready with Caveats' },
        'incomplete': { icon: 'error', class: 'incomplete', label: '❌ Incomplete' }
    };
    
    const status = statusConfig[validation.status] || statusConfig.ready;
    
    elements.reviewContainer.innerHTML = `
        <div class="review-header">
            <div class="review-status">
                <div class="status-icon ${status.class}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${status.class === 'ready' ? '<path d="M5 13l4 4L19 7"/>' :
                          status.class === 'caveats' ? '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>' :
                          '<path d="M6 18L18 6M6 6l12 12"/>'}
                    </svg>
                </div>
                <div class="status-info">
                    <h3>${status.label}</h3>
                    <p>${validation.statusDescription || 'Validation complete'}</p>
                </div>
            </div>
            <div class="export-buttons">
                <button class="btn btn-ghost" onclick="exportJSON()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Export JSON
                </button>
                <button class="btn btn-primary" onclick="exportMarkdown()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
                        <path d="M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Export Report
                </button>
            </div>
        </div>
        
        <div class="review-grid">
            <!-- Confidence Scores -->
            <div class="review-section full-width">
                <h4>Confidence Scores</h4>
                <div class="confidence-meters">
                    ${renderConfidenceMeter('Overall', sourcePack.confidence_scores.overall)}
                    ${renderConfidenceMeter('Data Completeness', sourcePack.confidence_scores.data_completeness)}
                    ${renderConfidenceMeter('Source Quality', sourcePack.confidence_scores.source_quality)}
                    ${renderConfidenceMeter('Timeliness', sourcePack.confidence_scores.timeliness)}
                </div>
            </div>
            
            <!-- Client Info -->
            <div class="review-section">
                <h4>Client</h4>
                <div class="data-list">
                    <div class="data-item">
                        <span class="data-label">Name</span>
                        <span class="data-value">${sourcePack.client.name}</span>
                    </div>
                    <div class="data-item">
                        <span class="data-label">Industry</span>
                        <span class="data-value">${sourcePack.client.industry}</span>
                    </div>
                    <div class="data-item">
                        <span class="data-label">Geography</span>
                        <span class="data-value">${sourcePack.client.geography}</span>
                    </div>
                    <div class="data-item">
                        <span class="data-label">Time Horizon</span>
                        <span class="data-value">${sourcePack.context.timeHorizon} days</span>
                    </div>
                    <div class="data-item">
                        <span class="data-label">Output Intent</span>
                        <span class="data-value">${sourcePack.context.outputIntent}</span>
                    </div>
                </div>
            </div>
            
            <!-- Industry KPIs -->
            <div class="review-section">
                <h4>Industry KPIs</h4>
                <div class="data-list">
                    ${Object.entries(sourcePack.industry_kpis).slice(0, 5).map(([key, data]) => `
                        <div class="data-item">
                            <span class="data-label">${key}</span>
                            <span class="data-value">
                                ${data.value}
                                <span class="trend-${data.trend}">${data.trend_indicator || getTrendIndicator(data.trend)}</span>
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Analyst Themes -->
            <div class="review-section full-width">
                <h4>Analyst Consensus Themes</h4>
                <div class="theme-tags">
                    ${sourcePack.alphasense_consensus.themes.map(t => `
                        <span class="theme-tag">${t.theme} (${t.confidence}%)</span>
                    `).join('')}
                </div>
            </div>
            
            <!-- Executive Summary -->
            <div class="review-section full-width">
                <h4>Executive Summary</h4>
                <div class="executive-summary">
                    <p>${sourcePack.company_profile.executive_summary || 'No summary available'}</p>
                </div>
            </div>
            
            <!-- Key Quotes -->
            <div class="review-section full-width">
                <h4>Key Quotes</h4>
                <div class="quote-cards">
                    ${(sourcePack.alphasense_consensus.key_quotes || []).slice(0, 3).map(q => `
                        <div class="quote-card">
                            <p class="quote-text">"${q.quote}"</p>
                            <span class="quote-source">— ${q.source}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Strategic Priorities -->
            <div class="review-section">
                <h4>Strategic Priorities</h4>
                <div class="priority-list">
                    ${(sourcePack.company_profile.strategic_priorities || []).map((p, i) => `
                        <div class="priority-item">
                            <span class="priority-number">${i + 1}</span>
                            <span class="priority-text">${p}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Competitor Moves -->
            <div class="review-section">
                <h4>Competitor Intelligence</h4>
                <div class="data-list">
                    ${(sourcePack.competitor_moves || []).map(c => `
                        <div class="data-item">
                            <span class="data-label">${c.competitor}</span>
                            <span class="data-value" style="font-size: 0.8rem; max-width: 200px; text-align: right;">${c.move}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Regulatory Events -->
            <div class="review-section full-width">
                <h4>Regulatory Events</h4>
                <div class="regulatory-list">
                    ${(sourcePack.regulatory_events || []).slice(0, 3).map(e => `
                        <div class="regulatory-item">
                            <div class="regulatory-header">
                                <span class="regulatory-title">${e.title}</span>
                                <span class="regulatory-impact impact-${e.impact?.toLowerCase() || 'medium'}">${e.impact || 'Medium'}</span>
                            </div>
                            <div class="regulatory-meta">
                                <span>${e.regulator}</span>
                                ${e.effective_date ? `<span>Effective: ${e.effective_date}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Sources -->
            <div class="review-section full-width">
                <h4>Sources (${(sourcePack.sources || []).length})</h4>
                <div class="sources-grid">
                    ${(sourcePack.sources || []).slice(0, 12).map(s => `
                        <div class="source-item">
                            <span class="source-type ${s.type}">${s.type}</span>
                            <span class="source-name">${s.name}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Metadata -->
            <div class="review-section full-width">
                <h4>Metadata</h4>
                <div class="metadata-grid">
                    <div class="metadata-item">
                        <span class="metadata-label">Request ID</span>
                        <span class="metadata-value mono">${sourcePack.metadata.request_id}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Generated At</span>
                        <span class="metadata-value">${new Date(sourcePack.metadata.generated_at).toLocaleString()}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Generated By</span>
                        <span class="metadata-value">${sourcePack.metadata.generated_by}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Processing Time</span>
                        <span class="metadata-value">${sourcePack.metadata.processing_time_ms}ms</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">Schema Version</span>
                        <span class="metadata-value">${sourcePack.metadata.schema_version}</span>
                    </div>
                    <div class="metadata-item">
                        <span class="metadata-label">APIs Used</span>
                        <span class="metadata-value">${(sourcePack.metadata.apis_used || ['AlphaSense', 'ARC', 'Internet']).join(', ')}</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="panel-actions" style="margin-top: var(--spacing-xl);">
            <button class="btn btn-ghost" onclick="resetGeneration()">Generate Another</button>
        </div>
    `;
}

function getTrendIndicator(trend) {
    const indicators = { up: '↑', down: '↓', stable: '→' };
    return indicators[trend] || '→';
}

function renderConfidenceMeter(label, value) {
    const circumference = 2 * Math.PI * 35;
    const offset = circumference - (value / 100) * circumference;
    const color = value >= 75 ? 'var(--success)' : value >= 50 ? 'var(--warning)' : 'var(--error)';
    
    return `
        <div class="confidence-meter">
            <div class="meter-circle">
                <svg viewBox="0 0 80 80">
                    <circle class="meter-bg" cx="40" cy="40" r="35"/>
                    <circle class="meter-fill" cx="40" cy="40" r="35"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"
                        style="stroke: ${color}"/>
                </svg>
                <span class="meter-value">${value}%</span>
            </div>
            <span class="meter-label">${label}</span>
        </div>
    `;
}

function resetGeneration() {
    state.selectedClient = null;
    state.currentSourcePack = null;
    elements.clientSearch.value = '';
    renderClientGrid();
    elements.contextForm.reset();
    goToStep(1);
}

// ============================================
// Export Functions
// ============================================
async function exportJSON() {
    if (!state.currentSourcePack) {
        showToast('No Source Pack to export', 'error');
        return;
    }
    
    const content = JSON.stringify(state.currentSourcePack, null, 2);
    const filename = `source-pack-${state.currentSourcePack.metadata.request_id}.json`;
    
    if (state.isElectron) {
        try {
            const result = await window.electronAPI.export.saveFile(
                content,
                filename,
                [{ name: 'JSON Files', extensions: ['json'] }]
            );
            
            if (result.success) {
                showToast('JSON exported successfully', 'success');
                addActivity('Exported Source Pack as JSON', 'info');
            } else if (!result.canceled) {
                showToast('Export failed', 'error');
            }
        } catch (error) {
            console.error('Export error:', error);
            // Fallback to download
            downloadBlob(new Blob([content], { type: 'application/json' }), filename);
        }
    } else {
        downloadBlob(new Blob([content], { type: 'application/json' }), filename);
        showToast('JSON exported successfully', 'success');
    }
}

async function exportMarkdown() {
    if (!state.currentSourcePack) {
        showToast('No Source Pack to export', 'error');
        return;
    }
    
    try {
        let markdown;
        
        if (state.isElectron) {
            markdown = await window.electronAPI.export.toMarkdown(state.currentSourcePack);
        } else {
            markdown = generateMarkdownFallback(state.currentSourcePack);
        }
        
        const filename = `source-pack-${state.currentSourcePack.metadata.request_id}.md`;
        
        if (state.isElectron) {
            const result = await window.electronAPI.export.saveFile(
                markdown,
                filename,
                [{ name: 'Markdown Files', extensions: ['md'] }]
            );
            
            if (result.success) {
                showToast('Report exported successfully', 'success');
                addActivity('Exported Source Pack as Markdown', 'info');
            } else if (!result.canceled) {
                showToast('Export failed', 'error');
            }
        } else {
            downloadBlob(new Blob([markdown], { type: 'text/markdown' }), filename);
            showToast('Report exported successfully', 'success');
        }
    } catch (error) {
        console.error('Export error:', error);
        showToast('Export failed: ' + error.message, 'error');
    }
}

function generateMarkdownFallback(sourcePack) {
    return `# Source Pack Report

## Client Information
- **Name:** ${sourcePack.client.name}
- **Industry:** ${sourcePack.client.industry}
- **Geography:** ${sourcePack.client.geography}

## Executive Summary
${sourcePack.company_profile?.executive_summary || 'N/A'}

## Confidence Scores
- Overall: ${sourcePack.confidence_scores.overall}%
- Data Completeness: ${sourcePack.confidence_scores.data_completeness}%
- Source Quality: ${sourcePack.confidence_scores.source_quality}%
- Timeliness: ${sourcePack.confidence_scores.timeliness}%

---
*Generated: ${sourcePack.metadata.generated_at}*
*Request ID: ${sourcePack.metadata.request_id}*
`;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// Dashboard Functions
// ============================================
function updateDashboardStats() {
    document.getElementById('statPacks').textContent = state.generatedPacks.length;
    document.getElementById('statReady').textContent = 
        state.generatedPacks.filter(p => p.validation?.status === 'ready').length;
    document.getElementById('statCaveats').textContent = 
        state.generatedPacks.filter(p => p.validation?.status === 'ready_with_caveats').length;
    document.getElementById('statClients').textContent = state.clients.length || 8;
}

async function updateApiStatus() {
    try {
        let health;
        
        if (state.isElectron) {
            health = await window.electronAPI.health.check();
        } else {
            health = {
                services: {
                    alphasense: false,
                    arc: false,
                    openai: false,
                    internet: true
                }
            };
        }
        
        // Update AlphaSense status
        const alphasenseStatus = document.getElementById('statusAlphasense');
        if (alphasenseStatus) {
            alphasenseStatus.className = `api-status-indicator ${health.services.alphasense ? 'online' : 'demo'}`;
            alphasenseStatus.innerHTML = `<span class="status-dot"></span>${health.services.alphasense ? 'Connected' : 'Demo Mode'}`;
        }
        
        // Update ARC status
        const arcStatus = document.getElementById('statusArc');
        if (arcStatus) {
            arcStatus.className = `api-status-indicator ${health.services.arc ? 'online' : 'placeholder'}`;
            arcStatus.innerHTML = `<span class="status-dot"></span>${health.services.arc ? 'Connected' : 'Placeholder'}`;
        }
        
        // Update OpenAI status
        const openaiStatus = document.getElementById('statusOpenai');
        if (openaiStatus) {
            openaiStatus.className = `api-status-indicator ${health.services.openai ? 'online' : 'demo'}`;
            openaiStatus.innerHTML = `<span class="status-dot"></span>${health.services.openai ? 'Connected' : 'Not Configured'}`;
        }
        
        // Update Internet status
        const internetStatus = document.getElementById('statusInternet');
        if (internetStatus) {
            internetStatus.className = `api-status-indicator ${health.services.internet ? 'online' : 'offline'}`;
            internetStatus.innerHTML = `<span class="status-dot"></span>${health.services.internet ? 'Active' : 'Offline'}`;
        }
        
    } catch (error) {
        console.error('Failed to check API status:', error);
    }
}

function addActivity(text, type = 'info') {
    const activity = {
        text,
        type,
        time: new Date()
    };
    
    const activityHtml = `
        <div class="activity-item">
            <div class="activity-icon ${type}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${type === 'success' ? '<path d="M5 13l4 4L19 7"/>' :
                      type === 'warning' ? '<path d="M12 9v2m0 4h.01"/>' :
                      type === 'error' ? '<path d="M6 18L18 6M6 6l12 12"/>' :
                      '<circle cx="12" cy="12" r="10"/>'}
                </svg>
            </div>
            <div class="activity-content">
                <span class="activity-text">${text}</span>
                <span class="activity-time">Just now</span>
            </div>
        </div>
    `;
    
    elements.activityList.insertAdjacentHTML('afterbegin', activityHtml);
    
    // Keep only last 10 activities
    const items = elements.activityList.querySelectorAll('.activity-item');
    if (items.length > 10) {
        items[items.length - 1].remove();
    }
}

// ============================================
// History Functions
// ============================================

// Add a narrative to the overall history (so it appears in the sidebar history)
function addNarrativeToOverallHistory(narrative) {
    const historyEntry = {
        id: narrative.id || 'narr_' + Date.now(),
        type: 'narrative',  // Distinguish from source pack
        client: state.selectedClient,
        narrative: narrative,  // Store the full narrative
        pocFile: state.pocFile,  // Store POC content for Intel Pack
        context: state.currentContext || state.pendingGenerationContext,
        sourcePack: state.currentSourcePack,
        validation: { status: 'ready', statusLabel: '✅ Narrative' },
        generatedAt: narrative.timestamp || new Date().toISOString()
    };
    
    // Add to beginning of array (newest first)
    state.generatedPacks.unshift(historyEntry);
    
    // Keep only last 50 entries
    if (state.generatedPacks.length > 50) {
        state.generatedPacks = state.generatedPacks.slice(0, 50);
    }
    
    // Persist to disk
    if (window.electronAPI?.appData) {
        window.electronAPI.appData.saveGeneratedPacks(state.generatedPacks);
    }
    
    // Update the history view
    updateHistoryView();
}

function updateHistoryView() {
    if (state.generatedPacks.length === 0) {
        elements.historyEmpty.classList.remove('hidden');
        elements.historyList.classList.add('hidden');
    } else {
        elements.historyEmpty.classList.add('hidden');
        elements.historyList.classList.remove('hidden');
        
        elements.historyList.innerHTML = state.generatedPacks.map(pack => {
            const isNarrative = pack.type === 'narrative';
            const outputIntent = pack.context?.outputIntent || pack.sourcePack?.context?.outputIntent || (isNarrative ? 'Narrative' : 'Source Pack');
            const icon = isNarrative 
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                        <path d="M2 2l7.586 7.586"/>
                        <circle cx="11" cy="11" r="2"/>
                   </svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                   </svg>`;
            const statusLabel = isNarrative ? '📝 Narrative' : (pack.validation?.statusLabel || '✅ Ready');
            const statusClass = isNarrative ? 'narrative' : (pack.validation?.status === 'ready' ? 'ready' : 'caveats');
            
            return `
            <div class="history-item ${isNarrative ? 'history-narrative' : ''}" data-pack-id="${pack.id}">
                <div class="history-icon ${isNarrative ? 'narrative-icon' : ''}">
                    ${icon}
                </div>
                <div class="history-info">
                    <span class="history-title">${pack.client?.name || 'Unknown Client'}</span>
                    <span class="history-meta">${new Date(pack.generatedAt).toLocaleString()} • ${outputIntent}</span>
                </div>
                <span class="history-status ${statusClass}">
                    ${statusLabel}
                </span>
                <div class="history-actions">
                    <button class="btn btn-ghost btn-sm" onclick="viewHistoryPack('${pack.id}')">View</button>
                    ${!isNarrative ? `<button class="btn btn-ghost btn-sm" onclick="exportHistoryPack('${pack.id}')">Export</button>` : ''}
                </div>
            </div>
        `}).join('');
    }
}

function viewHistoryPack(packId) {
    const pack = state.generatedPacks.find(p => p.id === packId);
    if (!pack) return;
    
    // Set up client context
    state.selectedClient = pack.client;
    state.currentContext = pack.context;
    state.currentSourcePack = pack.sourcePack;
    
    // Switch to the generate view
    switchView('generate');
    
    // Restore POC file if available in history entry
    if (pack.pocFile) {
        state.pocFile = pack.pocFile;
    }
    
    // Check if this is a narrative entry
    if (pack.type === 'narrative' && pack.narrative) {
        // Go directly to Step 6 (Narrative)
        goToStep(6);
        
        // Load client narratives and then display the specific one
        if (pack.client?.id) {
            loadClientNarratives(pack.client.id).then(() => {
                // Display the narrative from the history entry
                displayNarrative(pack.narrative);
            });
        } else {
            // No client ID, just display the narrative directly
            displayNarrative(pack.narrative);
        }
    } else {
        // Source Pack entry - go to Step 5 (Review)
        renderReview(pack.sourcePack, pack.validation);
        goToStep(5);
        
        // Pre-load narratives for this client
        if (pack.client?.id) {
            loadClientNarratives(pack.client.id);
        }
    }
}

function exportHistoryPack(packId) {
    const pack = state.generatedPacks.find(p => p.id === packId);
    if (pack) {
        state.currentSourcePack = pack.sourcePack;
        exportJSON();
    }
}

// ============================================
// Admin Functions
// ============================================
async function loadCredentialStatus() {
    try {
        if (state.isElectron) {
            const status = await window.electronAPI.config.getCredentials();
            
            // Update AlphaSense status
            const alphasenseStatus = document.getElementById('credStatusAlphasense');
            if (alphasenseStatus) {
                alphasenseStatus.textContent = status.alphasense?.configured ? 'Configured' : 'Not Configured';
                alphasenseStatus.className = `credential-status ${status.alphasense?.configured ? 'configured' : 'not-configured'}`;
            }
            
            // Update ARC status
            const arcStatus = document.getElementById('credStatusArc');
            if (arcStatus) {
                arcStatus.textContent = status.arc?.configured ? 'Configured' : 'Placeholder';
                arcStatus.className = `credential-status ${status.arc?.configured ? 'configured' : 'placeholder'}`;
            }
            
            // Update OpenAI status
            const openaiStatus = document.getElementById('credStatusOpenai');
            if (openaiStatus) {
                openaiStatus.textContent = status.openai?.configured ? 'Configured' : 'Not Configured';
                openaiStatus.className = `credential-status ${status.openai?.configured ? 'configured' : 'not-configured'}`;
            }
            
            // Update Runway ML status
            const runwayStatus = document.getElementById('credStatusRunway');
            if (runwayStatus) {
                runwayStatus.textContent = status.runway?.configured ? 'Configured' : 'Not Configured';
                runwayStatus.className = `credential-status ${status.runway?.configured ? 'configured' : 'not-configured'}`;
            }
            
            // Update ElevenLabs status
            const elevenlabsStatus = document.getElementById('credStatusElevenlabs');
            if (elevenlabsStatus) {
                elevenlabsStatus.textContent = status.elevenlabs?.configured ? 'Configured' : 'Not Configured';
                elevenlabsStatus.className = `credential-status ${status.elevenlabs?.configured ? 'configured' : 'not-configured'}`;
            }
            
            // Load masked credentials for each provider
            await loadMaskedCredentials('alphasense');
            await loadMaskedCredentials('arc');
            await loadMaskedCredentials('openai');
            await loadMaskedCredentials('runway');
            await loadMaskedCredentials('elevenlabs');
        }
    } catch (error) {
        console.error('Failed to load credential status:', error);
    }
}

async function loadMaskedCredentials(provider) {
    try {
        const masked = await window.electronAPI.config.getMaskedCredentials(provider);
        if (!masked) return;
        
        // Find the form for this provider and populate fields
        const form = document.getElementById(`${provider}CredForm`);
        if (!form) return;
        
        // Populate fields with masked values
        for (const [key, value] of Object.entries(masked)) {
            if (key === 'configured' || key === 'lastUpdated' || key.endsWith('_configured')) continue;
            
            const input = form.querySelector(`[name="${key}"]`);
            if (input && value) {
                // For password fields, show masked value as placeholder
                if (input.type === 'password') {
                    input.placeholder = value;
                } else if (input.tagName === 'SELECT') {
                    // For select elements, set the value
                    input.value = value;
                } else {
                    input.placeholder = value;
                }
                // Mark as having saved value
                if (masked[key + '_configured']) {
                    input.dataset.hasSavedValue = 'true';
                }
            }
        }
    } catch (error) {
        console.error(`Failed to load masked credentials for ${provider}:`, error);
    }
}

async function loadAuditLogs() {
    try {
        let logs;
        
        if (state.isElectron) {
            logs = await window.electronAPI.audit.getLogs(50);
        } else {
            logs = [
                { timestamp: new Date().toISOString(), category: 'AUTH', action: 'LOGIN_SUCCESS', details: { user: 'demo' } }
            ];
        }
        
        elements.auditLogBody.innerHTML = logs.map(log => `
            <tr>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td><span class="log-category ${log.category.toLowerCase()}">${log.category}</span></td>
                <td>${log.action}</td>
                <td>${log.details?.user || log.details?.username || '-'}</td>
                <td class="log-details">${formatLogDetails(log.details)}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Failed to load audit logs:', error);
        elements.auditLogBody.innerHTML = '<tr><td colspan="5" class="text-center">Failed to load audit logs</td></tr>';
    }
}

function formatLogDetails(details) {
    if (!details) return '-';
    const filtered = { ...details };
    delete filtered.user;
    delete filtered.username;
    const str = JSON.stringify(filtered);
    return str.length > 100 ? str.slice(0, 100) + '...' : str;
}

async function saveCredentials(provider, formData) {
    try {
        const credentials = {};
        formData.forEach((value, key) => {
            if (value) credentials[key] = value;
        });
        
        if (Object.keys(credentials).length === 0) {
            showToast('Please enter credentials', 'warning');
            return;
        }
        
        if (state.isElectron) {
            await window.electronAPI.config.setCredentials(provider, credentials);
            showToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} credentials saved`, 'success');
            addActivity(`Updated ${provider} API credentials`, 'info');
            loadCredentialStatus();
        }
    } catch (error) {
        showToast('Failed to save credentials: ' + error.message, 'error');
    }
}

async function testConnection(provider) {
    try {
        showToast(`Testing ${provider} connection...`, 'info');
        
        if (state.isElectron) {
            const result = await window.electronAPI.config.testConnection(provider);
            
            if (result.success) {
                showToast(`${provider} connection successful (${result.latency})`, 'success');
            } else {
                showToast(`${provider} connection failed: ${result.error}`, 'error');
            }
        } else {
            showToast('Connection testing requires Electron', 'warning');
        }
    } catch (error) {
        showToast('Connection test failed: ' + error.message, 'error');
    }
}

// ============================================
// Workshop Templates Management
// ============================================
async function loadWorkshopTemplatesStatus() {
    if (!state.isElectron || !window.electronAPI?.workshop) return;
    
    try {
        const templates = await window.electronAPI.workshop.getTemplates();
        
        // Update PPTX status
        const pptxStatus = document.getElementById('workshopPptxStatus');
        const pptxFilename = document.getElementById('workshopPptxFilename');
        const clearPptxBtn = document.getElementById('clearWorkshopPptxBtn');
        
        if (templates.pptx) {
            if (pptxStatus) {
                pptxStatus.textContent = 'Uploaded';
                pptxStatus.classList.add('uploaded');
            }
            if (pptxFilename) pptxFilename.textContent = templates.pptx.filename;
            if (clearPptxBtn) clearPptxBtn.style.display = 'inline-flex';
        } else {
            if (pptxStatus) {
                pptxStatus.textContent = 'No file uploaded';
                pptxStatus.classList.remove('uploaded');
            }
            if (pptxFilename) pptxFilename.textContent = '';
            if (clearPptxBtn) clearPptxBtn.style.display = 'none';
        }
        
        // Update DOCX status
        const docxStatus = document.getElementById('workshopDocxStatus');
        const docxFilename = document.getElementById('workshopDocxFilename');
        const clearDocxBtn = document.getElementById('clearWorkshopDocxBtn');
        
        if (templates.docx) {
            if (docxStatus) {
                docxStatus.textContent = 'Uploaded';
                docxStatus.classList.add('uploaded');
            }
            if (docxFilename) docxFilename.textContent = templates.docx.filename;
            if (clearDocxBtn) clearDocxBtn.style.display = 'inline-flex';
        } else {
            if (docxStatus) {
                docxStatus.textContent = 'No file uploaded';
                docxStatus.classList.remove('uploaded');
            }
            if (docxFilename) docxFilename.textContent = '';
            if (clearDocxBtn) clearDocxBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to load workshop templates status:', error);
    }
}

async function uploadWorkshopTemplate(type) {
    if (!state.isElectron || !window.electronAPI?.workshop) {
        showToast('Template upload requires desktop app', 'warning');
        return;
    }
    
    try {
        const result = await window.electronAPI.workshop.uploadTemplate(type);
        
        if (result.success) {
            showToast(`${type.toUpperCase()} template uploaded: ${result.filename}`, 'success');
            loadWorkshopTemplatesStatus();
        } else if (!result.canceled) {
            showToast(result.error || 'Failed to upload template', 'error');
        }
    } catch (error) {
        console.error('Failed to upload workshop template:', error);
        showToast('Failed to upload template: ' + error.message, 'error');
    }
}

async function clearWorkshopTemplate(type) {
    if (!state.isElectron || !window.electronAPI?.workshop) return;
    
    try {
        await window.electronAPI.workshop.clearTemplate(type);
        showToast(`${type.toUpperCase()} template cleared`, 'info');
        loadWorkshopTemplatesStatus();
    } catch (error) {
        console.error('Failed to clear workshop template:', error);
        showToast('Failed to clear template: ' + error.message, 'error');
    }
}

// ============================================
// Placeholder Management
// ============================================
async function loadPlaceholders() {
    if (!state.isElectron || !window.electronAPI?.placeholders) return;
    
    try {
        const placeholders = await window.electronAPI.placeholders.getAll();
        renderPlaceholdersList(placeholders);
    } catch (error) {
        console.error('Failed to load placeholders:', error);
    }
}

function renderPlaceholdersList(placeholders) {
    const listEl = document.getElementById('placeholdersList');
    const emptyEl = document.getElementById('emptyPlaceholders');
    
    if (!listEl) {
        console.error('[Placeholders] List element not found');
        return;
    }
    
    console.log(`[Placeholders] Rendering ${placeholders?.length || 0} placeholders`);
    
    if (!placeholders || placeholders.length === 0) {
        // Show empty state
        listEl.innerHTML = `
            <div id="emptyPlaceholders" class="empty-placeholders" style="display: flex;">
                <p>No placeholders defined yet</p>
                <p class="hint">Add placeholders to auto-fill template variables</p>
            </div>
        `;
        return;
    }
    
    // Render placeholder items
    listEl.innerHTML = placeholders.map(p => {
        const listBadge = p.isList 
            ? `<span class="placeholder-list-badge" title="List placeholder with ${p.listCount} items">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                   <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                 </svg>
                 List (${p.listCount})
               </span>` 
            : '';
        
        const titleBodyBadge = p.hasTitleBody
            ? `<span class="placeholder-list-badge" title="Generates title and body" style="background: rgba(139, 92, 246, 0.2); color: #a78bfa;">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                   <path d="M4 6h16M4 12h10M4 18h14"/>
                 </svg>
                 Title/Body
               </span>`
            : '';
        
        // Build max chars badge based on placeholder type
        let maxCharsBadge = '';
        if (p.hasTitleBody && (p.maxCharsTitle || p.maxCharsBody)) {
            const titlePart = p.maxCharsTitle ? `T≤${p.maxCharsTitle}` : '';
            const bodyPart = p.maxCharsBody ? `B≤${p.maxCharsBody}` : '';
            const combined = [titlePart, bodyPart].filter(Boolean).join(' ');
            maxCharsBadge = `<span class="placeholder-list-badge" title="Title: ${p.maxCharsTitle || 'no limit'}, Body: ${p.maxCharsBody || 'no limit'}" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">
                 ${combined}
               </span>`;
        } else if (p.maxChars) {
            maxCharsBadge = `<span class="placeholder-list-badge" title="Max ${p.maxChars} characters per output" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">
                 ≤${p.maxChars}
               </span>`;
        }
        
        // Build usage hint based on configuration
        let usageHint;
        if (p.isList && p.hasTitleBody) {
            usageHint = `Use {{${p.name}[1][title]}}, {{${p.name}[1][body]}}, ... {{${p.name}[${p.listCount}][title]}}, {{${p.name}[${p.listCount}][body]}}`;
        } else if (p.isList) {
            usageHint = `Use {{${p.name}[1]}}, {{${p.name}[2]}}, ... {{${p.name}[${p.listCount}]}} in templates`;
        } else if (p.hasTitleBody) {
            usageHint = `Use {{${p.name}[title]}} and {{${p.name}[body]}} in templates`;
        } else {
            usageHint = `Use {{${p.name}}} in templates`;
        }
        
        return `
        <div class="placeholder-item" data-id="${p.id}">
            <div class="placeholder-header">
                <div class="placeholder-name-container">
                    <code class="placeholder-code">{{${p.name}}}</code>
                    ${listBadge}
                    ${titleBodyBadge}
                    ${maxCharsBadge}
                </div>
                <div class="placeholder-actions">
                    <button class="btn btn-ghost btn-sm edit-placeholder" data-id="${p.id}" title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-ghost btn-sm delete-placeholder" data-id="${p.id}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="placeholder-prompt">${escapeHtml(p.prompt)}</div>
            <div class="placeholder-usage-hint">${usageHint}</div>
        </div>
    `}).join('');
    
    // Add event listeners
    listEl.querySelectorAll('.edit-placeholder').forEach(btn => {
        btn.addEventListener('click', () => editPlaceholder(btn.dataset.id));
    });
    
    listEl.querySelectorAll('.delete-placeholder').forEach(btn => {
        btn.addEventListener('click', () => deletePlaceholder(btn.dataset.id));
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function addPlaceholder() {
    console.log('[Placeholder] Opening modal');
    showPlaceholderModal();
}

// Placeholder Modal Management
let editingPlaceholderId = null;

function showPlaceholderModal(placeholder = null) {
    const modal = document.getElementById('placeholderModal');
    const title = document.getElementById('placeholderModalTitle');
    const nameInput = document.getElementById('placeholderName');
    const promptInput = document.getElementById('placeholderPrompt');
    const isListCheckbox = document.getElementById('placeholderIsList');
    const listCountInput = document.getElementById('placeholderListCount');
    const listHint = document.getElementById('listPlaceholderHint');
    const listCountGroup = document.getElementById('listCountGroup');
    const hasTitleBodyCheckbox = document.getElementById('placeholderHasTitleBody');
    const titleBodyHint = document.getElementById('titleBodyPlaceholderHint');
    const maxCharsInput = document.getElementById('placeholderMaxChars');
    const maxCharsGroup = document.getElementById('maxCharsGroup');
    const maxCharsTitleBodyGroup = document.getElementById('maxCharsTitleBodyGroup');
    const maxCharsTitleInput = document.getElementById('placeholderMaxCharsTitle');
    const maxCharsBodyInput = document.getElementById('placeholderMaxCharsBody');
    
    if (!modal) {
        console.error('[Placeholder] Modal not found');
        return;
    }
    
    // Setup list checkbox toggle
    if (isListCheckbox) {
        isListCheckbox.onchange = () => {
            const showListOptions = isListCheckbox.checked;
            if (listHint) listHint.style.display = showListOptions ? 'block' : 'none';
            if (listCountGroup) listCountGroup.style.display = showListOptions ? 'block' : 'none';
        };
    }
    
    // Setup title/body checkbox toggle - show/hide appropriate char limit fields
    if (hasTitleBodyCheckbox) {
        hasTitleBodyCheckbox.onchange = () => {
            const isTitleBody = hasTitleBodyCheckbox.checked;
            if (titleBodyHint) titleBodyHint.style.display = isTitleBody ? 'block' : 'none';
            if (maxCharsGroup) maxCharsGroup.style.display = isTitleBody ? 'none' : 'block';
            if (maxCharsTitleBodyGroup) maxCharsTitleBodyGroup.style.display = isTitleBody ? 'block' : 'none';
        };
    }
    
    if (placeholder) {
        // Edit mode
        title.textContent = 'Edit Placeholder';
        nameInput.value = placeholder.name;
        promptInput.value = placeholder.prompt;
        if (isListCheckbox) {
            isListCheckbox.checked = placeholder.isList || false;
            isListCheckbox.onchange(); // Trigger display update
        }
        if (listCountInput) {
            listCountInput.value = placeholder.listCount || 5;
        }
        if (hasTitleBodyCheckbox) {
            hasTitleBodyCheckbox.checked = placeholder.hasTitleBody || false;
            hasTitleBodyCheckbox.onchange(); // Trigger display update
        }
        if (maxCharsInput) {
            maxCharsInput.value = placeholder.maxChars || '';
        }
        if (maxCharsTitleInput) {
            maxCharsTitleInput.value = placeholder.maxCharsTitle || '';
        }
        if (maxCharsBodyInput) {
            maxCharsBodyInput.value = placeholder.maxCharsBody || '';
        }
        editingPlaceholderId = placeholder.id;
    } else {
        // Add mode
        title.textContent = 'Add Placeholder';
        nameInput.value = '';
        promptInput.value = '';
        if (isListCheckbox) {
            isListCheckbox.checked = false;
            isListCheckbox.onchange(); // Trigger display update
        }
        if (listCountInput) {
            listCountInput.value = 5;
        }
        if (hasTitleBodyCheckbox) {
            hasTitleBodyCheckbox.checked = false;
            hasTitleBodyCheckbox.onchange(); // Trigger display update
        }
        if (maxCharsInput) {
            maxCharsInput.value = '';
        }
        if (maxCharsTitleInput) {
            maxCharsTitleInput.value = '';
        }
        if (maxCharsBodyInput) {
            maxCharsBodyInput.value = '';
        }
        editingPlaceholderId = null;
    }
    
    modal.classList.remove('hidden');
    nameInput.focus();
}

function hidePlaceholderModal() {
    const modal = document.getElementById('placeholderModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    editingPlaceholderId = null;
}

async function savePlaceholder(e) {
    e.preventDefault();
    
    const nameInput = document.getElementById('placeholderName');
    const promptInput = document.getElementById('placeholderPrompt');
    const isListCheckbox = document.getElementById('placeholderIsList');
    const listCountInput = document.getElementById('placeholderListCount');
    const hasTitleBodyCheckbox = document.getElementById('placeholderHasTitleBody');
    const maxCharsInput = document.getElementById('placeholderMaxChars');
    const maxCharsTitleInput = document.getElementById('placeholderMaxCharsTitle');
    const maxCharsBodyInput = document.getElementById('placeholderMaxCharsBody');
    
    const name = nameInput.value.trim();
    const promptText = promptInput.value.trim();
    const isList = isListCheckbox?.checked || false;
    const listCount = isList ? parseInt(listCountInput?.value || 5) : null;
    const hasTitleBody = hasTitleBodyCheckbox?.checked || false;
    const maxChars = maxCharsInput?.value ? parseInt(maxCharsInput.value) : null;
    const maxCharsTitle = maxCharsTitleInput?.value ? parseInt(maxCharsTitleInput.value) : null;
    const maxCharsBody = maxCharsBodyInput?.value ? parseInt(maxCharsBodyInput.value) : null;
    
    if (!name || !promptText) {
        showToast('Please fill in all fields', 'warning');
        return;
    }
    
    if (!state.isElectron || !window.electronAPI?.placeholders) {
        showToast('Placeholder management requires desktop app', 'warning');
        return;
    }
    
    try {
        let result;
        
        if (editingPlaceholderId) {
            // Update existing
            result = await window.electronAPI.placeholders.update(editingPlaceholderId, {
                name: name,
                prompt: promptText,
                isList: isList,
                listCount: listCount,
                hasTitleBody: hasTitleBody,
                maxChars: maxChars,
                maxCharsTitle: maxCharsTitle,
                maxCharsBody: maxCharsBody
            });
            
            if (result.success) {
                showToast(`Placeholder {{${name}}} updated`, 'success');
            }
        } else {
            // Add new
            result = await window.electronAPI.placeholders.add({
                name: name,
                prompt: promptText,
                isList: isList,
                listCount: listCount,
                hasTitleBody: hasTitleBody,
                maxChars: maxChars,
                maxCharsTitle: maxCharsTitle,
                maxCharsBody: maxCharsBody
            });
            
            if (result.success) {
                const listInfo = isList ? ` (list with ${listCount} items)` : '';
                const titleBodyInfo = hasTitleBody ? ' (title/body)' : '';
                showToast(`Placeholder {{${result.placeholder.name}}}${listInfo}${titleBodyInfo} added`, 'success');
            }
        }
        
        if (result.success) {
            hidePlaceholderModal();
            loadPlaceholders();
        } else {
            showToast(result.error || 'Failed to save placeholder', 'error');
        }
    } catch (error) {
        console.error('Failed to save placeholder:', error);
        showToast('Failed to save placeholder: ' + error.message, 'error');
    }
}

async function editPlaceholder(id) {
    if (!state.isElectron || !window.electronAPI?.placeholders) return;
    
    try {
        const placeholders = await window.electronAPI.placeholders.getAll();
        const placeholder = placeholders.find(p => p.id === id);
        
        if (!placeholder) {
            showToast('Placeholder not found', 'error');
            return;
        }
        
        showPlaceholderModal(placeholder);
    } catch (error) {
        console.error('Failed to edit placeholder:', error);
        showToast('Failed to load placeholder: ' + error.message, 'error');
    }
}

async function deletePlaceholder(id) {
    if (!confirm('Are you sure you want to delete this placeholder?')) return;
    
    try {
        const result = await window.electronAPI.placeholders.delete(id);
        
        if (result.success) {
            showToast('Placeholder deleted', 'info');
            loadPlaceholders();
        } else {
            showToast(result.error || 'Failed to delete placeholder', 'error');
        }
    } catch (error) {
        console.error('Failed to delete placeholder:', error);
        showToast('Failed to delete placeholder: ' + error.message, 'error');
    }
}

// Export placeholders to Excel
async function exportPlaceholders() {
    if (!state.isElectron || !window.electronAPI?.placeholders?.export) {
        showToast('Export requires desktop app', 'warning');
        return;
    }
    
    try {
        const result = await window.electronAPI.placeholders.export();
        
        if (result.canceled) {
            return; // User cancelled
        }
        
        if (result.success) {
            showToast(`Exported ${result.count} placeholders to Excel`, 'success');
        } else {
            showToast(result.error || 'Failed to export placeholders', 'error');
        }
    } catch (error) {
        console.error('Failed to export placeholders:', error);
        showToast('Failed to export: ' + error.message, 'error');
    }
}

// Import placeholders from Excel
async function importPlaceholders() {
    if (!state.isElectron || !window.electronAPI?.placeholders?.import) {
        showToast('Import requires desktop app', 'warning');
        return;
    }
    
    if (!confirm('This will replace all existing placeholders with the imported ones. Continue?')) {
        return;
    }
    
    try {
        const result = await window.electronAPI.placeholders.import();
        
        if (result.canceled) {
            return; // User cancelled
        }
        
        if (result.success) {
            let message = `Imported ${result.count} placeholders`;
            if (result.errors && result.errors.length > 0) {
                message += ` (${result.errors.length} rows skipped)`;
                console.warn('Import errors:', result.errors);
            }
            showToast(message, 'success');
            loadPlaceholders();
        } else {
            showToast(result.error || 'Failed to import placeholders', 'error');
        }
    } catch (error) {
        console.error('Failed to import placeholders:', error);
        showToast('Failed to import: ' + error.message, 'error');
    }
}

// ============================================
// Schema Modal
// ============================================
function showSchemaModal() {
    const schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "R/StudioGPT - Source Pack Schema",
        "description": "Canonical schema for structured, evidence-linked intelligence packs",
        "version": "1.0.0",
        "type": "object",
        "required": [
            "client",
            "context",
            "company_profile",
            "alphasense_consensus",
            "competitor_moves",
            "industry_kpis",
            "regulatory_events",
            "confidence_scores",
            "sources",
            "metadata"
        ],
        "properties": {
            "client": {
                "type": "object",
                "description": "Client organization information",
                "properties": {
                    "id": { "type": "string", "description": "Unique client identifier" },
                    "name": { "type": "string", "description": "Client organization name" },
                    "industry": { "type": "string", "description": "Primary industry classification" },
                    "geography": { "type": "string", "description": "Primary geographic region" },
                    "sector": { "type": "string", "description": "Industry sub-sector" }
                },
                "required": ["id", "name", "industry", "geography"]
            },
            "context": {
                "type": "object",
                "description": "Generation context and parameters",
                "properties": {
                    "industry": { "type": "string" },
                    "subSector": { "type": "string" },
                    "geography": { "type": "string" },
                    "timeHorizon": { "type": "integer", "description": "Lookback period in days" },
                    "outputIntent": { "type": "string", "enum": ["CEO Narrative", "Board Pack", "Strategy Brief", "Industry Report", "Competitive Analysis"] }
                }
            },
            "company_profile": {
                "type": "object",
                "description": "AI-synthesized company profile",
                "properties": {
                    "name": { "type": "string" },
                    "executive_summary": { "type": "string" },
                    "strategic_priorities": { "type": "array", "items": { "type": "string" } },
                    "key_challenges": { "type": "array", "items": { "type": "string" } },
                    "opportunities": { "type": "array", "items": { "type": "string" } },
                    "risk_factors": { "type": "array", "items": { "type": "string" } }
                }
            },
            "alphasense_consensus": {
                "type": "object",
                "description": "Analyst consensus insights from AlphaSense",
                "properties": {
                    "themes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "theme": { "type": "string" },
                                "confidence": { "type": "number", "minimum": 0, "maximum": 100 },
                                "summary": { "type": "string" }
                            }
                        }
                    },
                    "key_quotes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "quote": { "type": "string" },
                                "source": { "type": "string" },
                                "date": { "type": "string" }
                            }
                        }
                    },
                    "sentiment": {
                        "type": "object",
                        "properties": {
                            "overall": { "type": "string", "enum": ["bullish", "neutral", "bearish"] },
                            "trend": { "type": "string", "enum": ["improving", "stable", "declining"] }
                        }
                    },
                    "divergent_views": { "type": "array" }
                }
            },
            "competitor_moves": {
                "type": "array",
                "description": "Recent competitor strategic moves",
                "items": {
                    "type": "object",
                    "properties": {
                        "competitor": { "type": "string" },
                        "move": { "type": "string" },
                        "impact": { "type": "string" },
                        "source": { "type": "string" }
                    }
                }
            },
            "industry_kpis": {
                "type": "object",
                "description": "Industry KPIs and benchmarks from ARC",
                "additionalProperties": {
                    "type": "object",
                    "properties": {
                        "value": { "type": "string" },
                        "benchmark": { "type": "string" },
                        "percentile": { "type": "number" },
                        "trend": { "type": "string", "enum": ["up", "down", "stable"] }
                    }
                }
            },
            "regulatory_events": {
                "type": "array",
                "description": "Relevant regulatory events and changes",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "regulator": { "type": "string" },
                        "jurisdiction": { "type": "string" },
                        "impact": { "type": "string", "enum": ["High", "Medium", "Low"] },
                        "effective_date": { "type": "string" },
                        "summary": { "type": "string" }
                    }
                }
            },
            "confidence_scores": {
                "type": "object",
                "description": "AI-assigned confidence scores",
                "properties": {
                    "overall": { "type": "number", "minimum": 0, "maximum": 100 },
                    "data_completeness": { "type": "number", "minimum": 0, "maximum": 100 },
                    "source_quality": { "type": "number", "minimum": 0, "maximum": 100 },
                    "timeliness": { "type": "number", "minimum": 0, "maximum": 100 }
                }
            },
            "sources": {
                "type": "array",
                "description": "All sources used in generation",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "type": { "type": "string", "enum": ["analyst", "regulatory", "news", "benchmark", "company"] },
                        "source": { "type": "string" },
                        "url": { "type": "string" },
                        "date": { "type": "string" }
                    }
                }
            },
            "metadata": {
                "type": "object",
                "description": "Generation metadata for audit",
                "properties": {
                    "request_id": { "type": "string" },
                    "generated_at": { "type": "string", "format": "date-time" },
                    "generated_by": { "type": "string" },
                    "user_role": { "type": "string" },
                    "processing_time_ms": { "type": "integer" },
                    "schema_version": { "type": "string" },
                    "apis_used": { "type": "array", "items": { "type": "string" } }
                }
            }
        }
    };
    
    elements.schemaCode.textContent = JSON.stringify(schema, null, 2);
    elements.schemaModal.classList.remove('hidden');
}

function hideSchemaModal() {
    elements.schemaModal.classList.add('hidden');
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${type === 'success' ? '<path d="M5 13l4 4L19 7"/>' :
                  type === 'error' ? '<path d="M6 18L18 6M6 6l12 12"/>' :
                  type === 'warning' ? '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>' :
                  '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'}
            </svg>
        </div>
        <span class="toast-message">${message}</span>
    `;
    
    elements.toastContainer.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================
// Confirmation Modal
// ============================================
function showConfirmModal(options = {}) {
    const {
        title = 'Confirm Action',
        message = 'Are you sure you want to proceed?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        type = 'warning', // 'warning' or 'danger'
        onConfirm = () => {},
        onCancel = () => {}
    } = options;
    
    const modal = document.getElementById('confirmModal');
    const modalTitle = document.getElementById('confirmModalTitle');
    const modalMessage = document.getElementById('confirmModalMessage');
    const modalIcon = document.getElementById('confirmModalIcon');
    const confirmBtn = document.getElementById('confirmModalConfirm');
    const cancelBtn = document.getElementById('confirmModalCancel');
    
    if (!modal) return;
    
    // Set content
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    
    // Set icon style based on type
    modalIcon.className = `confirm-icon ${type === 'danger' ? 'danger' : ''}`;
    confirmBtn.className = `btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`;
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Clean up old listeners by cloning buttons
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    // Close modal function
    const closeModal = () => {
        modal.classList.add('hidden');
    };
    
    // Add event listeners
    newConfirmBtn.addEventListener('click', () => {
        closeModal();
        onConfirm();
    });
    
    newCancelBtn.addEventListener('click', () => {
        closeModal();
        onCancel();
    });
    
    // Close on backdrop click
    modal.querySelector('.modal-backdrop').addEventListener('click', () => {
        closeModal();
        onCancel();
    }, { once: true });
    
    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            onCancel();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// ============================================
// Event Listeners Setup
// ============================================
// ============================================
// AI Agent Console (Admin Feature) - Floating Panel
// ============================================
const aiConsole = {
    output: null,
    section: null,
    status: null,
    isMinimized: false,
    
    init() {
        this.output = document.getElementById('aiConsoleOutput');
        this.section = document.getElementById('aiConsoleSection');
        this.status = document.getElementById('consoleStatus');
        this.header = document.querySelector('.ai-console-header');
        
        // Setup console controls
        const clearBtn = document.getElementById('clearConsoleBtn');
        const minimizeBtn = document.getElementById('minimizeConsoleBtn');
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clear());
        }
        
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => this.toggleMinimize());
        }
        
        // Click on header to expand when minimized
        if (this.header) {
            this.header.addEventListener('click', (e) => {
                // Only expand if minimized and not clicking on a button
                if (this.isMinimized && !e.target.closest('button')) {
                    this.toggleMinimize();
                }
            });
        }
        
        // Listen for AI console logs from main process
        if (state.isElectron && window.electronAPI.onAiConsoleLog) {
            window.electronAPI.onAiConsoleLog((data) => this.addLog(data));
        }
    },
    
    show() {
        if (this.section && state.user?.role === 'admin') {
            this.section.classList.remove('hidden');
        }
    },
    
    hide() {
        if (this.section) {
            this.section.classList.add('hidden');
        }
    },
    
    addLog(data) {
        if (!this.output) return;
        
        // Show console if admin (auto-show on first log)
        if (state.user?.role === 'admin') {
            this.show();
        } else {
            return; // Don't log if not admin
        }
        
        const { timestamp, agent, message, type } = data;
        
        // Update status indicator (flash green when active)
        if (this.status) {
            if (type === 'thinking') {
                this.status.classList.add('active');
            } else if (message.includes('complete!')) {
                this.status.classList.remove('active');
            }
        }
        
        // Map agent names to CSS classes and short labels
        const agentMap = {
            'system': { class: 'agent-system', label: 'SYS' },
            'researcher': { class: 'agent-researcher', label: 'RSRCH' },
            'analyst': { class: 'agent-analyst', label: 'ANLST' },
            'synthesizer': { class: 'agent-synthesizer', label: 'SYNTH' },
            'storyteller': { class: 'agent-storyteller', label: 'STORY' },
            'narrator': { class: 'agent-narrator', label: 'NARR' }
        };
        
        const agentInfo = agentMap[agent] || { class: 'agent-system', label: 'SYS' };
        const messageClass = type === 'thinking' ? 'thinking' : 
                            type === 'error' ? 'error' :
                            type === 'success' ? 'success' : '';
        
        const logLine = document.createElement('div');
        logLine.className = 'console-line';
        logLine.innerHTML = `
            <span class="console-timestamp">[${timestamp}]</span>
            <span class="agent-label ${agentInfo.class}">${agentInfo.label}</span>
            <span class="console-message ${messageClass}">${this.escapeHtml(message)}</span>
        `;
        
        this.output.appendChild(logLine);
        
        // Auto-scroll to bottom
        this.output.scrollTop = this.output.scrollHeight;
        
        // If minimized and new log arrives, briefly flash the header
        if (this.isMinimized && this.section) {
            this.section.classList.add('flash');
            setTimeout(() => this.section.classList.remove('flash'), 500);
        }
    },
    
    clear() {
        if (!this.output) return;
        
        this.output.innerHTML = `
            <div class="console-welcome">
                <span class="console-timestamp">[${new Date().toLocaleTimeString('en-GB', { hour12: false })}]</span>
                <span class="agent-label agent-system">SYS</span>
                <span class="console-message">Console cleared. Waiting for generation...</span>
            </div>
        `;
        
        if (this.status) {
            this.status.textContent = 'Idle';
            this.status.classList.remove('active');
        }
    },
    
    toggleMinimize() {
        if (!this.section) return;
        
        this.isMinimized = !this.isMinimized;
        this.section.classList.toggle('minimized', this.isMinimized);
        
        const icon = document.getElementById('minimizeIcon');
        if (icon) {
            icon.innerHTML = this.isMinimized 
                ? '<path d="M12 4v16m-8-8h16"/>'  // Plus icon when minimized
                : '<path d="M20 12H4"/>';          // Minus icon when expanded
        }
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

function setupEventListeners() {
    // Login
    elements.loginForm.addEventListener('submit', handleLogin);
    
    // Logout
    elements.logoutBtn.addEventListener('click', handleLogout);
    
    // Navigation
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view === 'admin' && state.user?.role !== 'admin') {
                showToast('Admin access required', 'error');
                return;
            }
            // If navigating to generate view, reset the wizard for a fresh start
            if (view === 'generate') {
                resetWizard();
            }
            switchView(view);
        });
    });
    
    // Dashboard quick actions
    elements.quickGenerateBtn?.addEventListener('click', () => {
        resetWizard();
        switchView('generate');
    });
    
    elements.btnNewSourcePack?.addEventListener('click', () => {
        resetWizard();
        switchView('generate');
    });
    
    elements.btnViewClients?.addEventListener('click', () => {
        switchView('generate');
        goToStep(1);
    });
    
    elements.btnViewSchema?.addEventListener('click', showSchemaModal);
    
    // Start Over button in generate view
    document.getElementById('startOverBtn')?.addEventListener('click', () => {
        // Confirm if generation is in progress
        if (state.isGenerating) {
            showConfirmModal({
                title: 'Start Over?',
                message: 'A generation is currently in progress. Starting over will cancel it and reset all your selections.',
                confirmText: 'Start Over',
                cancelText: 'Keep Working',
                type: 'warning',
                onConfirm: () => {
                    // Cancel the current generation
                    if (state.isElectron && window.electronAPI.narrative?.cancel) {
                        window.electronAPI.narrative.cancel();
                    }
                    resetWizard();
                    showToast('Ready for a new generation', 'info');
                }
            });
        } else {
            resetWizard();
            showToast('Ready for a new generation', 'info');
        }
    });
    
    // Generate view
    elements.clientSearch?.addEventListener('input', (e) => {
        renderClientGrid(e.target.value);
    });
    
    // AI client creation
    elements.aiCreateClientBtn?.addEventListener('click', createClientWithAI);
    
    // Also allow Enter key in search to trigger AI create if button is visible
    elements.clientSearch?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const searchTerm = e.target.value.trim();
            const hasExactMatch = state.clients.some(c => c.name.toLowerCase() === searchTerm.toLowerCase());
            
            if (searchTerm.length > 2 && !hasExactMatch && !elements.aiCreateClientBtn?.classList.contains('hidden')) {
                createClientWithAI();
            }
        }
    });
    
    elements.changeClientBtn?.addEventListener('click', () => {
        goToStep(1);
    });
    
    elements.backToStep1?.addEventListener('click', () => {
        goToStep(1);
    });
    
    elements.proceedToGenerate?.addEventListener('click', startGeneration);
    
    // History
    elements.historyGenerateBtn?.addEventListener('click', () => {
        switchView('generate');
        goToStep(1);
    });
    
    // Admin - Credential forms
    elements.alphasenseCredForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCredentials('alphasense', new FormData(e.target));
    });
    
    elements.arcCredForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCredentials('arc', new FormData(e.target));
    });
    
    elements.openaiCredForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCredentials('openai', new FormData(e.target));
    });
    
    // Runway ML credential form
    document.getElementById('runwayCredForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCredentials('runway', new FormData(e.target));
    });
    
    // ElevenLabs credential form
    document.getElementById('elevenlabsCredForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCredentials('elevenlabs', new FormData(e.target));
    });
    
    // Test connection buttons
    document.querySelectorAll('.test-connection').forEach(btn => {
        btn.addEventListener('click', () => testConnection(btn.dataset.provider));
    });
    
    elements.refreshLogsBtn?.addEventListener('click', loadAuditLogs);
    
    // Workshop template buttons
    document.getElementById('uploadWorkshopPptxBtn')?.addEventListener('click', () => uploadWorkshopTemplate('pptx'));
    document.getElementById('uploadWorkshopDocxBtn')?.addEventListener('click', () => uploadWorkshopTemplate('docx'));
    document.getElementById('clearWorkshopPptxBtn')?.addEventListener('click', () => clearWorkshopTemplate('pptx'));
    document.getElementById('clearWorkshopDocxBtn')?.addEventListener('click', () => clearWorkshopTemplate('docx'));
    
    // Placeholder management buttons
    const addPlaceholderBtn = document.getElementById('addPlaceholderBtn');
    if (addPlaceholderBtn) {
        console.log('[Admin] Add placeholder button found, attaching listener');
        addPlaceholderBtn.addEventListener('click', () => {
            console.log('[Admin] Add placeholder button clicked');
            addPlaceholder();
        });
    } else {
        console.warn('[Admin] Add placeholder button not found');
    }
    
    // Export/Import placeholder buttons
    document.getElementById('exportPlaceholdersBtn')?.addEventListener('click', exportPlaceholders);
    document.getElementById('importPlaceholdersBtn')?.addEventListener('click', importPlaceholders);
    
    // Placeholder modal controls
    document.getElementById('closePlaceholderModal')?.addEventListener('click', hidePlaceholderModal);
    document.getElementById('cancelPlaceholderBtn')?.addEventListener('click', hidePlaceholderModal);
    document.getElementById('placeholderModal')?.querySelector('.modal-backdrop')?.addEventListener('click', hidePlaceholderModal);
    document.getElementById('placeholderForm')?.addEventListener('submit', savePlaceholder);
    
    // Schema modal
    elements.closeSchemaModal?.addEventListener('click', hideSchemaModal);
    elements.schemaModal?.querySelector('.modal-backdrop')?.addEventListener('click', hideSchemaModal);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape to close modal
        if (e.key === 'Escape' && !elements.schemaModal.classList.contains('hidden')) {
            hideSchemaModal();
        }
    });
}

function setupDemoCredentials() {
    document.querySelectorAll('.demo-user').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('username').value = btn.dataset.user;
            document.getElementById('password').value = btn.dataset.pass;
        });
    });
}

// ============================================
// Utility Functions
// ============================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Make functions available globally for onclick handlers
window.exportJSON = exportJSON;
window.exportMarkdown = exportMarkdown;
window.resetGeneration = resetGeneration;
window.viewHistoryPack = viewHistoryPack;
window.exportHistoryPack = exportHistoryPack;

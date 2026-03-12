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
    // Workflow navigation
    highestStepReached: 1,    // tracks highest step user has reached (enables back-nav),
    // Step 2: Client Point of Contact file
    pocFile: null,
    // Step 3: Supporting Documents
    supportingDocFiles: [],   // mirrored from backend: {id, fileName, size, ext, status, chunkCount?, error?}
    supportingDocsCorpus: null, // lightweight summary from backend
    // Step 4: Qualification Criteria
    qualificationGenerating: false,
    qualificationMarkdown: null,
    qualDefaultPrompt: null,
    qualGenerationStartTime: null,
    // Step 5: Value Case
    valueCaseGenerating: false,
    valueCaseMarkdown: null,
    valueCaseDefaultPrompt: null,
    valueCaseGenerationStartTime: null,
    valueCaseAssumptions: null,
    // Step 6: Provoke — Origination Engine
    provocationGenerating: false,
    provocationMarkdown: null,
    provokeDefaultPrompt: null,
    provokeGenerationStartTime: null,
    provokeVersions: [],          // Array of { markdown, fileName, label, role, timestamp }
    // Step 7: Review — Consistency & Accuracy Check
    reviewGenerating: false,
    reviewMarkdown: null,
    reviewGenerationStartTime: null,
    reviewSelectedRole: null,
    rewritePending: false,        // Flag: confirmation dialog is for rewrite (not review)
    pendingConfirmAction: null,   // Function: action to execute when confirmation Yes is clicked
    reviewsByRole: {},            // { ceo: markdown, cfo: markdown, ... } — tracks which roles have reviews
    csuitePrompts: {},
    // Step 4 (old): Additional documents
    additionalFiles: [],
    // Step 4: Placeholder sections that need replacement
    placeholderSections: [],
    // Step 4: Source results (new simplified structure)
    sourceResults: {},
    failedSources: [],
    pendingGenerationResult: null,
    pendingGenerationContext: null,
    // Step 6: Narrative Builder generated prompt
    narrativeBuilderPrompt: null,
    // Narrative storage
    clientNarratives: [],
    currentDisplayedNarrative: null,
    // Step 7: Researched contacts (current and exited)
    researchedContacts: {
        current: [],
        exited: []
    }
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
    proceedToStep3: document.getElementById('proceedToStep3'),
    proceedToGenerate: document.getElementById('proceedToGenerate'),
    
    // Step 3: Supporting Documents
    docUploadZone: document.getElementById('docUploadZone'),
    browseDocsBtn: document.getElementById('browseDocsBtn'),
    docFileList: document.getElementById('docFileList'),
    docProcessBar: document.getElementById('docProcessBar'),
    docProcessLabel: document.getElementById('docProcessLabel'),
    docProcessCount: document.getElementById('docProcessCount'),
    docProgressFill: document.getElementById('docProgressFill'),
    docCorpusSummary: document.getElementById('docCorpusSummary'),
    corpusDocCount: document.getElementById('corpusDocCount'),
    corpusChunkCount: document.getElementById('corpusChunkCount'),
    corpusSuccessCount: document.getElementById('corpusSuccessCount'),
    corpusErrorStat: document.getElementById('corpusErrorStat'),
    corpusErrorCount: document.getElementById('corpusErrorCount'),
    processDocsBtn: document.getElementById('processDocsBtn'),
    backToStep2: document.getElementById('backToStep2'),
    proceedToStep4: document.getElementById('proceedToStep4'),
    progressStages: document.getElementById('progressStages'),
    progressMessage: document.getElementById('progressMessage'),
    elapsedTime: document.getElementById('elapsedTime'),
    reviewContainer: document.getElementById('reviewContainer'),
    
    // Step 4: Qualification Criteria
    qualPromptEditor: document.getElementById('qualPromptEditor'),
    resetQualPromptBtn: document.getElementById('resetQualPromptBtn'),
    generateQualBtn: document.getElementById('generateQualBtn'),
    qualProgress: document.getElementById('qualProgress'),
    qualProgressLabel: document.getElementById('qualProgressLabel'),
    qualProgressElapsed: document.getElementById('qualProgressElapsed'),
    qualProgressFill: document.getElementById('qualProgressFill'),
    qualPreview: document.getElementById('qualPreview'),
    qualPreviewContent: document.getElementById('qualPreviewContent'),
    downloadQualDocBtn: document.getElementById('downloadQualDocBtn'),
    regenerateQualBtn: document.getElementById('regenerateQualBtn'),
    backToStep3: document.getElementById('backToStep3'),
    proceedToStep5: document.getElementById('proceedToStep5'),
    
    // Step 5: Value Case
    valueCasePromptEditor: document.getElementById('valueCasePromptEditor'),
    resetValueCasePromptBtn: document.getElementById('resetValueCasePromptBtn'),
    generateValueCaseBtn: document.getElementById('generateValueCaseBtn'),
    valueCaseProgress: document.getElementById('valueCaseProgress'),
    valueCaseProgressLabel: document.getElementById('valueCaseProgressLabel'),
    valueCaseProgressElapsed: document.getElementById('valueCaseProgressElapsed'),
    valueCaseProgressFill: document.getElementById('valueCaseProgressFill'),
    valueCasePreview: document.getElementById('valueCasePreview'),
    valueCasePreviewContent: document.getElementById('valueCasePreviewContent'),
    downloadValueCaseDocBtn: document.getElementById('downloadValueCaseDocBtn'),
    regenerateValueCaseBtn: document.getElementById('regenerateValueCaseBtn'),
    assumptionsTableContainer: document.getElementById('assumptionsTableContainer'),
    assumptionsTableBody: document.getElementById('assumptionsTableBody'),
    assumptionsLoading: document.getElementById('assumptionsLoading'),
    backToStep4VC: document.getElementById('backToStep4'),
    proceedToStep6: document.getElementById('proceedToStep6'),
    
    // Step 6: Provoke — Origination Engine
    provokePromptEditor: document.getElementById('provokePromptEditor'),
    resetProvokePromptBtn: document.getElementById('resetProvokePromptBtn'),
    generateProvokeBtn: document.getElementById('generateProvokeBtn'),
    provokeProgress: document.getElementById('provokeProgress'),
    provokeProgressLabel: document.getElementById('provokeProgressLabel'),
    provokeProgressElapsed: document.getElementById('provokeProgressElapsed'),
    provokeProgressFill: document.getElementById('provokeProgressFill'),
    provokePreview: document.getElementById('provokePreview'),
    provokePreviewContent: document.getElementById('provokePreviewContent'),
    downloadProvokeDocBtn: document.getElementById('downloadProvokeDocBtn'),
    regenerateProvokeBtn: document.getElementById('regenerateProvokeBtn'),
    backToStep5: document.getElementById('backToStep5'),
    proceedToStep7: document.getElementById('proceedToStep7'),
    
    // Step 7: Review — Consistency & Accuracy Check
    reviewAssetsGrid: document.getElementById('reviewAssetsGrid'),
    reviewProgress: document.getElementById('reviewProgress'),
    reviewProgressLabel: document.getElementById('reviewProgressLabel'),
    reviewProgressElapsed: document.getElementById('reviewProgressElapsed'),
    reviewProgressFill: document.getElementById('reviewProgressFill'),
    reviewChecklistsContainer: document.getElementById('reviewChecklistsContainer'),
    backToStep6: document.getElementById('backToStep6'),
    csuiteTilesGrid: document.getElementById('csuiteTilesGrid'),
    csuitePromptEditor: document.getElementById('csuitePromptEditor'),
    csuitePromptEditorTitle: document.getElementById('csuitePromptEditorTitle'),
    csuitePromptTextarea: document.getElementById('csuitePromptTextarea'),
    saveCsuitePromptBtn: document.getElementById('saveCsuitePromptBtn'),
    closeCsuitePromptBtn: document.getElementById('closeCsuitePromptBtn'),
    csuiteConfirmOverlay: document.getElementById('csuiteConfirmOverlay'),
    csuiteConfirmIcon: document.getElementById('csuiteConfirmIcon'),
    csuiteConfirmTitle: document.getElementById('csuiteConfirmTitle'),
    csuiteConfirmDesc: document.getElementById('csuiteConfirmDesc'),
    csuiteConfirmYes: document.getElementById('csuiteConfirmYes'),
    csuiteConfirmNo: document.getElementById('csuiteConfirmNo'),
    
    // Add Documents (utility)
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
                // Clear legacy entries that lack currentStep (old format)
                state.generatedPacks = savedPacks.filter(p => p.type === 'client-session' && typeof p.currentStep === 'number');
                console.log(`[History] Loaded ${state.generatedPacks.length} session entries`);
                // Persist cleaned data
                window.electronAPI.appData.saveGeneratedPacks(state.generatedPacks);
            }
        } catch (e) {
            console.warn('Could not load saved packs:', e);
        }
    }
    
    // Check session
    await checkSession();
    
    // Setup event listeners
    setupEventListeners();

    // Step indicator click-to-navigate — completed/visited steps are clickable
    document.querySelectorAll('.step-indicator .step').forEach(stepEl => {
        stepEl.addEventListener('click', () => {
            const stepNum = parseInt(stepEl.dataset.step);
            if (!stepNum) return;
            // Only allow navigation to steps the user has already reached
            if (stepNum <= state.highestStepReached) {
                goToStep(stepNum);
            }
        });
    });
    
    // Setup POC Upload listeners (Step 2)
    setupPocUploadListeners();
    
    // Setup Supporting Docs upload (Step 3)
    setupSupportingDocsListeners();
    // Setup Qualification Criteria (Step 4)
    setupQualificationListeners();
    // Setup Value Case (Step 5)
    setupValueCaseListeners();
    // Setup Provocation / Origination Engine (Step 6)
    setupProvocationListeners();
    // Setup Review — Consistency & Accuracy Check (Step 7)
    setupReviewListeners();
    // Setup Narrative step listeners
    // Setup Video Generation
    // Setup Narration Generation
    // Setup Narrative Audio Generation (Step 7)
    // Setup Video Narrative Generation (Step 7)
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
                state.generatedPacks = savedPacks.filter(p => p.type === 'client-session' && typeof p.currentStep === 'number');
                console.log(`[History] Loaded ${state.generatedPacks.length} session entries on re-login`);
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
    const views = ['dashboard', 'generate', 'history', 'admin'];
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
               (client.commonName || '').toLowerCase().includes(searchTerm) ||
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
                <div class="client-name-group">
                    <span class="client-name">${client.commonName || client.name}</span>
                    ${client.commonName && client.commonName !== client.name ? `<span class="client-official-name">${client.name}</span>` : ''}
                </div>
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
        
        // Save to history immediately on client selection
        saveSessionProgress(2);
        
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
    // Track high-water mark (highest step the user has reached)
    if (stepNumber > state.highestStepReached) {
        state.highestStepReached = stepNumber;
    }

    // Update step indicators
    document.querySelectorAll('.step').forEach((step, idx) => {
        const stepNum = idx + 1;
        step.classList.remove('active', 'completed', 'clickable');
        if (stepNum < stepNumber) {
            step.classList.add('completed');
        } else if (stepNum === stepNumber) {
            step.classList.add('active');
        }
        // Mark all steps up to highestStepReached as clickable (except current)
        if (stepNum <= state.highestStepReached && stepNum !== stepNumber) {
            step.classList.add('clickable');
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
            `${state.selectedClient.commonName ? 'Known as: ' + state.selectedClient.commonName + ' â€¢ ' : ''}${state.selectedClient.industry} â€¢ ${state.selectedClient.geography}`;
    }
    
    // Load qualification prompt when entering Step 4
    if (stepNumber === 4) {
        loadQualificationPrompt();
    }
    
    // Load value case prompt when entering Step 5
    if (stepNumber === 5) {
        loadValueCasePrompt();
    }
    
    // Load provocation prompt when entering Step 6
    if (stepNumber === 6) {
        loadProvocationPrompt();
    }
    
    // Load review when entering Step 7
    if (stepNumber === 7) {
        renderReviewAssetSummary();
        loadCsuitePrompts();
    }

    // Save progress to history on every step transition (step 2+)
    if (stepNumber >= 2 && state.selectedClient) {
        saveSessionProgress(stepNumber);
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
    
    // Store contacts in state for history saving
    if (type === 'current') {
        state.researchedContacts.current = contacts;
    } else if (type === 'exited') {
        state.researchedContacts.exited = contacts;
    }
    
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
    state.highestStepReached = 1; // reset navigation high-water mark
    
    // Reset supporting docs (Step 3)
    resetSupportingDocsUI();
    
    // Reset qualification criteria (Step 4)
    resetQualificationUI();
    
    // Reset value case (Step 5)
    resetValueCaseUI();
    
    // Reset provocation / Origination Engine (Step 6)
    resetProvocationUI();
    
    // Reset review (Step 7)
    resetReviewUI();
    
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
    
    // Reset contact grids (now in Step 7)
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
                    if (pocFileName) pocFileName.textContent = `${originalFileName} â†’ ${renamedFileName}`;
                    if (pocFileSize) pocFileSize.textContent = formatFileSize(state.pocFile.size);
                    
                    showToast('POC file added', 'success');
                    
                    // Save POC to history
                    saveSessionProgress(2);
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

// ============================================
// Step 3: Supporting Document Upload & Processing
// ============================================

function setupSupportingDocsListeners() {
    const zone = elements.docUploadZone;
    const browseBtn = elements.browseDocsBtn;

    // Browse button
    if (browseBtn) {
        browseBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await uploadSupportingDocs();
        });
    }

    // Click on drop zone
    if (zone) {
        zone.addEventListener('click', async () => {
            await uploadSupportingDocs();
        });

        // Drag & drop
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            // Electron doesn't support reading dropped files directly in renderer – use browse instead
            showToast('Use the browse button to select files', 'info');
        });
    }

    // Back to Step 2
    if (elements.backToStep2) {
        elements.backToStep2.addEventListener('click', () => goToStep(2));
    }

    // Listen for processing progress from main process
    if (state.isElectron && window.electronAPI.supportingDocs?.onProgress) {
        window.electronAPI.supportingDocs.onProgress((data) => {
            updateDocProcessProgress(data.current, data.total, data.fileName);
        });
    }
}

async function uploadSupportingDocs() {
    if (!state.isElectron) {
        showToast('File upload requires the Electron app', 'error');
        return;
    }
    try {
        const result = await window.electronAPI.supportingDocs.upload();
        if (result.canceled) return;
        if (!result.success) {
            showToast(result.error || 'Upload failed', 'error');
            return;
        }
        // Merge into local state
        state.supportingDocFiles.push(...result.files);
        renderDocFileList();
        showToast(`${result.files.length} file(s) added — processing...`, 'info');

        // Save supporting docs to history
        saveSessionProgress(3);

        // Auto-process immediately after upload
        await processSupportingDocs();
    } catch (error) {
        console.error('[Step 3] Upload error:', error);
        showToast('Upload failed: ' + error.message, 'error');
    }
}

let _docProcessingActive = false;

async function processSupportingDocs() {
    if (!state.isElectron) return;

    // Guard: if already processing, the active loop will pick up new files
    if (_docProcessingActive) return;
    _docProcessingActive = true;

    try {
        // Loop: keep processing while there are pending files
        // (handles files uploaded while a previous batch was running)
        let iterations = 0;
        const MAX_ITERATIONS = 10; // safety valve for runaway loops

        while (iterations < MAX_ITERATIONS) {
            iterations++;
            const pending = state.supportingDocFiles.filter(f => f.status === 'pending' || f.status === 'error');
            if (pending.length === 0) {
                if (iterations === 1 && state.supportingDocsCorpus) {
                    showToast('All documents already processed', 'info');
                }
                break;
            }

            // Show progress bar
            if (elements.docProcessBar) elements.docProcessBar.classList.remove('hidden');
            updateDocProcessProgress(0, pending.length, 'Starting...');

            const result = await window.electronAPI.supportingDocs.process();
            if (result.success) {
                // Sync state from backend (includes any files uploaded mid-processing)
                state.supportingDocFiles = result.files || state.supportingDocFiles;
                state.supportingDocsCorpus = result.corpus;
                renderDocFileList();
                renderCorpusSummary(result.corpus);
            } else {
                showToast(result.error || 'Processing failed', 'error');
                break;
            }
        }

        // Final summary toast
        const doneCount = state.supportingDocFiles.filter(f => f.status === 'done').length;
        const errCount = state.supportingDocFiles.filter(f => f.status === 'error').length;
        if (doneCount > 0 && errCount === 0) {
            showToast(`${doneCount} document(s) processed successfully`, 'success');
        } else if (doneCount > 0 && errCount > 0) {
            showToast(`${doneCount} processed, ${errCount} failed — hover files for details`, 'warning');
        } else if (errCount > 0) {
            showToast(`${errCount} document(s) failed to process — hover files for details`, 'error');
        }
    } catch (error) {
        console.error('[Step 3] Process error:', error);
        showToast('Processing failed: ' + error.message, 'error');
    } finally {
        _docProcessingActive = false;
        if (elements.docProcessBar) elements.docProcessBar.classList.add('hidden');
    }
}

async function removeSupportingDoc(fileId) {
    if (!state.isElectron) return;
    try {
        const result = await window.electronAPI.supportingDocs.remove(fileId);
        if (result.success) {
            state.supportingDocFiles = result.files;
            state.supportingDocsCorpus = result.corpus;
            renderDocFileList();
            if (result.corpus) renderCorpusSummary(result.corpus);
            else if (elements.docCorpusSummary) elements.docCorpusSummary.classList.add('hidden');
            updateProcessBtnState();
        }
    } catch (error) {
        console.error('[Step 3] Remove error:', error);
    }
}

function renderDocFileList() {
    const container = elements.docFileList;
    if (!container) return;

    if (state.supportingDocFiles.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.supportingDocFiles.map(f => {
        const statusIcon = getStatusIcon(f.status);
        const sizeStr = formatFileSize(f.size || 0);
        const chunkInfo = f.chunkCount ? `<span class="file-chunks">${f.chunkCount} chunks</span>` : '';
        const errorTip = f.error ? ` title="${f.error}"` : '';
        return `
            <div class="doc-file-item" data-id="${f.id}"${errorTip}>
                <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span class="file-name">${f.fileName}</span>
                <span class="file-ext">${(f.ext || '').replace('.', '')}</span>
                <span class="file-size">${sizeStr}</span>
                ${chunkInfo}
                ${statusIcon}
                <button class="file-remove" onclick="removeSupportingDoc('${f.id}')" title="Remove">&times;</button>
            </div>
        `;
    }).join('');
}

function getStatusIcon(status) {
    switch (status) {
        case 'pending':
            return '<svg class="file-status status-pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        case 'processing':
            return '<svg class="file-status status-processing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
        case 'done':
            return '<svg class="file-status status-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        case 'error':
            return '<svg class="file-status status-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        default:
            return '';
    }
}

function updateDocProcessProgress(current, total, fileName) {
    if (elements.docProcessLabel) elements.docProcessLabel.textContent = `Processing: ${fileName}`;
    if (elements.docProcessCount) elements.docProcessCount.textContent = `${current} / ${total}`;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    if (elements.docProgressFill) elements.docProgressFill.style.width = `${pct}%`;
}

function renderCorpusSummary(corpus) {
    if (!corpus || !elements.docCorpusSummary) return;
    elements.docCorpusSummary.classList.remove('hidden');
    if (elements.corpusDocCount) elements.corpusDocCount.textContent = corpus.totalDocuments || 0;
    if (elements.corpusChunkCount) elements.corpusChunkCount.textContent = corpus.totalChunks || 0;
    if (elements.corpusSuccessCount) elements.corpusSuccessCount.textContent = corpus.successfulDocuments || 0;
    if (corpus.failedDocuments > 0) {
        if (elements.corpusErrorStat) elements.corpusErrorStat.classList.remove('hidden');
        if (elements.corpusErrorCount) elements.corpusErrorCount.textContent = corpus.failedDocuments;
    } else {
        if (elements.corpusErrorStat) elements.corpusErrorStat.classList.add('hidden');
    }
}

function updateProcessBtnState() {
    const pending = state.supportingDocFiles.filter(f => f.status === 'pending' || f.status === 'error');
    if (elements.processDocsBtn) {
        elements.processDocsBtn.disabled = pending.length === 0;
        elements.processDocsBtn.textContent = pending.length > 0
            ? `Process ${pending.length} Document${pending.length > 1 ? 's' : ''}`
            : 'All Processed';
    }
}

function resetSupportingDocsUI() {
    state.supportingDocFiles = [];
    state.supportingDocsCorpus = null;
    if (elements.docFileList) elements.docFileList.innerHTML = '';
    if (elements.docProcessBar) elements.docProcessBar.classList.add('hidden');
    if (elements.docCorpusSummary) elements.docCorpusSummary.classList.add('hidden');
    updateProcessBtnState();
    // Also clear on backend
    if (state.isElectron && window.electronAPI.supportingDocs?.clear) {
        window.electronAPI.supportingDocs.clear().catch(() => {});
    }
}

// Make removeSupportingDoc global so inline onclick works
window.removeSupportingDoc = removeSupportingDoc;

// ============================================
// Step 4: Qualification Criteria
// ============================================

function setupQualificationListeners() {
    // Generate button
    if (elements.generateQualBtn) {
        elements.generateQualBtn.addEventListener('click', () => generateQualification());
    }

    // Download button
    if (elements.downloadQualDocBtn) {
        elements.downloadQualDocBtn.addEventListener('click', () => downloadQualDoc());
    }

    // Regenerate button
    if (elements.regenerateQualBtn) {
        elements.regenerateQualBtn.addEventListener('click', () => generateQualification());
    }

    // Reset prompt to default
    if (elements.resetQualPromptBtn) {
        elements.resetQualPromptBtn.addEventListener('click', async () => {
            if (state.qualDefaultPrompt !== null) {
                elements.qualPromptEditor.value = state.qualDefaultPrompt;
                showToast('Prompt reset to default', 'info');
            } else {
                await loadQualificationPrompt();
                showToast('Prompt reset to default', 'info');
            }
        });
    }

    // Back to Step 3
    if (elements.backToStep3) {
        elements.backToStep3.addEventListener('click', () => goToStep(3));
    }

    // Step 3 → Step 4
    if (elements.proceedToStep4) {
        elements.proceedToStep4.addEventListener('click', () => goToStep(4));
    }

    // Listen for progress from main process
    if (state.isElectron && window.electronAPI.qualification?.onProgress) {
        window.electronAPI.qualification.onProgress((data) => {
            updateQualProgress(data.stage, data.pct);
        });
    }
}

/**
 * Load the default qualification prompt from settings into the editor
 */
async function loadQualificationPrompt() {
    if (!elements.qualPromptEditor) return;

    // Only load fresh if we haven't loaded yet or it's still empty
    if (state.qualDefaultPrompt === null && state.isElectron && window.electronAPI.settings?.getQualPrompt) {
        try {
            const prompt = await window.electronAPI.settings.getQualPrompt();
            state.qualDefaultPrompt = prompt || '';
        } catch (error) {
            console.error('[Step 4] Error loading qual prompt:', error);
            state.qualDefaultPrompt = '';
        }
    }

    // Only set if the user hasn't already typed something
    if (!elements.qualPromptEditor.value.trim()) {
        elements.qualPromptEditor.value = state.qualDefaultPrompt || '';
    }
}

/**
 * Generate qualification document using the prompt and corpus context
 */
async function generateQualification() {
    if (!state.isElectron) {
        showToast('Qualification generation requires the Electron app', 'error');
        return;
    }

    if (state.qualificationGenerating) {
        showToast('Generation already in progress', 'info');
        return;
    }

    const prompt = elements.qualPromptEditor?.value?.trim();
    if (!prompt) {
        showToast('Please enter a qualification prompt', 'error');
        return;
    }

    if (!state.selectedClient) {
        showToast('No client selected', 'error');
        return;
    }

    // Begin generation
    state.qualificationGenerating = true;
    state.qualGenerationStartTime = Date.now();

    // UI: show progress, hide preview, disable buttons
    if (elements.qualProgress) elements.qualProgress.classList.remove('hidden');
    if (elements.qualPreview) elements.qualPreview.classList.add('hidden');
    if (elements.generateQualBtn) elements.generateQualBtn.disabled = true;
    if (elements.regenerateQualBtn) elements.regenerateQualBtn.disabled = true;
    updateQualProgress('Initializing...', 0);

    // Start elapsed timer
    const timerInterval = setInterval(() => {
        if (!state.qualGenerationStartTime) { clearInterval(timerInterval); return; }
        const elapsed = Math.floor((Date.now() - state.qualGenerationStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (elements.qualProgressElapsed) {
            elements.qualProgressElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);

    try {
        const result = await window.electronAPI.qualification.generate(
            prompt,
            state.selectedClient.name,
            state.selectedClient.industry || '',
            state.selectedClient.geography || ''
        );

        clearInterval(timerInterval);
        state.qualificationGenerating = false;
        state.qualGenerationStartTime = null;

        if (result.success) {
            state.qualificationMarkdown = result.markdown;

            // Render preview
            if (elements.qualPreviewContent) {
                elements.qualPreviewContent.innerHTML = renderMarkdownToHtml(result.markdown);
            }
            if (elements.qualPreview) elements.qualPreview.classList.remove('hidden');
            if (elements.qualProgress) elements.qualProgress.classList.add('hidden');

            // Enable the continue button to Step 5
            if (elements.proceedToStep5) elements.proceedToStep5.disabled = false;

            // Update corpus summary if it was enriched
            if (result.corpusSummary) {
                state.supportingDocsCorpus = result.corpusSummary;
                updateCorpusSummary(result.corpusSummary);
            }

            showToast('Qualification document generated successfully', 'success');

            // Save qualification to history
            saveSessionProgress(4);
        } else {
            showToast(result.error || 'Qualification generation failed', 'error');
            if (elements.qualProgress) elements.qualProgress.classList.add('hidden');
        }
    } catch (error) {
        clearInterval(timerInterval);
        state.qualificationGenerating = false;
        state.qualGenerationStartTime = null;
        console.error('[Step 4] Generation error:', error);
        showToast('Generation failed: ' + error.message, 'error');
        if (elements.qualProgress) elements.qualProgress.classList.add('hidden');
    } finally {
        if (elements.generateQualBtn) elements.generateQualBtn.disabled = false;
        if (elements.regenerateQualBtn) elements.regenerateQualBtn.disabled = false;
    }
}

/**
 * Update qualification progress bar UI
 */
function updateQualProgress(stage, pct) {
    const stageLabels = {
        'generating': 'Generating qualification answers with AI...',
        'building_doc': 'Building Word document...',
        'chunking': 'Adding to document corpus...',
        'done': 'Complete!'
    };
    const label = stageLabels[stage] || stage || 'Processing...';
    if (elements.qualProgressLabel) elements.qualProgressLabel.textContent = label;
    if (elements.qualProgressFill) {
        elements.qualProgressFill.style.width = `${Math.min(100, pct || 0)}%`;
        if (stage === 'generating') {
            elements.qualProgressFill.classList.add('progress-indeterminate');
        } else {
            elements.qualProgressFill.classList.remove('progress-indeterminate');
        }
    }
}

/**
 * Download the generated qualification Word doc
 */
async function downloadQualDoc() {
    if (!state.isElectron) return;

    try {
        const result = await window.electronAPI.qualification.download();
        if (result.success) {
            showToast('Document saved successfully', 'success');
        } else if (!result.canceled) {
            showToast(result.error || 'Download failed', 'error');
        }
    } catch (error) {
        console.error('[Step 4] Download error:', error);
        showToast('Download failed: ' + error.message, 'error');
    }
}

/**
 * Update the corpus summary display (reusable helper)
 */
function updateCorpusSummary(corpus) {
    if (!corpus) return;
    if (elements.corpusDocCount) elements.corpusDocCount.textContent = corpus.documentCount || 0;
    if (elements.corpusChunkCount) elements.corpusChunkCount.textContent = corpus.totalChunks || 0;
    if (elements.corpusSuccessCount) elements.corpusSuccessCount.textContent = corpus.successCount || 0;
    if (corpus.errorCount > 0) {
        if (elements.corpusErrorStat) elements.corpusErrorStat.classList.remove('hidden');
        if (elements.corpusErrorCount) elements.corpusErrorCount.textContent = corpus.errorCount;
    }
}

/**
 * Reset qualification UI to initial state
 */
function resetQualificationUI() {
    state.qualificationGenerating = false;
    state.qualificationMarkdown = null;
    state.qualGenerationStartTime = null;

    if (elements.qualPromptEditor) elements.qualPromptEditor.value = '';
    if (elements.qualProgress) elements.qualProgress.classList.add('hidden');
    if (elements.qualPreview) elements.qualPreview.classList.add('hidden');
    if (elements.qualPreviewContent) elements.qualPreviewContent.innerHTML = '';
    if (elements.qualProgressFill) elements.qualProgressFill.style.width = '0%';
    if (elements.qualProgressLabel) elements.qualProgressLabel.textContent = 'Initializing...';
    if (elements.qualProgressElapsed) elements.qualProgressElapsed.textContent = '0:00';
    if (elements.generateQualBtn) elements.generateQualBtn.disabled = false;
    if (elements.proceedToStep5) elements.proceedToStep5.disabled = true;
}

// ============================================
// Step 5: Value Case
// ============================================

function setupValueCaseListeners() {
    // Generate button
    if (elements.generateValueCaseBtn) {
        elements.generateValueCaseBtn.addEventListener('click', () => generateValueCase());
    }

    // Download button
    if (elements.downloadValueCaseDocBtn) {
        elements.downloadValueCaseDocBtn.addEventListener('click', () => downloadValueCaseDoc());
    }

    // Regenerate button
    if (elements.regenerateValueCaseBtn) {
        elements.regenerateValueCaseBtn.addEventListener('click', () => generateValueCase());
    }

    // Reset prompt to default
    if (elements.resetValueCasePromptBtn) {
        elements.resetValueCasePromptBtn.addEventListener('click', async () => {
            if (state.valueCaseDefaultPrompt !== null) {
                elements.valueCasePromptEditor.value = state.valueCaseDefaultPrompt;
                showToast('Prompt reset to default', 'info');
            } else {
                await loadValueCasePrompt();
                showToast('Prompt reset to default', 'info');
            }
        });
    }

    // Back to Step 4
    if (elements.backToStep4VC) {
        elements.backToStep4VC.addEventListener('click', () => goToStep(4));
    }

    // Continue to Step 6 (Provoke)
    if (elements.proceedToStep6) {
        elements.proceedToStep6.addEventListener('click', () => goToStep(6));
    }

    // Listen for progress from main process
    if (state.isElectron && window.electronAPI.valueCase?.onProgress) {
        window.electronAPI.valueCase.onProgress((data) => {
            updateValueCaseProgress(data.stage, data.pct);
        });
    }
}

/**
 * Load the default value case prompt from settings into the editor
 */
async function loadValueCasePrompt() {
    if (!elements.valueCasePromptEditor) return;

    if (state.valueCaseDefaultPrompt === null && state.isElectron && window.electronAPI.settings?.getValueCasePrompt) {
        try {
            const prompt = await window.electronAPI.settings.getValueCasePrompt();
            state.valueCaseDefaultPrompt = prompt || '';
        } catch (error) {
            console.error('[Step 5] Error loading value case prompt:', error);
            state.valueCaseDefaultPrompt = '';
        }
    }

    // Only set if the user hasn't already typed something
    if (!elements.valueCasePromptEditor.value.trim()) {
        elements.valueCasePromptEditor.value = state.valueCaseDefaultPrompt || '';
    }
}

/**
 * Generate value case document using the prompt and corpus context
 */
async function generateValueCase() {
    if (!state.isElectron) {
        showToast('Value case generation requires the Electron app', 'error');
        return;
    }

    if (state.valueCaseGenerating) {
        showToast('Generation already in progress', 'info');
        return;
    }

    const prompt = elements.valueCasePromptEditor?.value?.trim();
    if (!prompt) {
        showToast('Please enter a value case prompt', 'error');
        return;
    }

    if (!state.selectedClient) {
        showToast('No client selected', 'error');
        return;
    }

    // Begin generation
    state.valueCaseGenerating = true;
    state.valueCaseGenerationStartTime = Date.now();

    // UI: show progress, hide preview, disable buttons
    if (elements.valueCaseProgress) elements.valueCaseProgress.classList.remove('hidden');
    if (elements.valueCasePreview) elements.valueCasePreview.classList.add('hidden');
    if (elements.generateValueCaseBtn) elements.generateValueCaseBtn.disabled = true;
    if (elements.regenerateValueCaseBtn) elements.regenerateValueCaseBtn.disabled = true;
    updateValueCaseProgress('Initializing...', 0);

    // Start elapsed timer
    const timerInterval = setInterval(() => {
        if (!state.valueCaseGenerationStartTime) { clearInterval(timerInterval); return; }
        const elapsed = Math.floor((Date.now() - state.valueCaseGenerationStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (elements.valueCaseProgressElapsed) {
            elements.valueCaseProgressElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);

    try {
        const result = await window.electronAPI.valueCase.generate(
            prompt,
            state.selectedClient.name,
            state.selectedClient.industry || '',
            state.selectedClient.geography || ''
        );

        clearInterval(timerInterval);
        state.valueCaseGenerating = false;
        state.valueCaseGenerationStartTime = null;

        if (result.success) {
            state.valueCaseMarkdown = result.markdown;

            // Render preview
            if (elements.valueCasePreviewContent) {
                elements.valueCasePreviewContent.innerHTML = renderMarkdownToHtml(result.markdown);
            }
            if (elements.valueCasePreview) elements.valueCasePreview.classList.remove('hidden');
            if (elements.valueCaseProgress) elements.valueCaseProgress.classList.add('hidden');

            // Enable continue to Provoke
            if (elements.proceedToStep6) elements.proceedToStep6.disabled = false;

            // Update corpus summary if enriched
            if (result.corpusSummary) {
                state.supportingDocsCorpus = result.corpusSummary;
                updateCorpusSummary(result.corpusSummary);
            }

            showToast('Value case document generated successfully', 'success');

            // Auto-extract assumptions in the background
            extractAndRenderAssumptions();

            // Save to history
            saveSessionProgress(5);
        } else {
            showToast(result.error || 'Value case generation failed', 'error');
            if (elements.valueCaseProgress) elements.valueCaseProgress.classList.add('hidden');
        }
    } catch (error) {
        clearInterval(timerInterval);
        state.valueCaseGenerating = false;
        state.valueCaseGenerationStartTime = null;
        console.error('[Step 5] Generation error:', error);
        showToast('Generation failed: ' + error.message, 'error');
        if (elements.valueCaseProgress) elements.valueCaseProgress.classList.add('hidden');
    } finally {
        if (elements.generateValueCaseBtn) elements.generateValueCaseBtn.disabled = false;
        if (elements.regenerateValueCaseBtn) elements.regenerateValueCaseBtn.disabled = false;
    }
}

/**
 * Update value case progress bar UI
 */
function updateValueCaseProgress(stage, pct) {
    const stageLabels = {
        'generating': 'Generating value case document with AI...',
        'building_doc': 'Building Word document...',
        'chunking': 'Adding to document corpus...',
        'done': 'Complete!'
    };
    const label = stageLabels[stage] || stage || 'Processing...';
    if (elements.valueCaseProgressLabel) elements.valueCaseProgressLabel.textContent = label;
    if (elements.valueCaseProgressFill) {
        elements.valueCaseProgressFill.style.width = `${Math.min(100, pct || 0)}%`;
        if (stage === 'generating') {
            elements.valueCaseProgressFill.classList.add('progress-indeterminate');
        } else {
            elements.valueCaseProgressFill.classList.remove('progress-indeterminate');
        }
    }
}

/**
 * Download the generated value case Word doc
 */
async function downloadValueCaseDoc() {
    if (!state.isElectron) return;

    try {
        const result = await window.electronAPI.valueCase.download();
        if (result.success) {
            showToast('Document saved successfully', 'success');
        } else if (!result.canceled) {
            showToast(result.error || 'Download failed', 'error');
        }
    } catch (error) {
        console.error('[Step 5] Download error:', error);
        showToast('Download failed: ' + error.message, 'error');
    }
}

/**
 * Reset value case UI to initial state
 */
function resetValueCaseUI() {
    state.valueCaseGenerating = false;
    state.valueCaseMarkdown = null;
    state.valueCaseAssumptions = null;
    state.valueCaseGenerationStartTime = null;

    if (elements.valueCasePromptEditor) elements.valueCasePromptEditor.value = '';
    if (elements.valueCaseProgress) elements.valueCaseProgress.classList.add('hidden');
    if (elements.valueCasePreview) elements.valueCasePreview.classList.add('hidden');
    if (elements.valueCasePreviewContent) elements.valueCasePreviewContent.innerHTML = '';
    if (elements.assumptionsTableContainer) elements.assumptionsTableContainer.classList.add('hidden');
    if (elements.assumptionsTableBody) elements.assumptionsTableBody.innerHTML = '';
    if (elements.valueCaseProgressFill) elements.valueCaseProgressFill.style.width = '0%';
    if (elements.valueCaseProgressLabel) elements.valueCaseProgressLabel.textContent = 'Initializing...';
    if (elements.valueCaseProgressElapsed) elements.valueCaseProgressElapsed.textContent = '0:00';
    if (elements.generateValueCaseBtn) elements.generateValueCaseBtn.disabled = false;
    if (elements.proceedToStep6) elements.proceedToStep6.disabled = true;
}

// ============================================
// Step 5b: Value Case — Assumptions Table
// ============================================

async function extractAndRenderAssumptions() {
    if (!state.selectedClient) return;

    // Show container with loading state
    if (elements.assumptionsTableContainer) elements.assumptionsTableContainer.classList.remove('hidden');
    if (elements.assumptionsLoading) elements.assumptionsLoading.style.display = 'inline-block';
    if (elements.assumptionsTableBody) elements.assumptionsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#888;">Analysing assumptions…</td></tr>';

    try {
        const result = await window.electronAPI.valueCase.extractAssumptions(state.selectedClient.name);
        if (result && result.success && Array.isArray(result.assumptions)) {
            state.valueCaseAssumptions = result.assumptions;
            renderAssumptionsTable(result.assumptions);
            // Persist to history
            saveSessionProgress(5);
        } else {
            if (elements.assumptionsTableBody) {
                elements.assumptionsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#c0392b;">Failed to extract assumptions</td></tr>';
            }
        }
    } catch (err) {
        console.error('Assumptions extraction error:', err);
        if (elements.assumptionsTableBody) {
            elements.assumptionsTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#c0392b;">Error extracting assumptions</td></tr>';
        }
    } finally {
        if (elements.assumptionsLoading) elements.assumptionsLoading.style.display = 'none';
    }
}

function renderAssumptionsTable(assumptions) {
    if (!elements.assumptionsTableBody || !Array.isArray(assumptions)) return;
    if (elements.assumptionsTableContainer) elements.assumptionsTableContainer.classList.remove('hidden');

    const ragIcon = (level) => {
        const colors = { red: '#e74c3c', amber: '#f39c12', green: '#27ae60' };
        const labels = { red: 'Red', amber: 'Amber', green: 'Green' };
        const color = colors[level] || '#999';
        const label = labels[level] || level;
        return `<span class="rag-indicator rag-${level}" title="${label}"><span class="rag-dot" style="background:${color};"></span> ${label}</span>`;
    };

    let html = '';
    assumptions.forEach((a) => {
        html += `<tr>
            <td class="assumption-text">${escapeHtml(a.assumption || '')}</td>
            <td class="assumption-rag">${ragIcon(a.impact)}</td>
            <td class="assumption-rag">${ragIcon(a.confidence)}</td>
        </tr>`;
    });

    elements.assumptionsTableBody.innerHTML = html;
}

// ============================================
// Step 6: Provoke — Origination Engine
// ============================================

function setupProvocationListeners() {
    // Generate button
    if (elements.generateProvokeBtn) {
        elements.generateProvokeBtn.addEventListener('click', () => generateProvocation());
    }

    // Download button
    if (elements.downloadProvokeDocBtn) {
        elements.downloadProvokeDocBtn.addEventListener('click', () => downloadProvokeDoc());
    }

    // Regenerate button
    if (elements.regenerateProvokeBtn) {
        elements.regenerateProvokeBtn.addEventListener('click', () => generateProvocation());
    }

    // Reset prompt to default
    if (elements.resetProvokePromptBtn) {
        elements.resetProvokePromptBtn.addEventListener('click', async () => {
            if (state.provokeDefaultPrompt !== null) {
                elements.provokePromptEditor.value = state.provokeDefaultPrompt;
                showToast('Prompt reset to default', 'info');
            } else {
                await loadProvocationPrompt();
                showToast('Prompt reset to default', 'info');
            }
        });
    }

    // Back to Step 5 (Value Case)
    if (elements.backToStep5) {
        elements.backToStep5.addEventListener('click', () => goToStep(5));
    }

    // Listen for progress from main process
    if (state.isElectron && window.electronAPI.provocation?.onProgress) {
        window.electronAPI.provocation.onProgress((data) => {
            updateProvokeProgress(data.stage, data.pct);
        });
    }
}

/**
 * Load the default provocation prompt from settings into the editor
 */
async function loadProvocationPrompt() {
    if (!elements.provokePromptEditor) return;

    if (state.provokeDefaultPrompt === null && state.isElectron && window.electronAPI.settings?.getProvokePrompt) {
        try {
            const prompt = await window.electronAPI.settings.getProvokePrompt();
            state.provokeDefaultPrompt = prompt || '';
        } catch (error) {
            console.error('[Step 5] Error loading provoke prompt:', error);
            state.provokeDefaultPrompt = '';
        }
    }

    // Only set if the user hasn't already typed something
    if (!elements.provokePromptEditor.value.trim()) {
        elements.provokePromptEditor.value = state.provokeDefaultPrompt || '';
    }
}

/**
 * Generate provocation document using the prompt and corpus context
 */
async function generateProvocation() {
    if (!state.isElectron) {
        showToast('Provocation generation requires the Electron app', 'error');
        return;
    }

    if (state.provocationGenerating) {
        showToast('Generation already in progress', 'info');
        return;
    }

    const prompt = elements.provokePromptEditor?.value?.trim();
    if (!prompt) {
        showToast('Please enter a provocation prompt', 'error');
        return;
    }

    if (!state.selectedClient) {
        showToast('No client selected', 'error');
        return;
    }

    // Begin generation
    state.provocationGenerating = true;
    state.provokeGenerationStartTime = Date.now();

    // UI: show progress, hide preview, disable buttons
    if (elements.provokeProgress) elements.provokeProgress.classList.remove('hidden');
    if (elements.provokePreview) elements.provokePreview.classList.add('hidden');
    if (elements.generateProvokeBtn) elements.generateProvokeBtn.disabled = true;
    if (elements.regenerateProvokeBtn) elements.regenerateProvokeBtn.disabled = true;
    updateProvokeProgress('Initializing...', 0);

    // Start elapsed timer
    const timerInterval = setInterval(() => {
        if (!state.provokeGenerationStartTime) { clearInterval(timerInterval); return; }
        const elapsed = Math.floor((Date.now() - state.provokeGenerationStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (elements.provokeProgressElapsed) {
            elements.provokeProgressElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);

    try {
        const result = await window.electronAPI.provocation.generate(
            prompt,
            state.selectedClient.name,
            state.selectedClient.industry || '',
            state.selectedClient.geography || ''
        );

        clearInterval(timerInterval);
        state.provocationGenerating = false;
        state.provokeGenerationStartTime = null;

        if (result.success) {
            state.provocationMarkdown = result.markdown;

            // Render preview
            if (elements.provokePreviewContent) {
                elements.provokePreviewContent.innerHTML = renderMarkdownToHtml(result.markdown);
            }
            if (elements.provokePreview) elements.provokePreview.classList.remove('hidden');
            if (elements.provokeProgress) elements.provokeProgress.classList.add('hidden');

            // Update corpus summary if enriched
            if (result.corpusSummary) {
                state.supportingDocsCorpus = result.corpusSummary;
                updateCorpusSummary(result.corpusSummary);
            }

            showToast('Provocation document generated successfully', 'success');

            // Save provocation to history
            saveSessionProgress(6);
        } else {
            showToast(result.error || 'Provocation generation failed', 'error');
            if (elements.provokeProgress) elements.provokeProgress.classList.add('hidden');
        }
    } catch (error) {
        clearInterval(timerInterval);
        state.provocationGenerating = false;
        state.provokeGenerationStartTime = null;
        console.error('[Step 6] Provoke generation error:', error);
        showToast('Generation failed: ' + error.message, 'error');
        if (elements.provokeProgress) elements.provokeProgress.classList.add('hidden');
    } finally {
        if (elements.generateProvokeBtn) elements.generateProvokeBtn.disabled = false;
        if (elements.regenerateProvokeBtn) elements.regenerateProvokeBtn.disabled = false;
    }
}

/**
 * Update provocation progress bar UI
 */
function updateProvokeProgress(stage, pct) {
    const stageLabels = {
        'generating': 'Generating provocation document with AI...',
        'building_doc': 'Building Word document...',
        'chunking': 'Adding to document corpus...',
        'done': 'Complete!'
    };
    const label = stageLabels[stage] || stage || 'Processing...';
    if (elements.provokeProgressLabel) elements.provokeProgressLabel.textContent = label;
    if (elements.provokeProgressFill) {
        elements.provokeProgressFill.style.width = `${Math.min(100, pct || 0)}%`;
        if (stage === 'generating') {
            elements.provokeProgressFill.classList.add('progress-indeterminate');
        } else {
            elements.provokeProgressFill.classList.remove('progress-indeterminate');
        }
    }
}

/**
 * Download the generated provocation Word doc
 */
async function downloadProvokeDoc() {
    if (!state.isElectron) return;

    try {
        const result = await window.electronAPI.provocation.download();
        if (result.success) {
            showToast('Document saved successfully', 'success');
        } else if (!result.canceled) {
            showToast(result.error || 'Download failed', 'error');
        }
    } catch (error) {
        console.error('[Step 6] Provoke download error:', error);
        showToast('Download failed: ' + error.message, 'error');
    }
}

/**
 * Reset provocation UI to initial state
 */
function resetProvocationUI() {
    state.provocationGenerating = false;
    state.provocationMarkdown = null;
    state.provokeGenerationStartTime = null;

    if (elements.provokePromptEditor) elements.provokePromptEditor.value = '';
    if (elements.provokeProgress) elements.provokeProgress.classList.add('hidden');
    if (elements.provokePreview) elements.provokePreview.classList.add('hidden');
    if (elements.provokePreviewContent) elements.provokePreviewContent.innerHTML = '';
    if (elements.provokeProgressFill) elements.provokeProgressFill.style.width = '0%';
    if (elements.provokeProgressLabel) elements.provokeProgressLabel.textContent = 'Initializing...';
    if (elements.provokeProgressElapsed) elements.provokeProgressElapsed.textContent = '0:00';
    if (elements.generateProvokeBtn) elements.generateProvokeBtn.disabled = false;
}

// ============================================
// Step 7: Review — C-Suite Consistency & Accuracy Check
// ============================================

const CSUITE_ROLES = {
    ceo: { icon: '👤', label: 'CEO', full: 'Chief Executive Officer' },
    cfo: { icon: '💰', label: 'CFO', full: 'Chief Financial Officer' },
    coo: { icon: '⚙️', label: 'COO', full: 'Chief Operating Officer' },
    cto: { icon: '💻', label: 'CTO', full: 'Chief Technology Officer' },
    cmo: { icon: '📢', label: 'CMO', full: 'Chief Marketing Officer' }
};

/**
 * Load C-suite prompts from settings into state
 */
async function loadCsuitePrompts() {
    if (state.isElectron && window.electronAPI.settings?.getCsuitePrompts) {
        try {
            state.csuitePrompts = await window.electronAPI.settings.getCsuitePrompts();
        } catch (e) {
            console.error('[Step 7] loadCsuitePrompts error:', e);
        }
    }
}

/**
 * Setup event listeners for the Review step
 */
function setupReviewListeners() {
    // Back to Step 6 (Provoke)
    if (elements.backToStep6) {
        elements.backToStep6.addEventListener('click', () => goToStep(6));
    }

    // Proceed to Step 7 (from Step 6) — reserved for future use
    if (elements.proceedToStep7) {
        elements.proceedToStep7.addEventListener('click', () => goToStep(7));
    }

    // C-Suite tile clicks (tile select, edit button, review button, rewrite button)
    if (elements.csuiteTilesGrid) {
        elements.csuiteTilesGrid.addEventListener('click', (e) => {
            // Check if rewrite button was clicked
            const rewriteBtn = e.target.closest('.csuite-rewrite-btn');
            if (rewriteBtn) {
                e.stopPropagation();
                const role = rewriteBtn.dataset.role;
                showRewriteConfirmation(role);
                return;
            }
            // Check if review button was clicked
            const reviewBtn = e.target.closest('.csuite-review-btn');
            if (reviewBtn) {
                e.stopPropagation();
                const role = reviewBtn.dataset.role;
                selectCsuiteTile(role);
                showCsuiteConfirmation(role);
                return;
            }
            // Check if edit button was clicked
            const editBtn = e.target.closest('.csuite-edit-btn');
            if (editBtn) {
                e.stopPropagation();
                const role = editBtn.dataset.role;
                openCsuitePromptEditor(role);
                return;
            }
            // Clicking the tile itself selects the persona and shows its checklist
            const tile = e.target.closest('.csuite-tile');
            if (tile) {
                const role = tile.dataset.role;
                selectCsuiteTile(role);
            }
        });
    }

    // Prompt editor: Save
    if (elements.saveCsuitePromptBtn) {
        elements.saveCsuitePromptBtn.addEventListener('click', () => {
            saveCsuitePromptInline();
        });
    }

    // Prompt editor: Cancel
    if (elements.closeCsuitePromptBtn) {
        elements.closeCsuitePromptBtn.addEventListener('click', () => {
            if (elements.csuitePromptEditor) elements.csuitePromptEditor.classList.add('hidden');
        });
    }

    // Confirmation: Yes — uses stored action callback for reliable routing
    if (elements.csuiteConfirmYes) {
        elements.csuiteConfirmYes.addEventListener('click', () => {
            if (elements.csuiteConfirmOverlay) elements.csuiteConfirmOverlay.classList.add('hidden');
            console.log('[Confirm Yes] rewritePending:', state.rewritePending, 'pendingConfirmAction:', typeof state.pendingConfirmAction, 'role:', state.reviewSelectedRole);
            // Primary routing: use stored action callback (always set by showCsuiteConfirmation or showRewriteConfirmation)
            if (typeof state.pendingConfirmAction === 'function') {
                const action = state.pendingConfirmAction;
                state.pendingConfirmAction = null;
                state.rewritePending = false;
                action();
            } else if (state.rewritePending && state.reviewSelectedRole) {
                // Fallback: flag-based routing (should never reach here)
                console.warn('[Confirm Yes] Using fallback flag routing — pendingConfirmAction was null');
                state.rewritePending = false;
                rewriteProvokeFromReview(state.reviewSelectedRole);
            } else if (state.reviewSelectedRole) {
                console.warn('[Confirm Yes] Using fallback role routing — pendingConfirmAction was null');
                generateReview(state.reviewSelectedRole);
            }
        });
    }

    // Confirmation: No
    if (elements.csuiteConfirmNo) {
        elements.csuiteConfirmNo.addEventListener('click', () => {
            if (elements.csuiteConfirmOverlay) elements.csuiteConfirmOverlay.classList.add('hidden');
            state.reviewSelectedRole = null;
            state.rewritePending = false;
            state.pendingConfirmAction = null;
        });
    }

    // Listen for progress from main process
    if (state.isElectron && window.electronAPI.review?.onProgress) {
        window.electronAPI.review.onProgress((data) => {
            updateReviewProgress(data.stage, data.pct);
        });
    }
}

/**
 * Open the inline prompt editor for a specific C-suite role
 */
function openCsuitePromptEditor(role) {
    const info = CSUITE_ROLES[role];
    if (!info) return;

    if (elements.csuitePromptEditorTitle) {
        elements.csuitePromptEditorTitle.textContent = `Edit ${info.icon} ${info.label} Instructions`;
    }
    if (elements.csuitePromptTextarea) {
        elements.csuitePromptTextarea.value = state.csuitePrompts?.[role] || '';
        elements.csuitePromptTextarea.dataset.role = role;
    }
    if (elements.csuitePromptEditor) elements.csuitePromptEditor.classList.remove('hidden');
}

/**
 * Save the inline C-suite prompt edit
 */
async function saveCsuitePromptInline() {
    const role = elements.csuitePromptTextarea?.dataset.role;
    if (!role) return;

    const newPrompt = elements.csuitePromptTextarea.value || '';
    state.csuitePrompts[role] = newPrompt;

    // Persist all prompts
    if (state.isElectron && window.electronAPI.settings?.saveCsuitePrompts) {
        try {
            await window.electronAPI.settings.saveCsuitePrompts(state.csuitePrompts);
            showToast(`${CSUITE_ROLES[role]?.label || role.toUpperCase()} prompt saved`, 'success');
        } catch (e) {
            console.error('[Step 7] saveCsuitePromptInline error:', e);
            showToast('Failed to save prompt', 'error');
        }
    }
    if (elements.csuitePromptEditor) elements.csuitePromptEditor.classList.add('hidden');
}

/**
 * Select a C-suite tile — highlights it and shows its checklist (if any)
 */
function selectCsuiteTile(role) {
    const info = CSUITE_ROLES[role];
    if (!info) return;

    state.reviewSelectedRole = role;

    // Highlight selected tile
    document.querySelectorAll('.csuite-tile').forEach(t => t.classList.remove('active'));
    const tile = document.querySelector(`.csuite-tile[data-role="${role}"]`);
    if (tile) tile.classList.add('active');

    // Show only this role's checklist panel, hide others
    if (elements.reviewChecklistsContainer) {
        elements.reviewChecklistsContainer.querySelectorAll('.review-checklist-panel').forEach(p => {
            if (p.dataset.role === role) {
                p.classList.remove('hidden');
                p.classList.add('expanded');
            } else {
                p.classList.add('hidden');
            }
        });
    }
}

/**
 * Show the confirmation modal for running a review as a C-suite role
 */
function showCsuiteConfirmation(role) {
    const info = CSUITE_ROLES[role];
    if (!info) return;

    state.reviewSelectedRole = role;
    state.rewritePending = false;
    // Store the EXACT action to perform when Yes is clicked
    state.pendingConfirmAction = () => generateReview(role);

    if (elements.csuiteConfirmIcon) elements.csuiteConfirmIcon.textContent = info.icon;
    if (elements.csuiteConfirmTitle) elements.csuiteConfirmTitle.textContent = `Run review as ${info.label}?`;
    if (elements.csuiteConfirmDesc) elements.csuiteConfirmDesc.textContent = `The AI will review the qualification and provocation documents from the perspective of the ${info.full}, focusing on their specific areas of concern.`;
    if (elements.csuiteConfirmYes) elements.csuiteConfirmYes.textContent = 'Yes, Run Review';
    if (elements.csuiteConfirmOverlay) elements.csuiteConfirmOverlay.classList.remove('hidden');
}

/**
 * Confirm rewrite of the provoke document based on a review
 */
function showRewriteConfirmation(role) {
    const info = CSUITE_ROLES[role];
    if (!info) return;

    const reviewData = state.reviewsByRole[role];
    if (!reviewData || !(reviewData.changes || reviewData)) {
        console.warn('[Rewrite] No review in state.reviewsByRole for role:', role, '— available:', Object.keys(state.reviewsByRole));
        showToast('No review available for this role yet', 'info');
        return;
    }

    // Collect the checked changes from this role's checklist
    const panel = elements.reviewChecklistsContainer?.querySelector(`.review-checklist-panel[data-role="${role}"]`);
    const checkedChanges = [];
    if (panel) {
        panel.querySelectorAll('.review-checklist-checkbox:checked').forEach(cb => {
            const item = cb.closest('.review-checklist-item');
            if (item) {
                checkedChanges.push({
                    title: item.querySelector('.review-checklist-item-title')?.textContent || '',
                    detail: item.querySelector('.review-checklist-item-detail')?.textContent || ''
                });
            }
        });
    }

    if (checkedChanges.length === 0) {
        showToast(`Select at least one change from the ${info.label} checklist first`, 'info');
        return;
    }

    // Reuse the confirmation overlay with rewrite-specific text
    state.reviewSelectedRole = role;
    state.rewritePending = true;
    state._pendingRewriteChanges = checkedChanges; // stash for the action callback
    // Store the EXACT action to perform when Yes is clicked
    state.pendingConfirmAction = () => rewriteProvokeFromReview(role, checkedChanges);
    console.log('[Rewrite] pendingConfirmAction set for role:', role, 'changes:', checkedChanges.length);

    if (elements.csuiteConfirmIcon) elements.csuiteConfirmIcon.textContent = '🔄';
    if (elements.csuiteConfirmTitle) elements.csuiteConfirmTitle.textContent = `Apply ${checkedChanges.length} ${info.label} edit${checkedChanges.length !== 1 ? 's' : ''}?`;
    if (elements.csuiteConfirmDesc) elements.csuiteConfirmDesc.textContent = `The AI will apply the ${checkedChanges.length} selected change${checkedChanges.length !== 1 ? 's' : ''} from the ${info.label} review to produce a new version of the provoke narrative. The original will be preserved.`;
    if (elements.csuiteConfirmYes) elements.csuiteConfirmYes.textContent = 'Yes, Apply Edits';
    if (elements.csuiteConfirmOverlay) elements.csuiteConfirmOverlay.classList.remove('hidden');
}

/**
 * Agentically rewrite the provoke narrative using review feedback
 */
async function rewriteProvokeFromReview(role, selectedChanges) {
    if (!state.isElectron) return;

    const roleInfo = CSUITE_ROLES[role];
    const roleName = roleInfo?.label || role.toUpperCase();
    const changes = selectedChanges || state._pendingRewriteChanges || [];

    if (changes.length === 0) {
        showToast('No changes selected', 'info');
        return;
    }

    // Show progress UI
    state.reviewGenerating = true;
    state.reviewGenerationStartTime = Date.now();
    if (elements.reviewProgress) elements.reviewProgress.classList.remove('hidden');
    updateReviewProgress(`Rewriting provoke based on ${roleName} review...`, 0);

    // Start elapsed timer
    const timerInterval = setInterval(() => {
        if (!state.reviewGenerationStartTime) { clearInterval(timerInterval); return; }
        const elapsed = Math.floor((Date.now() - state.reviewGenerationStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (elements.reviewProgressElapsed) {
            elements.reviewProgressElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);

    try {
        const result = await window.electronAPI.provocation.rewrite(
            state.selectedClient?.name || 'Client',
            role,
            changes
        );

        clearInterval(timerInterval);
        state.reviewGenerating = false;
        state.reviewGenerationStartTime = null;

        if (result.success) {
            // Store the new version
            state.provokeVersions.push({
                label: `Narrative Provoke ${roleName} Edits`,
                markdown: result.markdown,
                fileName: result.fileName,
                role: role,
                timestamp: Date.now()
            });

            if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');

            // Refresh asset summary to show all versions
            renderReviewAssetSummary();

            showToast(`Provoke rewritten based on ${roleName} review`, 'success');
            saveSessionProgress(7);
        } else {
            showToast(result.error || 'Rewrite failed', 'error');
            if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');
        }
    } catch (error) {
        clearInterval(timerInterval);
        state.reviewGenerating = false;
        state.reviewGenerationStartTime = null;
        console.error('[Rewrite] Error:', error);
        showToast('Rewrite failed: ' + error.message, 'error');
        if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');
    }
}

/**
 * Render asset summary cards showing all generated documents
 */
async function renderReviewAssetSummary() {
    if (!elements.reviewAssetsGrid) return;

    let assets = [];
    if (state.isElectron && window.electronAPI.review?.getAssets) {
        try {
            assets = await window.electronAPI.review.getAssets();
        } catch (e) {
            console.error('[Step 7] getAssets error:', e);
        }
    }

    if (assets.length === 0) {
        elements.reviewAssetsGrid.innerHTML = '<p class="text-muted" style="grid-column:1/-1;">No documents generated yet.</p>';
        return;
    }

    const icons = {
        qualification: '📋',
        valueCase: '💼',
        provocation: '🎯',
        'provocation-rewrite': '🔄'
    };

    elements.reviewAssetsGrid.innerHTML = assets.map(a => {
        const sizeKB = a.size ? Math.round(a.size / 1024) : 0;
        const icon = icons[a.type] || '📄';
        // Build the data attributes for the download button
        let dlAttr;
        if (a.versionIndex !== undefined) {
            dlAttr = `data-asset-type="provocation-version" data-version-index="${a.versionIndex}"`;
        } else {
            dlAttr = `data-asset-type="${a.type}"`;
        }
        return `
            <div class="review-asset-card">
                <div class="review-asset-icon">${icon}</div>
                <div class="review-asset-info">
                    <div class="review-asset-label">${a.label}</div>
                    <div class="review-asset-file">${a.fileName}</div>
                    <div class="review-asset-size">${sizeKB} KB</div>
                </div>
                <button class="btn btn-sm btn-outline review-asset-dl" ${dlAttr} title="Download">⬇️</button>
            </div>
        `;
    }).join('');

    // Wire download buttons for each asset
    elements.reviewAssetsGrid.querySelectorAll('.review-asset-dl').forEach(btn => {
        btn.addEventListener('click', async () => {
            const type = btn.dataset.assetType;
            if (type === 'qualification' && window.electronAPI.qualification?.download) {
                const r = await window.electronAPI.qualification.download();
                if (r.success) showToast('Qualification doc saved', 'success');
                else if (!r.canceled) showToast(r.error || 'Download failed', 'error');
            } else if (type === 'valueCase' && window.electronAPI.valueCase?.download) {
                const r = await window.electronAPI.valueCase.download();
                if (r.success) showToast('Value Case doc saved', 'success');
                else if (!r.canceled) showToast(r.error || 'Download failed', 'error');
            } else if (type === 'provocation' && window.electronAPI.provocation?.download) {
                const r = await window.electronAPI.provocation.download();
                if (r.success) showToast('Provocation doc saved', 'success');
                else if (!r.canceled) showToast(r.error || 'Download failed', 'error');
            } else if (type === 'provocation-version' && window.electronAPI.provocation?.downloadVersion) {
                const idx = parseInt(btn.dataset.versionIndex, 10);
                const r = await window.electronAPI.provocation.downloadVersion(idx);
                if (r.success) showToast('Provoke version saved', 'success');
                else if (!r.canceled) showToast(r.error || 'Download failed', 'error');
            }
        });
    });
}

/**
 * Generate the review document with a specific C-suite persona
 */
async function generateReview(role) {
    if (!state.isElectron) {
        showToast('Review generation requires the Electron app', 'error');
        return;
    }

    if (state.reviewGenerating) {
        showToast('Review already in progress', 'info');
        return;
    }

    if (!state.selectedClient) {
        showToast('No client selected', 'error');
        return;
    }

    if (!role) {
        showToast('Select a C-suite reviewer first', 'info');
        return;
    }

    const roleInfo = CSUITE_ROLES[role];
    const rolePrompt = state.csuitePrompts?.[role] || '';

    // Begin generation
    state.reviewGenerating = true;
    state.reviewSelectedRole = role;
    state.reviewGenerationStartTime = Date.now();

    // Hide prompt editor and tiles area during generation
    if (elements.csuitePromptEditor) elements.csuitePromptEditor.classList.add('hidden');

    // UI: show progress
    if (elements.reviewProgress) elements.reviewProgress.classList.remove('hidden');
    updateReviewProgress(`Running ${roleInfo?.label || role.toUpperCase()} review...`, 0);

    // Start elapsed timer
    const timerInterval = setInterval(() => {
        if (!state.reviewGenerationStartTime) { clearInterval(timerInterval); return; }
        const elapsed = Math.floor((Date.now() - state.reviewGenerationStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        if (elements.reviewProgressElapsed) {
            elements.reviewProgressElapsed.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);

    try {
        const result = await window.electronAPI.review.generate(
            state.selectedClient.name,
            role,
            rolePrompt
        );

        clearInterval(timerInterval);
        state.reviewGenerating = false;
        state.reviewGenerationStartTime = null;

        if (result.success) {
            // Store changes and questions per role
            state.reviewsByRole[role] = {
                changes: result.changes || [],
                questions: result.questions || []
            };

            // Render the checklist + questions for this role and show it
            renderReviewChecklist(role, result.changes || [], result.questions || []);
            selectCsuiteTile(role);

            if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');

            // Show rewrite button on that tile
            const rewriteBtn = document.querySelector(`.csuite-rewrite-btn[data-role="${role}"]`);
            if (rewriteBtn) rewriteBtn.classList.remove('hidden');

            // Refresh asset summary
            renderReviewAssetSummary();

            const qCount = (result.questions || []).length;
            showToast(`${roleInfo?.label || role.toUpperCase()} review: ${(result.changes || []).length} changes, ${qCount} questions`, 'success');

            // Save review to history
            saveSessionProgress(7);
        } else {
            showToast(result.error || 'Review generation failed', 'error');
            if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');
        }
    } catch (error) {
        clearInterval(timerInterval);
        state.reviewGenerating = false;
        state.reviewGenerationStartTime = null;
        console.error('[Step 7] Review generation error:', error);
        showToast('Review failed: ' + error.message, 'error');
        if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');
    }
}

/**
 * Render a collapsible checklist of recommended changes for a C-suite role.
 * If a checklist for this role already exists, it is replaced.
 */
function renderReviewChecklist(role, changes, questions) {
    const container = elements.reviewChecklistsContainer;
    if (!container) return;

    const roleInfo = CSUITE_ROLES[role] || {};
    const existingPanel = container.querySelector(`.review-checklist-panel[data-role="${role}"]`);
    if (existingPanel) existingPanel.remove();

    const hasChanges = changes && changes.length > 0;
    const hasQuestions = questions && questions.length > 0;
    if (!hasChanges && !hasQuestions) return;

    const panel = document.createElement('div');
    panel.className = 'review-checklist-panel';
    panel.dataset.role = role;

    // ---- CHANGES SECTION ----
    if (hasChanges) {
        const changesSection = document.createElement('div');
        changesSection.className = 'review-section review-changes-section';

        const changesHeader = document.createElement('div');
        changesHeader.className = 'review-checklist-header';
        changesHeader.innerHTML = `
            <div class="review-checklist-header-left">
                <span class="review-checklist-icon">✏️</span>
                <span class="review-checklist-title">Recommended Changes</span>
                <span class="review-checklist-count">${changes.length} change${changes.length !== 1 ? 's' : ''}</span>
            </div>
            <svg class="review-checklist-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <polyline points="6 9 12 15 18 9"/>
            </svg>
        `;
        changesHeader.addEventListener('click', () => {
            changesSection.classList.toggle('expanded');
        });

        const changesBody = document.createElement('div');
        changesBody.className = 'review-checklist-body';

        for (const change of changes) {
            const item = document.createElement('label');
            item.className = 'review-checklist-item';
            item.innerHTML = `
                <input type="checkbox" class="review-checklist-checkbox" data-change-id="${change.id || ''}">
                <div class="review-checklist-item-content">
                    <div class="review-checklist-item-title">${escapeHtml(change.title)}</div>
                    <div class="review-checklist-item-detail">${escapeHtml(change.detail)}</div>
                </div>
            `;
            changesBody.appendChild(item);
        }

        changesSection.appendChild(changesHeader);
        changesSection.appendChild(changesBody);
        changesSection.classList.add('expanded');
        panel.appendChild(changesSection);
    }

    // ---- QUESTIONS SECTION ----
    if (hasQuestions) {
        const questionsSection = document.createElement('div');
        questionsSection.className = 'review-section review-questions-section';

        const questionsHeader = document.createElement('div');
        questionsHeader.className = 'review-checklist-header review-questions-header';
        questionsHeader.innerHTML = `
            <div class="review-checklist-header-left">
                <span class="review-checklist-icon">❓</span>
                <span class="review-checklist-title">Likely ${roleInfo.label || role.toUpperCase()} Questions</span>
                <span class="review-checklist-count">${questions.length} question${questions.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="review-questions-header-right">
                <button class="review-questions-dl-btn" data-role="${role}" title="Download questions as Word doc">⬇️</button>
                <svg class="review-checklist-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
            </div>
        `;
        // Expand/collapse on header click (but not on download button)
        questionsHeader.addEventListener('click', (e) => {
            if (e.target.closest('.review-questions-dl-btn')) return;
            questionsSection.classList.toggle('expanded');
        });
        // Download questions button
        questionsHeader.querySelector('.review-questions-dl-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.electronAPI?.review?.downloadQuestions) {
                showToast('Download not available', 'error');
                return;
            }
            try {
                const r = await window.electronAPI.review.downloadQuestions(role);
                if (r.success) showToast('Questions document saved', 'success');
                else if (!r.canceled) showToast(r.error || 'Download failed', 'error');
            } catch (err) {
                showToast('Download failed: ' + err.message, 'error');
            }
        });

        const questionsBody = document.createElement('div');
        questionsBody.className = 'review-checklist-body review-questions-body';

        for (const q of questions) {
            const qItem = document.createElement('div');
            qItem.className = 'review-question-item';
            qItem.innerHTML = `
                <span class="review-question-bullet">•</span>
                <span class="review-question-text">${escapeHtml(q.text || q)}</span>
            `;
            questionsBody.appendChild(qItem);
        }

        questionsSection.appendChild(questionsHeader);
        questionsSection.appendChild(questionsBody);
        questionsSection.classList.add('expanded');
        panel.appendChild(questionsSection);
    }

    // Start hidden — selectCsuiteTile() controls which panel is visible
    panel.classList.add('hidden');

    container.appendChild(panel);
}

/**
 * Escape HTML special characters for safe insertion
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Update review progress bar UI
 */
function updateReviewProgress(stage, pct) {
    const stageLabels = {
        'reviewing': 'AI is reviewing documents...',
        'rewriting': 'AI is rewriting the provoke based on review...',
        'building_doc': 'Building review Word document...',
        'building_rewrite': 'Building rewritten provoke Word document...',
        'done': 'Complete!'
    };
    const label = stageLabels[stage] || stage || 'Processing...';
    if (elements.reviewProgressLabel) elements.reviewProgressLabel.textContent = label;
    if (elements.reviewProgressFill) {
        elements.reviewProgressFill.style.width = `${Math.min(100, pct || 0)}%`;
        // Add pulsing animation during active AI processing stages
        if (stage === 'reviewing' || stage === 'rewriting') {
            elements.reviewProgressFill.classList.add('progress-indeterminate');
        } else {
            elements.reviewProgressFill.classList.remove('progress-indeterminate');
        }
    }
}

/**
 * Reset review UI to initial state
 */
function resetReviewUI() {
    state.reviewGenerating = false;
    state.reviewMarkdown = null;
    state.reviewGenerationStartTime = null;
    state.reviewSelectedRole = null;
    state.reviewsByRole = {};
    state.provokeVersions = [];

    if (elements.reviewProgress) elements.reviewProgress.classList.add('hidden');
    if (elements.reviewChecklistsContainer) elements.reviewChecklistsContainer.innerHTML = '';
    if (elements.reviewProgressFill) elements.reviewProgressFill.style.width = '0%';
    if (elements.reviewProgressLabel) elements.reviewProgressLabel.textContent = 'Initializing...';
    if (elements.reviewProgressElapsed) elements.reviewProgressElapsed.textContent = '0:00';
    if (elements.reviewAssetsGrid) elements.reviewAssetsGrid.innerHTML = '';
    if (elements.csuitePromptEditor) elements.csuitePromptEditor.classList.add('hidden');
    if (elements.csuiteConfirmOverlay) elements.csuiteConfirmOverlay.classList.add('hidden');
    document.querySelectorAll('.csuite-tile').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.csuite-rewrite-btn').forEach(b => b.classList.add('hidden'));
}

// Render markdown to HTML (basic conversion)
function renderMarkdownToHtml(markdown) {
    if (!markdown) return '<p class="text-muted">No content</p>';
    
    // FIRST: Process bold BEFORE any other transformations (this is critical!)
    // Use multiple passes to catch all patterns
    let html = markdown
        .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')  // Non-greedy match
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');    // Greedy fallback
    
    // Now process tables
    html = processMarkdownTables(html);
    
    html = html
        // Escape HTML entities (but preserve our already-created tags)
        .replace(/&(?!amp;|lt;|gt;|nbsp;)/g, '&amp;')
        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Italic (single asterisks, not touching our strong tags)
        .replace(/(?<![*<])\*([^*<>]+)\*(?![*>])/g, '<em>$1</em>')
        // Bullet points
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^â€¢ (.+)$/gm, '<li>$1</li>')
        // Numbered lists
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        .replace(/^â”€â”€â”€+$/gm, '<hr>')
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
    
    // Clean up paragraphs around tables
    html = html.replace(/<p><table/g, '<table');
    html = html.replace(/<\/table><\/p>/g, '</table>');
    html = html.replace(/<br><table/g, '<table');
    html = html.replace(/<\/table><br>/g, '</table>');
    
    // Final cleanup: one more pass for any remaining paired ** patterns,
    // then strip any leftover unpaired ** so they don't cause display issues
    html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*\*/g, '');   // remove any unpaired **
    html = html.replace(/(?<![<\/\w])\*([^*<>]+)\*(?![>\w])/g, '<em>$1</em>'); // remaining paired *
    html = html.replace(/(?<![\w])\*(?![\w*])/g, ''); // strip truly orphaned *

    // Strip leftover heading markers that didn't get matched (e.g. inside table cells or inline)
    html = html.replace(/^#{1,6}\s+/gm, '');
    
    return html;
}

/**
 * Process markdown tables into HTML tables
 */
function processMarkdownTables(markdown) {
    const lines = markdown.split('\n');
    let result = [];
    let inTable = false;
    let tableRows = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Check if this line is a table row (starts and ends with |, or contains | with content)
        const isTableRow = /^\|(.+)\|$/.test(line) || /^[^|]+\|[^|]+/.test(line);
        const isSeparator = /^\|?[\s\-:|]+\|?$/.test(line) && line.includes('-');
        
        if (isTableRow || isSeparator) {
            if (!inTable) {
                inTable = true;
                tableRows = [];
            }
            tableRows.push(line);
        } else {
            if (inTable) {
                // End of table, convert collected rows
                result.push(convertTableToHtml(tableRows));
                tableRows = [];
                inTable = false;
            }
            result.push(lines[i]); // Keep original line (not trimmed)
        }
    }
    
    // Handle table at end of content
    if (inTable && tableRows.length > 0) {
        result.push(convertTableToHtml(tableRows));
    }
    
    return result.join('\n');
}

/**
 * Convert markdown table rows to HTML table
 */
function convertTableToHtml(rows) {
    if (rows.length < 2) return rows.join('\n'); // Not a valid table
    
    // Find the separator row (contains ---)
    let separatorIndex = -1;
    for (let i = 0; i < rows.length; i++) {
        if (/^\|?[\s\-:|]+\|?$/.test(rows[i]) && rows[i].includes('-')) {
            separatorIndex = i;
            break;
        }
    }
    
    // Parse cells from a row
    const parseCells = (row) => {
        // Remove leading/trailing pipes and split
        let cleaned = row.replace(/^\||\|$/g, '');
        return cleaned.split('|').map(cell => cell.trim());
    };
    
    let html = '<table class="narrative-table">';
    
    // Process header (rows before separator)
    if (separatorIndex > 0) {
        html += '<thead><tr>';
        const headerCells = parseCells(rows[0]);
        headerCells.forEach(cell => {
            html += `<th>${cell}</th>`;
        });
        html += '</tr></thead>';
    }
    
    // Process body (rows after separator, or all rows if no separator)
    const bodyStart = separatorIndex >= 0 ? separatorIndex + 1 : 0;
    if (bodyStart < rows.length) {
        html += '<tbody>';
        for (let i = bodyStart; i < rows.length; i++) {
            const cells = parseCells(rows[i]);
            html += '<tr>';
            cells.forEach(cell => {
                // Apply bold/italic formatting within cells
                let formattedCell = cell
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>');
                html += `<td>${formattedCell}</td>`;
            });
            html += '</tr>';
        }
        html += '</tbody>';
    }
    
    html += '</table>';
    return html;
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
    
    // Setup qualification prompt save button
    const saveQualPromptBtn = document.getElementById('saveQualPromptBtn');
    if (saveQualPromptBtn) {
        saveQualPromptBtn.addEventListener('click', saveQualificationPrompt);
    }
    
    // Setup value case prompt save button
    const saveValueCasePromptBtn = document.getElementById('saveValueCasePromptBtn');
    if (saveValueCasePromptBtn) {
        saveValueCasePromptBtn.addEventListener('click', saveValueCasePrompt);
    }
    
    // Setup provocation prompt save button
    const saveProvokePromptBtn = document.getElementById('saveProvokePromptBtn');
    if (saveProvokePromptBtn) {
        saveProvokePromptBtn.addEventListener('click', saveProvocationPrompt);
    }
    
    // Setup C-suite review prompts save button
    const saveCsuitePromptsBtn = document.getElementById('saveCsuitePromptsBtn');
    if (saveCsuitePromptsBtn) {
        saveCsuitePromptsBtn.addEventListener('click', saveAdminCsuitePrompts);
    }
    
    // Load existing templates, default prompt, source prompts, qualification prompt, provocation prompt, and C-suite prompts
    loadAdminTemplates();
    loadDefaultPrompt();
    loadSourcePrompts();
    loadAdminQualificationPrompt();
    loadAdminValueCasePrompt();
    loadAdminProvocationPrompt();
    loadAdminCsuitePrompts();
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
// Admin: C-Suite Review Prompts (Step 7)
// ============================================

async function loadAdminCsuitePrompts() {
    const roles = ['ceo', 'cfo', 'coo', 'cto', 'cmo'];
    try {
        if (state.isElectron && window.electronAPI.settings?.getCsuitePrompts) {
            const prompts = await window.electronAPI.settings.getCsuitePrompts();
            for (const role of roles) {
                const textarea = document.getElementById(`adminCsuite${role.charAt(0).toUpperCase() + role.slice(1)}`);
                if (textarea) textarea.value = prompts?.[role] || '';
            }
            state.csuitePrompts = prompts || {};
        }
    } catch (error) {
        console.error('Error loading C-suite prompts:', error);
    }
}

async function saveAdminCsuitePrompts() {
    const roles = ['ceo', 'cfo', 'coo', 'cto', 'cmo'];
    const btn = document.getElementById('saveCsuitePromptsBtn');

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
        const prompts = {};
        for (const role of roles) {
            const textarea = document.getElementById(`adminCsuite${role.charAt(0).toUpperCase() + role.slice(1)}`);
            prompts[role] = textarea?.value || '';
        }

        if (state.isElectron && window.electronAPI.settings?.saveCsuitePrompts) {
            const result = await window.electronAPI.settings.saveCsuitePrompts(prompts);
            if (result.success) {
                state.csuitePrompts = prompts;
                showToast('C-suite review prompts saved', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving C-suite prompts:', error);
        showToast('Failed to save C-suite prompts', 'error');
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

// ============================================
// Admin: Qualification Criteria Prompt
// ============================================

async function loadAdminQualificationPrompt() {
    const textarea = document.getElementById('adminQualPrompt');
    if (!textarea) return;

    try {
        if (state.isElectron && window.electronAPI.settings?.getQualPrompt) {
            const prompt = await window.electronAPI.settings.getQualPrompt();
            textarea.value = prompt || '';
        }
    } catch (error) {
        console.error('Error loading qualification prompt:', error);
    }
}

async function saveQualificationPrompt() {
    const textarea = document.getElementById('adminQualPrompt');
    const btn = document.getElementById('saveQualPromptBtn');

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
        if (state.isElectron && window.electronAPI.settings?.saveQualPrompt) {
            const result = await window.electronAPI.settings.saveQualPrompt(textarea.value);
            if (result.success) {
                // Also update the cached default so Step 4 reset picks it up
                state.qualDefaultPrompt = textarea.value;
                showToast('Qualification prompt saved', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving qualification prompt:', error);
        showToast('Failed to save qualification prompt', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// ============================================
// Admin: Value Case Prompt
// ============================================

async function loadAdminValueCasePrompt() {
    const textarea = document.getElementById('adminValueCasePrompt');
    if (!textarea) return;

    try {
        if (state.isElectron && window.electronAPI.settings?.getValueCasePrompt) {
            const prompt = await window.electronAPI.settings.getValueCasePrompt();
            textarea.value = prompt || '';
        }
    } catch (error) {
        console.error('Error loading value case prompt:', error);
    }
}

async function saveValueCasePrompt() {
    const textarea = document.getElementById('adminValueCasePrompt');
    const btn = document.getElementById('saveValueCasePromptBtn');

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
        if (state.isElectron && window.electronAPI.settings?.saveValueCasePrompt) {
            const result = await window.electronAPI.settings.saveValueCasePrompt(textarea.value);
            if (result.success) {
                state.valueCaseDefaultPrompt = textarea.value;
                showToast('Value case prompt saved', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving value case prompt:', error);
        showToast('Failed to save value case prompt', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// ============================================
// Admin: Provocation / Origination Engine Prompt
// ============================================

async function loadAdminProvocationPrompt() {
    const textarea = document.getElementById('adminProvokePrompt');
    if (!textarea) return;

    try {
        if (state.isElectron && window.electronAPI.settings?.getProvokePrompt) {
            const prompt = await window.electronAPI.settings.getProvokePrompt();
            textarea.value = prompt || '';
        }
    } catch (error) {
        console.error('Error loading provocation prompt:', error);
    }
}

async function saveProvocationPrompt() {
    const textarea = document.getElementById('adminProvokePrompt');
    const btn = document.getElementById('saveProvokePromptBtn');

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
        if (state.isElectron && window.electronAPI.settings?.saveProvokePrompt) {
            const result = await window.electronAPI.settings.saveProvokePrompt(textarea.value);
            if (result.success) {
                state.provokeDefaultPrompt = textarea.value;
                showToast('Provocation prompt saved', 'success');
            }
        } else {
            showToast('Settings are only available in the desktop app', 'info');
        }
    } catch (error) {
        console.error('Error saving provocation prompt:', error);
        showToast('Failed to save provocation prompt', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        ? `<li class="generated"><strong>3.0</strong> Client Point of Contact Info (${state.pocFile.name}) âœ“</li>`
        : '';
    
    // Additional files section (now 4.0)
    const additionalFilesHtml = additionalFilesCount > 0 
        ? `<li class="generated"><strong>4.0</strong> Additional Client Materials (${additionalFilesCount} file${additionalFilesCount !== 1 ? 's' : ''}) âœ“</li>`
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
                    <li class="generated"><strong>0.3</strong> Situation DeepResearch âœ“</li>
                    <li><strong>1.0</strong> Complication Summary</li>
                    <li class="placeholder"><strong>1.1</strong> Complication AlphaSense [PLACEHOLDER]</li>
                    <li class="placeholder"><strong>1.2</strong> Complication ARC [PLACEHOLDER]</li>
                    <li class="generated"><strong>1.3</strong> Complication DeepResearch âœ“</li>
                    <li><strong>2.0</strong> Value Summary</li>
                    <li class="placeholder"><strong>2.1</strong> Value AlphaSense [PLACEHOLDER]</li>
                    <li class="placeholder"><strong>2.2</strong> Value ARC [PLACEHOLDER]</li>
                    <li class="generated"><strong>2.3</strong> Value DeepResearch âœ“</li>
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
                'Revenue Growth': { value: '12%', trend: 'up', trend_indicator: 'â†‘', benchmark: '10%' }
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
            statusLabel: 'âœ… Ready',
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
            statusEl.textContent = 'âœ“';
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
    const sessions = state.generatedPacks.filter(p => p.type === 'client-session');
    const completedDocs = sessions.filter(s => s.qualificationMarkdown || s.provocationMarkdown || s.reviewMarkdown).length;
    document.getElementById('statPacks').textContent = sessions.length;
    document.getElementById('statReady').textContent = completedDocs;
    document.getElementById('statCaveats').textContent = 
        sessions.filter(p => (p.currentStep || 2) >= 4).length;
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
// History Functions — Step-Based Session Model
// ============================================
// Each client gets ONE history entry. Progress is tracked by currentStep (2-7).
// Data from each step (POC, supporting docs, qual, value case, provoke, review) is persisted.
// Clicking a history item restores ALL state and navigates to the last reached step.

const STEP_LABELS = {
    2: 'Configure',
    3: 'Supporting Docs',
    4: 'Qualification',
    5: 'Value Case',
    6: 'Provocation',
    7: 'Review'
};

/**
 * Find or create a history entry for the given client.
 */
function getOrCreateHistoryEntry(client) {
    if (!client?.id) return null;

    let entry = state.generatedPacks.find(p => p.clientId === client.id);
    if (!entry) {
        entry = {
            id: 'sess_' + client.id + '_' + Date.now(),
            clientId: client.id,
            type: 'client-session',
            client: { ...client },
            currentStep: 2,
            createdAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            // Step 2
            pocFile: null,
            // Step 3
            supportingDocNames: [],
            // Step 4
            qualificationMarkdown: null,
            qualPrompt: '',
            // Step 5
            valueCaseMarkdown: null,
            valueCasePrompt: '',
            // Step 6
            provocationMarkdown: null,
            provokePrompt: '',
            // Step 7
            reviewMarkdown: null,
            reviewSelectedRole: null
        };
        state.generatedPacks.unshift(entry);
        console.log('[History] Created entry for:', client.commonName || client.name);
    }
    return entry;
}

/**
 * Save progress for the current client.
 * Called on every step transition and after every generation/upload.
 * @param {number} step - The step number (2-7) the user has reached or is working in.
 */
function saveSessionProgress(step) {
    const client = state.selectedClient;
    if (!client?.id) {
        console.warn('[History] Cannot save — no selected client');
        return;
    }

    const entry = getOrCreateHistoryEntry(client);
    if (!entry) return;

    // Always update client snapshot & timestamp
    entry.client = { ...client };
    entry.lastUpdatedAt = new Date().toISOString();

    // Advance step (never go backwards)
    if (typeof step === 'number' && step > (entry.currentStep || 2)) {
        entry.currentStep = step;
    }

    // --- Capture data from current state ---

    // Step 2: POC file (save reference, not content — too large for history)
    if (state.pocFile) {
        entry.pocFile = {
            name: state.pocFile.name,
            originalName: state.pocFile.originalName || state.pocFile.name,
            size: state.pocFile.size || 0
        };
    }

    // Step 3: Supporting doc file names
    if (state.supportingDocFiles && state.supportingDocFiles.length > 0) {
        entry.supportingDocNames = state.supportingDocFiles.map(f => f.fileName || f.name || 'unknown');
    }

    // Step 4: Qualification
    if (state.qualificationMarkdown) {
        entry.qualificationMarkdown = state.qualificationMarkdown;
        entry.qualPrompt = elements.qualPromptEditor?.value || entry.qualPrompt || '';
    }

    // Step 5: Value Case
    if (state.valueCaseMarkdown) {
        entry.valueCaseMarkdown = state.valueCaseMarkdown;
        entry.valueCasePrompt = elements.valueCasePromptEditor?.value || entry.valueCasePrompt || '';
    }
    if (state.valueCaseAssumptions && state.valueCaseAssumptions.length > 0) {
        entry.valueCaseAssumptions = state.valueCaseAssumptions;
    }

    // Step 6: Provocation
    if (state.provocationMarkdown) {
        entry.provocationMarkdown = state.provocationMarkdown;
        entry.provokePrompt = elements.provokePromptEditor?.value || entry.provokePrompt || '';
    }

    // Step 7: Review — now stores per-role changes (not a single markdown)
    entry.reviewSelectedRole = state.reviewSelectedRole || entry.reviewSelectedRole;

    // Step 7: Per-role review changes
    if (state.reviewsByRole && Object.keys(state.reviewsByRole).length > 0) {
        entry.reviewsByRole = {};
        for (const [role, changes] of Object.entries(state.reviewsByRole)) {
            entry.reviewsByRole[role] = changes;
        }
    }

    // Step 7: Provoke rewrite versions (store markdown only)
    if (state.provokeVersions && state.provokeVersions.length > 1) {
        entry.provokeRewriteVersions = state.provokeVersions.slice(1).map(v => ({
            label: v.label,
            markdown: v.markdown,
            fileName: v.fileName,
            role: v.role
        }));
    }

    // Move to front (most recently updated first)
    const idx = state.generatedPacks.indexOf(entry);
    if (idx > 0) {
        state.generatedPacks.splice(idx, 1);
        state.generatedPacks.unshift(entry);
    }

    // Keep max 50 entries
    if (state.generatedPacks.length > 50) {
        state.generatedPacks = state.generatedPacks.slice(0, 50);
    }

    // Persist to disk
    persistHistory();

    console.log('[History] Saved:', client.commonName || client.name, '→ Step', entry.currentStep);
}

/**
 * Persist history to disk via Electron IPC.
 */
function persistHistory() {
    if (window.electronAPI?.appData) {
        window.electronAPI.appData.saveGeneratedPacks(state.generatedPacks);
    }
}

/**
 * Render the history list view.
 */
function updateHistoryView() {
    const sessions = state.generatedPacks.filter(p => p.type === 'client-session');

    if (sessions.length === 0) {
        elements.historyEmpty.classList.remove('hidden');
        elements.historyList.classList.add('hidden');
    } else {
        elements.historyEmpty.classList.add('hidden');
        elements.historyList.classList.remove('hidden');

        elements.historyList.innerHTML = sessions.map(pack => {
            const clientName = pack.client?.commonName || pack.client?.name || 'Unknown Client';
            const lastUpdated = pack.lastUpdatedAt || pack.createdAt || new Date().toISOString();
            const step = pack.currentStep || 2;
            const stepLabel = STEP_LABELS[step] || 'Configure';

            // Build a progress dots visualization (steps 2-6)
            const dots = [2, 3, 4, 5, 6].map(s => {
                const cls = s < step ? 'completed' : s === step ? 'active' : 'pending';
                return '<span class="history-step-dot ' + cls + '" title="Step ' + s + ': ' + STEP_LABELS[s] + '"></span>';
            }).join('');

            // Summary of what has been generated
            const parts = [];
            if (pack.qualificationMarkdown) parts.push('Qual');
            if (pack.provocationMarkdown) parts.push('Provoke');
            if (pack.reviewsByRole && Object.keys(pack.reviewsByRole).length > 0) parts.push('Review');
            const genSummary = parts.length > 0 ? parts.join(' \u00B7 ') : '';

            return '<div class="history-item" data-pack-id="' + pack.id + '">' +
                '<div class="history-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
                        '<path d="M3 9h18"/><path d="M9 21V9"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="history-info">' +
                    '<span class="history-title">' + clientName + '</span>' +
                    '<span class="history-meta">' + new Date(lastUpdated).toLocaleString() + (genSummary ? ' \u00B7 ' + genSummary : '') + '</span>' +
                '</div>' +
                '<div class="history-progress">' +
                    '<div class="history-step-dots">' + dots + '</div>' +
                    '<span class="history-step-label">Step ' + step + ': ' + stepLabel + '</span>' +
                '</div>' +
                '<div class="history-actions">' +
                    '<button class="btn btn-ghost btn-sm" onclick="viewHistoryPack(\'' + pack.id + '\')">Resume</button>' +
                    '<button class="btn btn-ghost btn-sm" onclick="deleteHistoryEntry(\'' + pack.id + '\')" title="Remove from history" style="color: var(--danger); padding: 4px;">\u2715</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }
}

function deleteHistoryEntry(packId) {
    const idx = state.generatedPacks.findIndex(p => p.id === packId);
    if (idx >= 0) {
        const entry = state.generatedPacks[idx];
        state.generatedPacks.splice(idx, 1);
        persistHistory();
        updateHistoryView();
        updateDashboardStats();
        showToast('Removed ' + (entry.client?.commonName || entry.client?.name || 'entry') + ' from history', 'info');
    }
}

/**
 * Restore a history entry — loads all saved state and navigates to the last reached step.
 */
async function viewHistoryPack(packId) {
    const pack = state.generatedPacks.find(p => p.id === packId);
    if (!pack) return;

    // --- Reset current wizard state without touching history ---
    state.isGenerating = false;
    state.qualificationGenerating = false;
    state.valueCaseGenerating = false;
    state.provocationGenerating = false;
    state.reviewGenerating = false;
    state.qualificationMarkdown = null;
    state.valueCaseMarkdown = null;
    state.valueCaseAssumptions = null;
    state.provocationMarkdown = null;
    state.reviewMarkdown = null;
    state.reviewSelectedRole = null;
    state.pocFile = null;
    state.supportingDocFiles = [];
    state.supportingDocsCorpus = null;

    // --- Restore client ---
    const liveClient = state.clients.find(c => c.id === pack.client?.id);
    state.selectedClient = liveClient || pack.client;

    // Switch to generate view (without resetWizard — we are restoring)
    const views = ['dashboard', 'generate', 'history', 'admin'];
    views.forEach(function(v) {
        const el = document.getElementById(v + 'View');
        if (el) el.classList.toggle('hidden', v !== 'generate');
    });
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.toggle('active', item.dataset.view === 'generate');
    });
    state.currentView = 'generate';

    // --- Restore Step 2: Configure ---
    renderClientGrid(elements.clientSearch?.value || '');
    if (state.selectedClient) {
        document.getElementById('industry').value = state.selectedClient.industry || '';
        document.getElementById('geography').value = state.selectedClient.geography || '';
    }

    // Restore POC file UI (reference only — content not persisted in history)
    if (pack.pocFile) {
        var pocFileName = document.getElementById('pocFileName');
        var pocFileSize = document.getElementById('pocFileSize');
        var pocEmpty = document.getElementById('pocEmpty');
        var pocFileInfo = document.getElementById('pocFileInfo');
        if (pocEmpty) pocEmpty.classList.add('hidden');
        if (pocFileInfo) pocFileInfo.classList.remove('hidden');
        if (pocFileName) pocFileName.textContent = (pack.pocFile.originalName || pack.pocFile.name || 'POC file') + ' (from previous session)';
        if (pocFileSize) pocFileSize.textContent = formatFileSize(pack.pocFile.size || 0);
    }

    // --- Restore Step 3: Supporting Docs summary ---
    if (pack.supportingDocNames && pack.supportingDocNames.length > 0) {
        var docFileList = document.getElementById('docFileList');
        if (docFileList) {
            docFileList.innerHTML = pack.supportingDocNames.map(function(name) {
                return '<div class="doc-file-item">' +
                    '<span class="doc-file-name">' + name + '</span>' +
                    '<span class="doc-file-status" style="color: var(--text-muted); font-size: 0.8em;">(from previous session)</span>' +
                '</div>';
            }).join('');
        }
    }

    // --- Restore Step 4: Qualification ---
    if (pack.qualificationMarkdown) {
        state.qualificationMarkdown = pack.qualificationMarkdown;
        if (elements.qualPreviewContent) {
            elements.qualPreviewContent.innerHTML = renderMarkdownToHtml(pack.qualificationMarkdown);
        }
        if (elements.qualPreview) elements.qualPreview.classList.remove('hidden');
        if (elements.qualProgress) elements.qualProgress.classList.add('hidden');
        if (elements.proceedToStep5) elements.proceedToStep5.disabled = false;
    }
    if (pack.qualPrompt && elements.qualPromptEditor) {
        elements.qualPromptEditor.value = pack.qualPrompt;
    }

    // --- Restore Step 5: Value Case ---
    if (pack.valueCaseMarkdown) {
        state.valueCaseMarkdown = pack.valueCaseMarkdown;
        if (elements.valueCasePreviewContent) {
            elements.valueCasePreviewContent.innerHTML = renderMarkdownToHtml(pack.valueCaseMarkdown);
        }
        if (elements.valueCasePreview) elements.valueCasePreview.classList.remove('hidden');
        if (elements.valueCaseProgress) elements.valueCaseProgress.classList.add('hidden');
        if (elements.proceedToStep6) elements.proceedToStep6.disabled = false;

        // Restore assumptions table if saved, otherwise re-extract
        if (pack.valueCaseAssumptions && Array.isArray(pack.valueCaseAssumptions) && pack.valueCaseAssumptions.length > 0) {
            state.valueCaseAssumptions = pack.valueCaseAssumptions;
            renderAssumptionsTable(pack.valueCaseAssumptions);
        } else {
            extractAndRenderAssumptions();
        }
    }
    if (pack.valueCasePrompt && elements.valueCasePromptEditor) {
        elements.valueCasePromptEditor.value = pack.valueCasePrompt;
    }

    // --- Restore Step 6: Provocation ---
    if (pack.provocationMarkdown) {
        state.provocationMarkdown = pack.provocationMarkdown;
        if (elements.provokePreviewContent) {
            elements.provokePreviewContent.innerHTML = renderMarkdownToHtml(pack.provocationMarkdown);
        }
        if (elements.provokePreview) elements.provokePreview.classList.remove('hidden');
        if (elements.provokeProgress) elements.provokeProgress.classList.add('hidden');
    }
    if (pack.provokePrompt && elements.provokePromptEditor) {
        elements.provokePromptEditor.value = pack.provokePrompt;
    }

    // --- Restore Step 7: Review ---
    if (pack.reviewsByRole && typeof pack.reviewsByRole === 'object') {
        state.reviewsByRole = { ...pack.reviewsByRole };
        state.reviewSelectedRole = pack.reviewSelectedRole || null;
        // Render checklists for each role that has data
        for (const role of Object.keys(pack.reviewsByRole)) {
            const data = pack.reviewsByRole[role];
            // Handle both new shape { changes, questions } and legacy bare array
            const changes = Array.isArray(data) ? data : (data?.changes || []);
            const questions = Array.isArray(data) ? [] : (data?.questions || []);
            // Normalise state to new shape
            if (Array.isArray(data)) {
                state.reviewsByRole[role] = { changes, questions };
            }
            if (changes.length > 0 || questions.length > 0) {
                renderReviewChecklist(role, changes, questions);
            }
            const rewriteBtn = document.querySelector('.csuite-rewrite-btn[data-role="' + role + '"]');
            if (rewriteBtn && changes.length > 0) rewriteBtn.classList.remove('hidden');
        }
        // Select the last-used role tile (highlights it and shows only its checklist)
        if (pack.reviewSelectedRole) {
            selectCsuiteTile(pack.reviewSelectedRole);
        }
    } else {
        state.reviewsByRole = {};
    }

    // Restore provoke rewrite versions
    state.provokeVersions = [];
    if (pack.provokeRewriteVersions && Array.isArray(pack.provokeRewriteVersions)) {
        // Rebuild versions array: original at index 0, then rewrites
        if (pack.provocationMarkdown) {
            state.provokeVersions.push({
                label: 'Original Provoke',
                markdown: pack.provocationMarkdown,
                fileName: '',
                role: null,
                timestamp: 0
            });
        }
        for (const v of pack.provokeRewriteVersions) {
            state.provokeVersions.push(v);
        }
    }

    // Restore document state in the main process so review:getAssets works
    if (state.isElectron && window.electronAPI.session?.restoreDocState) {
        try {
            await window.electronAPI.session.restoreDocState({
                qualificationMarkdown: state.qualificationMarkdown || null,
                valueCaseMarkdown: state.valueCaseMarkdown || null,
                provocationMarkdown: state.provocationMarkdown || null,
                reviewMarkdown: null,
                reviewsByRole: pack.reviewsByRole || null,
                provokeRewriteVersions: pack.provokeRewriteVersions || null,
                clientName: state.selectedClient?.name || 'Client'
            });
        } catch (e) {
            console.warn('[History] Failed to restore doc state in main process:', e);
        }
    }

    // Navigate to the last reached step
    var targetStep = pack.currentStep || 2;
    state.highestStepReached = targetStep; // restore high-water mark before navigating
    goToStep(targetStep);

    showToast('Resumed ' + (pack.client?.commonName || pack.client?.name || 'session') + ' \u2014 Step ' + targetStep, 'info');
    console.log('[History] Restored session:', pack.client?.commonName || pack.client?.name, '\u2192 Step', targetStep);
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
            
            // Load masked credentials for each provider
            await loadMaskedCredentials('alphasense');
            await loadMaskedCredentials('arc');
            await loadMaskedCredentials('openai');
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
            const titlePart = p.maxCharsTitle ? `Tâ‰¤${p.maxCharsTitle}` : '';
            const bodyPart = p.maxCharsBody ? `Bâ‰¤${p.maxCharsBody}` : '';
            const combined = [titlePart, bodyPart].filter(Boolean).join(' ');
            maxCharsBadge = `<span class="placeholder-list-badge" title="Title: ${p.maxCharsTitle || 'no limit'}, Body: ${p.maxCharsBody || 'no limit'}" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">
                 ${combined}
               </span>`;
        } else if (p.maxChars) {
            maxCharsBadge = `<span class="placeholder-list-badge" title="Max ${p.maxChars} characters per output" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24;">
                 â‰¤${p.maxChars}
               </span>`;
        }
        
        // Build strategic question badge
        const strategicBadge = p.considerStrategicQuestion ? 
            `<span class="placeholder-list-badge" title="Considers strategic question as a factor" style="background: rgba(139, 92, 246, 0.2); color: #a78bfa;">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                   <circle cx="12" cy="12" r="10"/>
                   <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                   <line x1="12" y1="17" x2="12.01" y2="17"/>
                 </svg>
                 Question
               </span>` : '';
        
        // Build strategy document badge
        const strategyBadge = p.considerStrategy ? 
            `<span class="placeholder-list-badge" title="Uses client strategy document as context" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                   <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                   <polyline points="14,2 14,8 20,8"/>
                   <line x1="16" y1="13" x2="8" y2="13"/>
                   <line x1="16" y1="17" x2="8" y2="17"/>
                 </svg>
                 Strategy
               </span>` : '';
        
        // Build research badge
        const researchBadge = p.research ? 
            `<span class="placeholder-list-badge" title="Uses web search for research" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                   <circle cx="11" cy="11" r="8"/>
                   <path d="M21 21l-4.35-4.35"/>
                 </svg>
                 Research
               </span>` : '';
        
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
                    ${strategicBadge}
                    ${strategyBadge}
                    ${researchBadge}
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
    const considerStrategicQuestionCheckbox = document.getElementById('placeholderConsiderStrategicQuestion');
    const considerStrategyCheckbox = document.getElementById('placeholderConsiderStrategy');
    const researchCheckbox = document.getElementById('placeholderResearch');
    
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
        if (considerStrategicQuestionCheckbox) {
            considerStrategicQuestionCheckbox.checked = placeholder.considerStrategicQuestion || false;
        }
        if (considerStrategyCheckbox) {
            considerStrategyCheckbox.checked = placeholder.considerStrategy || false;
        }
        if (researchCheckbox) {
            researchCheckbox.checked = placeholder.research || false;
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
        if (considerStrategicQuestionCheckbox) {
            considerStrategicQuestionCheckbox.checked = false;
        }
        if (considerStrategyCheckbox) {
            considerStrategyCheckbox.checked = false;
        }
        if (researchCheckbox) {
            researchCheckbox.checked = false;
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
    const considerStrategicQuestionCheckbox = document.getElementById('placeholderConsiderStrategicQuestion');
    const considerStrategicQuestion = considerStrategicQuestionCheckbox?.checked || false;
    const considerStrategyCheckbox = document.getElementById('placeholderConsiderStrategy');
    const considerStrategy = considerStrategyCheckbox?.checked || false;
    const researchCheckbox = document.getElementById('placeholderResearch');
    const research = researchCheckbox?.checked || false;
    
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
                maxCharsBody: maxCharsBody,
                considerStrategicQuestion: considerStrategicQuestion,
                considerStrategy: considerStrategy,
                research: research
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
                maxCharsBody: maxCharsBody,
                considerStrategicQuestion: considerStrategicQuestion,
                considerStrategy: considerStrategy,
                research: research
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
    
    // Step 2 → Step 3
    elements.proceedToStep3?.addEventListener('click', () => {
        goToStep(3);
    });
    
    // Step 4 → Step 5 (Value Case)
    elements.proceedToStep5?.addEventListener('click', () => {
        goToStep(5);
    });
    
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
window.viewHistoryPack = viewHistoryPack;
window.deleteHistoryEntry = deleteHistoryEntry;
window.exportHistoryPack = exportHistoryPack;

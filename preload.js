/**
 * R/StudioGPT
 * Preload Script - Secure Bridge between Main and Renderer
 * 
 * This script exposes a secure API to the renderer process
 * using context isolation for security.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Authentication
    auth: {
        login: (username, password) => 
            ipcRenderer.invoke('auth:login', { username, password }),
        logout: () => 
            ipcRenderer.invoke('auth:logout'),
        getSession: () => 
            ipcRenderer.invoke('auth:session')
    },

    // Client Management
    clients: {
        list: (search) => 
            ipcRenderer.invoke('clients:list', { search }),
        get: (id) => 
            ipcRenderer.invoke('clients:get', { id }),
        delete: (id) => 
            ipcRenderer.invoke('clients:delete', { id }),
        aiCreate: (companyName) => 
            ipcRenderer.invoke('clients:aiCreate', { companyName }),
        researchContacts: (client, type) => 
            ipcRenderer.invoke('clients:researchContacts', { client, type }),
        extractContactsFromPOC: (pocFile, client) =>
            ipcRenderer.invoke('clients:extractContactsFromPOC', { pocFile, client })
    },

    // Configuration & Credentials
    config: {
        getCredentials: () => 
            ipcRenderer.invoke('config:getCredentials'),
        getMaskedCredentials: (provider) => 
            ipcRenderer.invoke('config:getMaskedCredentials', { provider }),
        setCredentials: (provider, credentials) => 
            ipcRenderer.invoke('config:setCredentials', { provider, credentials }),
        testConnection: (provider) => 
            ipcRenderer.invoke('config:testConnection', { provider })
    },

    // Source Pack Operations
    sourcePack: {
        generate: (clientId, context) => 
            ipcRenderer.invoke('sourcePack:generate', { clientId, context }),
        generateZip: (clientId, context) => 
            ipcRenderer.invoke('sourcePack:generateZip', { clientId, context }),
        addFiles: () => 
            ipcRenderer.invoke('sourcePack:addFiles'),
        addPocFile: (pocFile) => 
            ipcRenderer.invoke('sourcePack:addPocFile', pocFile),
        replacePlaceholder: (placeholderId, fileName, content) => 
            ipcRenderer.invoke('sourcePack:replacePlaceholder', { placeholderId, fileName, content }),
        finalizeZip: () => 
            ipcRenderer.invoke('sourcePack:finalizeZip')
    },

    // Export Functions
    export: {
        toMarkdown: (sourcePack) => 
            ipcRenderer.invoke('export:markdown', { sourcePack }),
        saveFile: (content, defaultName, filters) => 
            ipcRenderer.invoke('export:saveFile', { content, defaultName, filters })
    },

    // Audit Logs
    audit: {
        getLogs: (limit, category) => 
            ipcRenderer.invoke('audit:getLogs', { limit, category })
    },

    // Health Check
    health: {
        check: () => 
            ipcRenderer.invoke('health:check')
    },

    // Menu Actions (receive from main process)
    onMenuAction: (callback) => {
        ipcRenderer.on('menu-action', (event, action) => callback(action));
    },
    
    // Progress Updates (receive from main process)
    onGenerationProgress: (callback) => {
        ipcRenderer.on('generation-progress', (event, data) => callback(data));
    },

    // AI Console Logs (receive chain-of-thought from agents)
    onAiConsoleLog: (callback) => {
        ipcRenderer.on('ai-console-log', (event, data) => callback(data));
    },

    // Narrative Builder (Step 5 - guided prompt creation)
    sourceChat: {
        sendMessage: (message) => 
            ipcRenderer.invoke('sourceChat:sendMessage', { message }),
        startConversation: () =>
            ipcRenderer.invoke('sourceChat:startConversation')
    },

    // Narrative Chat (Step 6 - Q&A with sources + narrative)
    narrativeChat: {
        sendMessage: (message, narrativeContent, sourcePack, mode = 'ask', highlightedText = null, fullRewriteConfirmed = false) => 
            ipcRenderer.invoke('narrativeChat:sendMessage', { 
                message, 
                narrativeContent, 
                sourcePack, 
                mode, 
                highlightedText,
                fullRewriteConfirmed 
            }),
        reset: () =>
            ipcRenderer.invoke('narrativeChat:reset'),
        cancel: () =>
            ipcRenderer.invoke('narrativeChat:cancel')
    },

    // Persistent App Data
    appData: {
        saveGeneratedPacks: (packs) => 
            ipcRenderer.invoke('appData:saveGeneratedPacks', packs),
        loadGeneratedPacks: () => 
            ipcRenderer.invoke('appData:loadGeneratedPacks')
    },

    // Template Management
    templates: {
        getAll: () => 
            ipcRenderer.invoke('templates:getAll'),
        addAdmin: () => 
            ipcRenderer.invoke('templates:addAdmin'),
        uploadCustom: () => 
            ipcRenderer.invoke('templates:uploadCustom'),
        delete: (templateId) => 
            ipcRenderer.invoke('templates:delete', templateId)
    },

    // Narrative Generation
    narrative: {
        generate: (params) => 
            ipcRenderer.invoke('narrative:generate', params),
        cancel: () => 
            ipcRenderer.invoke('narrative:cancel')
    },

    // Workshop Materials Generation
    workshop: {
        generate: (params) => 
            ipcRenderer.invoke('workshop:generate', params),
        uploadTemplate: (type) => 
            ipcRenderer.invoke('workshop:uploadTemplate', type),
        clearTemplate: (type) => 
            ipcRenderer.invoke('workshop:clearTemplate', type),
        getTemplates: () => 
            ipcRenderer.invoke('workshop:getTemplates')
    },

    // Template Placeholders
    placeholders: {
        getAll: () => 
            ipcRenderer.invoke('placeholders:getAll'),
        add: (placeholder) => 
            ipcRenderer.invoke('placeholders:add', placeholder),
        update: (id, placeholder) => 
            ipcRenderer.invoke('placeholders:update', { id, placeholder }),
        delete: (id) => 
            ipcRenderer.invoke('placeholders:delete', id),
        export: () =>
            ipcRenderer.invoke('placeholders:export'),
        import: () =>
            ipcRenderer.invoke('placeholders:import')
    },

    // Client Narratives
    narratives: {
        getForClient: (clientId) => 
            ipcRenderer.invoke('narratives:getForClient', clientId),
        save: (clientId, narrative) => 
            ipcRenderer.invoke('narratives:save', { clientId, narrative }),
        delete: (clientId, narrativeId) => 
            ipcRenderer.invoke('narratives:delete', { clientId, narrativeId })
    },

    // Video Generation (Runway ML)
    video: {
        generate: (options) => 
            ipcRenderer.invoke('video:generate', options)
    },

    // Narration Generation (ElevenLabs)
    narration: {
        generate: (options) => 
            ipcRenderer.invoke('narration:generate', options),
        getHistory: () => 
            ipcRenderer.invoke('narration:getHistory'),
        clearHistory: () => 
            ipcRenderer.invoke('narration:clearHistory'),
        deleteHistoryItem: (id) => 
            ipcRenderer.invoke('narration:deleteHistoryItem', id),
        getAudio: (id) => 
            ipcRenderer.invoke('narration:getAudio', id),
        generateFromNarrative: (options) => 
            ipcRenderer.invoke('narration:generateFromNarrative', options)
    },

    // Narrative Audio Progress
    onNarrativeAudioProgress: (callback) => {
        ipcRenderer.on('narrative-audio-progress', (event, data) => callback(data));
    },

    // Client Intel Pack
    intelPack: {
        generate: (options) => 
            ipcRenderer.invoke('intelPack:generate', options)
    },

    // Video Narrative Generation (Script to Video Montage)
    videoNarrative: {
        generate: (options) => 
            ipcRenderer.invoke('videoNarrative:generate', options),
        cancel: () => 
            ipcRenderer.invoke('videoNarrative:cancel')
    },

    // Video Narrative Progress
    onVideoNarrativeProgress: (callback) => {
        ipcRenderer.on('video-narrative-progress', (event, data) => callback(data));
    },

    // Settings (Admin)
    settings: {
        getDefaultPrompt: () => 
            ipcRenderer.invoke('settings:getDefaultPrompt'),
        saveDefaultPrompt: (prompt) => 
            ipcRenderer.invoke('settings:saveDefaultPrompt', prompt),
        getSourcePrompts: () => 
            ipcRenderer.invoke('settings:getSourcePrompts'),
        saveSourcePrompts: (prompts) => 
            ipcRenderer.invoke('settings:saveSourcePrompts', prompts)
    },

    // Learning System - AI learns from user behavior
    learnings: {
        captureSignal: (signal) => 
            ipcRenderer.invoke('learnings:captureSignal', signal),
        get: () => 
            ipcRenderer.invoke('learnings:get'),
        runInference: () => 
            ipcRenderer.invoke('learnings:runInference'),
        getForPrompt: (client, industry) => 
            ipcRenderer.invoke('learnings:getForPrompt', { client, industry }),
        clear: () => 
            ipcRenderer.invoke('learnings:clear'),
        updatePreference: (category, key, value) => 
            ipcRenderer.invoke('learnings:updatePreference', { category, key, value }),
        getStats: () => 
            ipcRenderer.invoke('learnings:getStats')
    },

    // File Operations
    files: {
        open: (options) => 
            ipcRenderer.invoke('files:open', options),
        read: (filePath) => 
            ipcRenderer.invoke('files:read', filePath)
    },

    // Shell Operations
    shell: {
        openExternal: (url) => 
            ipcRenderer.invoke('shell:openExternal', url),
        openPath: (filePath) => 
            ipcRenderer.invoke('shell:openPath', filePath)
    },

    // Platform Info
    platform: process.platform,
    
    // Version
    version: '1.0.0'
});

// Console log for debugging
console.log('R/StudioGPT - Preload script loaded');
